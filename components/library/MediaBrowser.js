"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Dialog from "@/components/Dialog";
import { useToast } from "@/components/Toaster";
import { CloseIcon, DownloadIcon, FolderPlusIcon, HeartIcon, PlusIcon, TrashIcon } from "@/components/icons";
import MediaGrid from "@/components/library/MediaGrid";
import { albumsFrom, createAlbum, folderOf, moveFiles, refreshLibrary, removeFiles, renamePath, restoreFiles, setFavorite, useLibrary } from "@/components/library/store";
import { NameDialog } from "@/components/media/Folders";
import Viewer from "@/components/media/Viewer";
import TrimEditor from "@/components/media/TrimEditor";
import RotateEditor from "@/components/media/RotateEditor";
import ExtractAudioDialog from "@/components/media/ExtractAudioDialog";
import UploadPanel from "@/components/media/UploadPanel";
import useUploader from "@/components/media/useUploader";
import { downloadUrl, joinPath, thumbUrl, zipFilesUrl } from "@/components/media/urls";
import useBackClose from "@/components/useBackClose";
import { haptic } from "@/lib/haptics";

const baseOf = (p) => p.split("/").at(-1);

/** "Add to album": pick an album (or make a new one). */
export function AlbumPicker({ title = "Add to album", exclude, onClose, onPick }) {
  useBackClose(true, onClose);
  const { files, folders } = useLibrary();
  const [naming, setNaming] = useState(false);
  const albums = useMemo(() => albumsFrom(files, folders).filter((a) => a.path !== exclude), [files, folders, exclude]);
  if (naming) {
    return (
      <NameDialog
        title="New album"
        action="Create & add"
        onClose={() => setNaming(false)}
        submit={async (name) => {
          const made = await createAlbum(name);
          if (made.error) return made.error;
          onPick(made.path, name);
        }}
      />
    );
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <button onClick={() => setNaming(true)} className="mb-1 flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-white/5 active:bg-white/5">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <PlusIcon size={22} />
        </span>
        <span className="font-medium text-zinc-100">New album</span>
      </button>
      {albums.map((a) => (
        <button key={a.path} onClick={() => onPick(a.path, a.name)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5 active:bg-white/5">
          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {a.cover && <img src={thumbUrl(a.cover)} alt="" className="h-full w-full object-cover" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-zinc-100">{a.name}</span>
            <span className="block truncate text-xs text-zinc-500">
              {a.count} item{a.count === 1 ? "" : "s"}
              {a.parent && ` · ${a.parent.replaceAll("/", " › ")}`}
            </span>
          </span>
        </button>
      ))}
    </Dialog>
  );
}

function SelectionBar({ count, allFavorite, onClear, onFavorite, onAlbum, onDownload, onDelete }) {
  const action = "flex h-11 w-11 items-center justify-center rounded-full text-zinc-200 transition-colors hover:bg-white/10 active:bg-white/10";
  return (
    <div className="anim-fade fixed inset-x-0 top-0 z-[45] border-b border-line bg-background pt-[env(safe-area-inset-top)] lg:left-64">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-1 px-2 sm:px-4">
        <button onClick={onClear} aria-label="Cancel selection" className={action}>
          <CloseIcon size={22} />
        </button>
        <p className="flex-1 pl-1 text-lg font-semibold tabular-nums text-zinc-50">{count} selected</p>
        <button onClick={onFavorite} aria-label={allFavorite ? "Remove from favourites" : "Add to favourites"} title="Favourite" className={action}>
          <HeartIcon size={21} className={allFavorite ? "fill-current text-pink-300" : ""} />
        </button>
        <button onClick={onAlbum} aria-label="Add to album" title="Add to album" className={action}>
          <FolderPlusIcon size={21} />
        </button>
        <button onClick={onDownload} aria-label="Download" title="Download originals" className={action}>
          <DownloadIcon size={21} />
        </button>
        <button onClick={onDelete} aria-label="Delete" title="Delete" className={`${action} hover:text-red-300`}>
          <TrashIcon size={21} />
        </button>
      </div>
    </div>
  );
}

/**
 * A screenful of photos: the grid, plus everything you can do with them (open, select,
 * favourite, add to album, download originals, delete with undo, edit videos) and uploading.
 * `uploadTo`: album the upload button sends to ("" = library, null = no uploading here).
 * `children({ upload })` renders the page's own header above the grid.
 */
export default function MediaBrowser({ files, grouped = true, uploadTo = null, empty = null, children, onUploaded }) {
  const toast = useToast();
  const { loadedAt } = useLibrary();
  const [selected, setSelected] = useState(() => new Set());
  const [openPath, setOpenPath] = useState(null);
  const [picking, setPicking] = useState(null); // paths to add to an album
  const [renaming, setRenaming] = useState(null);
  const [trimming, setTrimming] = useState(null);
  const [rotating, setRotating] = useState(null);
  const [audioFor, setAudioFor] = useState(null);
  const inputId = useId();

  useBackClose(selected.size > 0, () => setSelected(new Set()));
  useBackClose(Boolean(openPath), () => setOpenPath(null));

  // Uploads go into this screen's album, untouched (the original file, piece by piece).
  const uploadTarget = useRef(uploadTo);
  useEffect(() => {
    uploadTarget.current = uploadTo;
  }, [uploadTo]);
  const uploader = useUploader({
    onUploaded: () => {
      refreshLibrary();
      onUploaded?.();
    },
    pathFor: useCallback((file) => joinPath(uploadTarget.current ?? "", file.name), []),
  });
  const upload = useCallback(() => document.getElementById(inputId)?.click(), [inputId]);

  // Drag photos from the computer onto the page.
  const { enqueue } = uploader;
  useEffect(() => {
    if (uploadTo === null) return;
    const hasFiles = (e) => e.dataTransfer?.types?.includes("Files");
    const over = (e) => hasFiles(e) && e.preventDefault();
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      enqueue(Array.from(e.dataTransfer.files));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [uploadTo, enqueue]);

  const index = files.findIndex((f) => f.path === openPath);
  const openFile = index >= 0 ? files[index] : null;
  const chosen = files.filter((f) => selected.has(f.path));

  const remove = useCallback(
    async (paths) => {
      haptic("tap");
      setSelected(new Set());
      if (openPath && paths.includes(openPath)) {
        const i = files.findIndex((f) => f.path === openPath);
        const next = files.slice(i + 1).concat(files.slice(0, i).reverse()).find((f) => !paths.includes(f.path));
        setOpenPath(paths.length === 1 && next ? next.path : null);
      }
      const { ids, failed, reason } = await removeFiles(paths);
      if (!ids.length) return toast(reason, { duration: 9000 });
      const done = ids.length === 1 ? "Moved to Recycle Bin" : `${ids.length} items moved to Recycle Bin`;
      toast(failed ? `${done}. ${failed} couldn't be deleted. ${reason}` : done, {
        duration: failed ? 9000 : 6000,
        action: {
          label: "Undo",
          onClick: async () => {
            await restoreFiles(ids);
            toast(ids.length === 1 ? "Restored" : `Restored ${ids.length} items`);
          },
        },
      });
    },
    [files, openPath, toast]
  );

  const favorite = useCallback(
    async (list, on) => {
      haptic("tap");
      const ok = await setFavorite(list, on);
      if (!ok) toast("Couldn't update favourites. Check the connection.");
      else toast(on ? (list.length === 1 ? "Added to Favourites" : `${list.length} added to Favourites`) : "Removed from Favourites");
    },
    [toast]
  );

  async function addToAlbum(paths, album, name) {
    setPicking(null);
    setSelected(new Set());
    const already = paths.filter((p) => folderOf(p) === album).length;
    const { moved, reason } = await moveFiles(
      paths.filter((p) => folderOf(p) !== album),
      album
    );
    if (moved + already === paths.length) toast(`Added to "${name}"`);
    else toast(`Added ${moved} of ${paths.length}. ${reason}`, { duration: 8000 });
  }

  function download(list) {
    // One file: the original itself. Several: one ZIP of the originals (stored, not recompressed).
    const a = document.createElement("a");
    a.href = list.length === 1 ? downloadUrl(list[0]) : zipFilesUrl(list.map((f) => f.path));
    a.download = list.length === 1 ? list[0].name : "Puneet Studios.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function edited({ path, replaced }, setter, what) {
    setter(null);
    await refreshLibrary();
    setOpenPath(path);
    toast(replaced ? `${what}. The original is in the Recycle Bin for 3 days.` : `Saved "${baseOf(path)}"`, { duration: replaced ? 7000 : 5000 });
  }

  return (
    <>
      <input
        id={inputId}
        type="file"
        multiple
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          enqueue(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {children?.({ upload, selecting: selected.size > 0 })}

      {files.length === 0 ? empty : <MediaGrid files={files} grouped={grouped} selected={selected} setSelected={setSelected} onOpen={setOpenPath} now={loadedAt || 0} />}

      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          allFavorite={chosen.length > 0 && chosen.every((f) => f.favorite)}
          onClear={() => setSelected(new Set())}
          onFavorite={() => {
            const on = !chosen.every((f) => f.favorite);
            favorite(chosen, on);
            setSelected(new Set());
          }}
          onAlbum={() => setPicking([...selected])}
          onDownload={() => {
            download(chosen);
            setSelected(new Set());
          }}
          onDelete={() => remove([...selected])}
        />
      )}

      {openFile && (
        <Viewer
          file={openFile}
          prev={files[index - 1] ?? null}
          next={files[index + 1] ?? null}
          position={`${index + 1} / ${files.length}`}
          onClose={() => setOpenPath(null)}
          onNavigate={setOpenPath}
          onRename={setRenaming}
          onDelete={remove}
          onTrim={setTrimming}
          onRotate={setRotating}
          onExtractAudio={setAudioFor}
          onFavorite={favorite}
          onAddToAlbum={(file) => setPicking([file.path])}
        />
      )}

      {picking && <AlbumPicker onClose={() => setPicking(null)} onPick={(album, name) => addToAlbum(picking, album, name)} />}
      {renaming && (
        <NameDialog
          title="Rename"
          action="Save"
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          submit={async (name) => {
            const r = await renamePath(renaming.path, name);
            if (r.error) return r.error;
            setRenaming(null);
            if (openPath === renaming.path) setOpenPath(r.path);
          }}
        />
      )}
      {trimming && <TrimEditor file={trimming} onClose={() => setTrimming(null)} onSaved={(r) => edited(r, setTrimming, "Trimmed")} />}
      {rotating && <RotateEditor file={rotating} onClose={() => setRotating(null)} onSaved={(r) => edited(r, setRotating, "Rotated")} />}
      {audioFor && (
        <ExtractAudioDialog
          file={audioFor}
          onClose={() => setAudioFor(null)}
          onSaved={async (path) => {
            setAudioFor(null);
            await refreshLibrary();
            toast(`Saved "${baseOf(path)}"`);
          }}
        />
      )}
      {uploadTo !== null && (
        <UploadPanel items={uploader.items} speed={uploader.speed} active={uploader.active} onCancel={uploader.cancel} onClear={uploader.clearFinished} onAdd={upload} />
      )}
    </>
  );
}

