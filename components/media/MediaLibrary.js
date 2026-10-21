"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AppShell";
import Dialog, { Button } from "@/components/Dialog";
import { useToast } from "@/components/Toaster";
import {
  ChevronDownIcon,
  CloseIcon,
  DownloadIcon,
  FolderPlusIcon,
  MediaIcon,
  MoveIcon,
  SearchIcon,
  SortIcon,
  SelectIcon,
  TrashIcon,
  UploadIcon,
} from "@/components/icons";
import MediaTile from "@/components/media/MediaTile";
import UploadPanel from "@/components/media/UploadPanel";
import Viewer from "@/components/media/Viewer";
import useUploader from "@/components/media/useUploader";
import useBackClose from "@/components/useBackClose";
import { actionUrl, downloadUrl, joinPath } from "@/components/media/urls";
import {
  BackLevel,
  Breadcrumbs,
  ConfirmDialog,
  FolderCard,
  FolderMenu,
  MoveDialog,
  NameDialog,
  baseOf,
} from "@/components/media/Folders";
import { dayLabel, formatSize } from "@/lib/format";

const CACHE_KEY = "ps.media.v1";
const POLL_MS = 20000;
const FILTERS = [
  { id: "all", label: "All" },
  { id: "video", label: "Videos" },
  { id: "image", label: "Photos" },
  { id: "audio", label: "Audio" },
];
const SORTS = {
  newest: { label: "Newest first", compare: (a, b) => b.modified - a.modified, grouped: true },
  oldest: { label: "Oldest first", compare: (a, b) => a.modified - b.modified, grouped: true },
  largest: { label: "Largest first", compare: (a, b) => b.size - a.size },
  name: { label: "Name", compare: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) },
};

// The last listing of each folder is kept in localStorage so reopening paints instantly.
function readCache(dir) {
  try {
    return JSON.parse(localStorage.getItem(`${CACHE_KEY}:${dir}`));
  } catch {
    return null;
  }
}
function writeCache(dir, data) {
  try {
    localStorage.setItem(`${CACHE_KEY}:${dir}`, JSON.stringify(data));
  } catch {}
}

async function readJson(res) {
  return res.json().catch(() => ({ error: `The studio PC answered with an error (${res.status})` }));
}

export default function MediaLibrary() {
  const { loggedOut, setStorage } = useAuth();
  const toast = useToast();
  const [dir, setDir] = useState(""); // current folder, "" = top level
  const [files, setFiles] = useState(null);
  const [folders, setFolders] = useState([]);
  const [folderMenu, setFolderMenu] = useState(null);
  const [naming, setNaming] = useState(null); // { folder } to rename one, {} for a new folder
  const [deleting, setDeleting] = useState(null);
  const [moving, setMoving] = useState(null); // paths being moved
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState(() => new Set());
  const [openName, setOpenName] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const hidden = useRef(new Set()); // names deleted optimistically, until the server agrees
  const metaRetry = useRef(null);
  const metaRetries = useRef(0); // capped: files that can't be thumbnailed never get metadata
  const loadRef = useRef(null);
  const dirRef = useRef(dir);

  const apply = useCallback(
    (data) => {
      setFiles(data.files.filter((f) => !hidden.current.has(f.name)));
      setFolders((data.folders ?? []).filter((f) => !hidden.current.has(f.name)));
      setNow(Date.now());
      if (data.disk?.media !== undefined) setStorage(data.disk);
    },
    [setStorage]
  );

  const load = useCallback(async () => {
    const want = dirRef.current;
    try {
      const res = await fetch(`/api/files?dir=${encodeURIComponent(want)}`, { cache: "no-store" });
      if (res.status === 401) return loggedOut();
      // The folder was deleted or renamed elsewhere: go back to the top.
      if (res.status === 404 && want) return setDir("");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (want !== dirRef.current) return; // answer for a folder we already left
      apply(data);
      writeCache(want, data);
      setError("");
      const missingMeta = data.files.some((f) => (f.kind === "video" || f.kind === "image") && !f.width);
      if (missingMeta && !metaRetry.current && metaRetries.current < 5) {
        metaRetries.current++;
        metaRetry.current = setTimeout(() => {
          metaRetry.current = null;
          loadRef.current?.();
        }, 4000);
      }
    } catch {
      setError("Can't reach the studio PC right now. Retrying…");
    }
  }, [apply, loggedOut]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // Entering a folder: show its cached listing at once, then refresh it.
  useEffect(() => {
    dirRef.current = dir;
    const cached = readCache(dir);
    const first = setTimeout(() => {
      setSelected(new Set());
      setOpenName(null);
      setQuery("");
      metaRetries.current = 0;
      if (cached?.files) apply(cached);
      else {
        setFiles(null);
        setFolders([]);
      }
      load();
      window.scrollTo({ top: 0 });
    }, 0);
    return () => clearTimeout(first);
  }, [dir, apply, load]);

  useEffect(() => {
    const timer = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Uploads land in the folder that was open when they were picked.
  const uploadUrl = useCallback((file) => actionUrl(joinPath(dirRef.current, file.name)), []);
  const uploader = useUploader({ onUploaded: load, urlFor: uploadUrl });
  // Phone Back closes the viewer / dialog / selection instead of leaving the app.
  useBackClose(Boolean(openName), () => setOpenName(null));
  useBackClose(Boolean(renaming), () => setRenaming(null));
  useBackClose(selected.size > 0, () => setSelected(new Set()));
  const { enqueue } = uploader;

  // Drag-and-drop anywhere on the page (desktop).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer?.types?.includes("Files");
    const enter = (e) => hasFiles(e) && (depth++, setDragging(true));
    const leave = (e) => hasFiles(e) && --depth <= 0 && ((depth = 0), setDragging(false));
    const over = (e) => hasFiles(e) && e.preventDefault();
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      enqueue(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [enqueue]);

  const visibleFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (filter !== "all") return [];
    return folders.filter((f) => !q || f.name.toLowerCase().includes(q));
  }, [folders, query, filter]);

  const visible = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLowerCase();
    return files
      .filter((f) => (filter === "all" || f.kind === filter) && (!q || f.name.toLowerCase().includes(q)))
      .sort(SORTS[sort].compare);
  }, [files, query, filter, sort]);

  const groups = useMemo(() => {
    if (!SORTS[sort].grouped) return [{ label: null, items: visible }];
    const out = [];
    for (const f of visible) {
      const label = dayLabel(f.modified, now);
      if (out.at(-1)?.label === label) out.at(-1).items.push(f);
      else out.push({ label, items: [f] });
    }
    return out;
  }, [visible, sort, now]);

  const totalSize = useMemo(() => (files ?? []).reduce((sum, f) => sum + f.size, 0), [files]);
  const selecting = selected.size > 0;

  const toggle = useCallback((name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const remove = useCallback(
    async (names) => {
      names.forEach((n) => hidden.current.add(n));
      setFiles((list) => list?.filter((f) => !names.includes(f.name)));
      setSelected(new Set());
      if (openName && names.includes(openName)) {
        const idx = visible.findIndex((f) => f.name === openName);
        const fallback = visible.slice(idx + 1).concat(visible.slice(0, idx).reverse()).find((f) => !names.includes(f.name));
        setOpenName(names.length === 1 && fallback ? fallback.name : null);
      }

      const results = await Promise.all(
        names.map((n) =>
          fetch(actionUrl(joinPath(dir, n)), { method: "DELETE" })
            .then(readJson)
            .catch(() => ({ error: "Can't reach the studio PC. Check your connection and try again." }))
        )
      );
      const ids = results.map((r) => r.trashId).filter(Boolean);
      names.forEach((n) => hidden.current.delete(n));
      load();

      // The server explains why (usually: the file is open in DaVinci on the PC).
      const failed = results.filter((r) => !r.trashId);
      const reason = failed.length ? failed[0].error || "Something went wrong on the studio PC." : "";
      if (!ids.length) return toast(reason, { duration: 9000 });
      const done = ids.length === 1 ? "Deleted 1 item" : `Deleted ${ids.length} items`;
      toast(failed.length ? `${done}. ${failed.length} couldn't be deleted. ${reason}` : done, {
        duration: failed.length ? 9000 : 7000,
        action: {
          label: "Undo",
          onClick: async () => {
            await fetch("/api/trash", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids }),
            });
            await load();
            toast(ids.length === 1 ? "Restored" : `Restored ${ids.length} items`);
          },
        },
      });
    },
    [dir, load, openName, toast, visible]
  );

  // ----- Folders -----
  async function createFolder(name) {
    const res = await fetch(`/api/files?folder=${encodeURIComponent(joinPath(dir, name))}`, { method: "POST" });
    const data = await readJson(res);
    if (!res.ok) return data.error || "Couldn't create the folder";
    setNaming(null);
    await load();
    toast(`Created "${name}"`, { action: { label: "Open", onClick: () => setDir(data.path) } });
  }

  async function renameFolder(folder, name) {
    const res = await fetch(actionUrl(folder.path), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName: name }),
    });
    const data = await readJson(res);
    if (!res.ok) return data.error || "Couldn't rename";
    setNaming(null);
    await load();
    toast("Renamed");
  }

  async function deleteFolder(folder) {
    setDeleting(null);
    hidden.current.add(folder.name);
    setFolders((list) => list.filter((f) => f.path !== folder.path));
    const data = await fetch(actionUrl(folder.path), { method: "DELETE" })
      .then(readJson)
      .catch(() => ({ error: "Can't reach the studio PC. Check your connection and try again." }));
    hidden.current.delete(folder.name);
    await load();
    if (!data.trashId) return toast(data.error || "Couldn't delete the folder", { duration: 9000 });
    toast(`Deleted "${folder.name}"`, {
      duration: 7000,
      action: {
        label: "Undo",
        onClick: async () => {
          await fetch("/api/trash", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [data.trashId] }),
          });
          await load();
          toast("Restored");
        },
      },
    });
  }

  async function moveTo(paths, target) {
    const results = await Promise.all(
      paths.map((p) =>
        fetch(actionUrl(p), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moveTo: target }),
        })
          .then(async (r) => ({ ok: r.ok, ...(await readJson(r)) }))
          .catch(() => ({ ok: false, error: "Can't reach the studio PC." }))
      )
    );
    setMoving(null);
    setSelected(new Set());
    await load();
    const moved = results.filter((r) => r.ok).length;
    const failed = results.find((r) => !r.ok);
    if (!moved) return toast(failed?.error || "Couldn't move", { duration: 9000 });
    const where = target ? `"${baseOf(target)}"` : "Media";
    const count = moved === 1 ? "1 item" : `${moved} items`;
    toast(`Moved ${count} to ${where}${failed ? `. ${results.length - moved} failed: ${failed.error}` : ""}`, {
      duration: failed ? 9000 : 5000,
      action: { label: "Open", onClick: () => setDir(target) },
    });
  }

  function downloadSelected() {
    const chosen = (files ?? []).filter((f) => selected.has(f.name));
    chosen.forEach((f, i) =>
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = downloadUrl(f);
        a.download = f.name;
        a.click();
      }, i * 400)
    );
    toast(`Downloading ${chosen.length} item${chosen.length > 1 ? "s" : ""}`);
    setSelected(new Set());
  }

  const openIndex = visible.findIndex((f) => f.name === openName);
  const openFile = openIndex >= 0 ? visible[openIndex] : null;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col">
      {selecting ? (
        <div className="anim-fade fixed inset-x-0 top-0 z-40 flex items-center gap-1 border-b border-white/[0.06] bg-zinc-950/90 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-4 lg:left-64">
          <button
            onClick={() => setSelected(new Set())}
            aria-label="Clear selection"
            className="rounded-full p-2 text-zinc-300 transition-colors hover:bg-white/5"
          >
            <CloseIcon size={20} />
          </button>
          <span className="mr-auto pl-1 text-[15px] font-medium tabular-nums text-zinc-100">{selected.size} selected</span>
          <Button variant="ghost" onClick={() => setSelected(new Set(visible.map((f) => f.name)))} className="max-sm:px-2.5">
            Select all
          </Button>
          <Button variant="ghost" onClick={downloadSelected} aria-label="Download" className="max-sm:px-2.5">
            <DownloadIcon size={18} />
            <span className="max-sm:hidden">Download</span>
          </Button>
          <Button variant="ghost" onClick={() => setMoving([...selected].map((n) => joinPath(dir, n)))} aria-label="Move" className="max-sm:px-2.5">
            <MoveIcon size={18} />
            <span className="max-sm:hidden">Move</span>
          </Button>
          <Button variant="ghost" onClick={() => remove([...selected])} aria-label="Delete" className="text-red-300 hover:bg-red-500/10 max-sm:px-2.5">
            <TrashIcon size={18} />
            <span className="max-sm:hidden">Delete</span>
          </Button>
        </div>
      ) : null}

      {/* One history entry per folder level, so phone Back climbs out a level at a time. */}
      {dir.split("/").filter(Boolean).map((_, i, parts) => (
        <BackLevel key={parts.slice(0, i + 1).join("/")} onBack={() => setDir(parts.slice(0, i).join("/"))} />
      ))}

      <header className="px-4 pb-4 pt-4 sm:px-6 lg:pt-8">
        {dir && (
          <div className="anim-fade mb-2">
            <Breadcrumbs dir={dir} onGo={setDir} />
          </div>
        )}
        <div className="flex items-end gap-4">
          <div className="mr-auto min-w-0">
            <h1 className={`truncate text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[28px] ${dir ? "" : "max-lg:sr-only"}`}>
              {dir ? baseOf(dir) : "Media"}
            </h1>
            <p className={`mt-1 text-sm tabular-nums text-zinc-500 ${dir ? "" : "max-lg:mt-0"}`}>
              {files
                ? [
                    folders.length > 0 && `${folders.length} folder${folders.length === 1 ? "" : "s"}`,
                    `${files.length.toLocaleString()} item${files.length === 1 ? "" : "s"}`,
                    formatSize(totalSize),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Loading library…"}
            </p>
          </div>
          <button
            onClick={() => setNaming({})}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-3.5 py-2.5 text-sm font-medium text-zinc-200 transition-[background-color,transform] hover:bg-white/5 active:scale-[0.98] max-lg:hidden"
          >
            <FolderPlusIcon size={17} />
            New folder
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-white/5 transition-[background-color,transform] hover:bg-zinc-200 active:scale-[0.98] max-lg:hidden"
          >
            <UploadIcon size={17} strokeWidth={2.2} />
            Upload
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="video/*,image/*,audio/*"
            className="hidden"
            onChange={(e) => {
              uploader.enqueue(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="mt-3 flex flex-col gap-2.5 md:flex-row md:items-center lg:mt-5">
          <label className="relative flex-1 md:max-w-sm">
            <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your media"
              className="w-full rounded-xl border border-white/[0.07] bg-white/[0.03] py-2.5 pl-9 pr-9 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/50 focus:bg-white/[0.05]"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-500 hover:text-zinc-200"
              >
                <CloseIcon size={15} />
              </button>
            )}
          </label>

          <div className="flex items-center gap-2">
            <div className="no-scrollbar flex flex-1 overflow-x-auto rounded-xl border border-white/[0.07] bg-white/[0.02] p-1 md:flex-none">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors sm:px-3.5 md:flex-none ${
                    filter === f.id ? "bg-white/[0.09] text-zinc-50" : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <label className="relative shrink-0">
              <SortIcon size={18} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-zinc-400 md:hidden" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort"
                className="w-10 appearance-none rounded-xl border border-white/[0.07] bg-white/[0.02] py-2 text-sm text-transparent outline-none transition-colors focus:border-violet-400/50 md:w-auto md:pl-3 md:pr-8 md:text-zinc-300 md:hover:text-zinc-100"
              >
                {Object.entries(SORTS).map(([id, s]) => (
                  <option key={id} value={id} className="bg-zinc-900">
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon size={15} className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 text-zinc-500 md:block" />
            </label>

            <button
              onClick={() => setNaming({})}
              aria-label="New folder"
              title="New folder"
              className="shrink-0 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2 text-zinc-400 transition-colors hover:text-zinc-100 lg:hidden"
            >
              <FolderPlusIcon size={18} />
            </button>

            {files?.length > 0 && (
              <button
                onClick={() => visible[0] && toggle(visible[0].name)}
                aria-label="Select"
                title="Select"
                className="hidden rounded-xl border border-white/[0.07] bg-white/[0.02] p-2 text-zinc-400 transition-colors hover:text-zinc-100 sm:block"
              >
                <SelectIcon size={18} />
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <p className="anim-fade mx-4 mb-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-2.5 text-sm text-amber-200 sm:mx-6">
          {error}
        </p>
      )}

      <main className="flex-1 px-0.5 pb-28 sm:px-6">
        {visibleFolders.length > 0 && (
          <section className="anim-fade mb-6 px-3 sm:px-0">
            <h2 className="mb-2.5 flex items-baseline gap-2 px-0.5 text-sm font-medium text-zinc-200 sm:px-0">
              Folders
              <span className="text-xs font-normal tabular-nums text-zinc-600">{visibleFolders.length}</span>
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {visibleFolders.map((f) => (
                <FolderCard key={f.path} folder={f} onOpen={setDir} onMenu={setFolderMenu} />
              ))}
            </div>
          </section>
        )}
        {files === null ? (
          <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 sm:gap-1.5 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {Array.from({ length: 21 }, (_, i) => (
              <div key={i} className="skeleton aspect-square" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          visibleFolders.length > 0 ? null : (
            <EmptyState
              searching={files.length + folders.length > 0}
              inFolder={Boolean(dir)}
              onUpload={() => inputRef.current?.click()}
              onNewFolder={() => setNaming({})}
            />
          )
        ) : (
          groups.map((group) => (
            <section key={group.label ?? "all"} className="lazy-section mb-6">
              {group.label && (
                <h2 className="mb-2.5 flex items-baseline gap-2 px-3.5 text-sm font-medium text-zinc-200 sm:px-0">
                  {group.label}
                  <span className="text-xs font-normal tabular-nums text-zinc-600">{group.items.length}</span>
                </h2>
              )}
              <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 sm:gap-1.5 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 sm:[&>*]:rounded-lg">
                {group.items.map((f) => (
                  <MediaTile
                    key={f.name}
                    file={f}
                    selected={selected.has(f.name)}
                    selecting={selecting}
                    onOpen={setOpenName}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {/* Phone: upload button within thumb reach. */}
      {!selecting && uploader.items.length === 0 && (
        <button
          onClick={() => inputRef.current?.click()}
          aria-label="Upload"
          className="anim-pop fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-zinc-950 shadow-xl shadow-black/30 transition-transform duration-150 active:scale-90 lg:hidden"
        >
          <UploadIcon size={22} strokeWidth={2.2} />
        </button>
      )}

      <UploadPanel
        onAdd={() => inputRef.current?.click()}
        items={uploader.items}
        speed={uploader.speed}
        active={uploader.active}
        onCancel={uploader.cancel}
        onClear={uploader.clearFinished}
      />

      {openFile && (
        <Viewer
          file={openFile}
          prev={visible[openIndex - 1] ?? null}
          next={visible[openIndex + 1] ?? null}
          onClose={() => setOpenName(null)}
          onNavigate={setOpenName}
          onRename={setRenaming}
          onDelete={remove}
        />
      )}

      {folderMenu && (
        <FolderMenu
          folder={folderMenu}
          onClose={() => setFolderMenu(null)}
          onRename={() => {
            setNaming({ folder: folderMenu });
            setFolderMenu(null);
          }}
          onMove={() => {
            setMoving([folderMenu.path]);
            setFolderMenu(null);
          }}
          onDelete={() => {
            setDeleting(folderMenu);
            setFolderMenu(null);
          }}
        />
      )}

      {naming && (
        <NameDialog
          title={naming.folder ? "Rename folder" : "New folder"}
          action={naming.folder ? "Save" : "Create"}
          initial={naming.folder?.name ?? ""}
          onClose={() => setNaming(null)}
          submit={(name) => (naming.folder ? renameFolder(naming.folder, name) : createFolder(name))}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          message={
            deleting.count
              ? `The folder and everything inside it (${deleting.count} item${deleting.count === 1 ? "" : "s"}, including subfolders) will be deleted. You can undo for a few seconds.`
              : "This empty folder will be deleted."
          }
          action="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteFolder(deleting)}
        />
      )}

      {moving && <MoveDialog moving={moving} from={dir} onClose={() => setMoving(null)} onMove={(target) => moveTo(moving, target)} />}

      {renaming && (
        <RenameDialog
          file={renaming}
          onClose={() => setRenaming(null)}
          onDone={async (name) => {
            setRenaming(null);
            if (openName === renaming.name) setOpenName(name);
            await load();
            toast("Renamed");
          }}
        />
      )}

      {dragging && (
        <div className="anim-fade pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
          <div className="anim-pop flex flex-col items-center rounded-3xl border-2 border-dashed border-violet-400/50 px-16 py-12 text-center">
            <UploadIcon size={34} className="mb-3 text-violet-300" />
            <p className="text-lg font-medium text-zinc-100">Drop to upload</p>
            <p className="mt-1 text-sm text-zinc-500">Files are saved to the studio PC</p>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ searching, inFolder, onUpload, onNewFolder }) {
  return (
    <div className="anim-rise flex flex-col items-center px-6 py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] text-zinc-400">
        {searching ? <SearchIcon size={26} /> : <MediaIcon size={28} />}
      </div>
      <p className="text-lg font-medium text-zinc-100">
        {searching ? "Nothing matches" : inFolder ? "This folder is empty" : "Your library is empty"}
      </p>
      <p className="mt-1.5 max-w-sm text-sm text-zinc-500">
        {searching
          ? "Try a different name or filter."
          : inFolder
            ? "Upload here, make a subfolder, or move media in from another folder."
            : "Upload videos and photos from your phone. They're stored on the studio PC, not your phone."}
      </p>
      {!searching && (
        <div className="mt-6 flex gap-2">
          <Button variant="primary" onClick={onUpload}>
            <UploadIcon size={16} />
            Upload media
          </Button>
          <Button onClick={onNewFolder}>
            <FolderPlusIcon size={16} />
            New folder
          </Button>
        </div>
      )}
    </div>
  );
}

function RenameDialog({ file, onClose, onDone }) {
  const [name, setName] = useState(file.name);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const extAt = file.name.lastIndexOf(".");

  async function submit(e) {
    e.preventDefault();
    if (name.trim() === file.name) return onClose();
    setBusy(true);
    const res = await fetch(actionUrl(file.path ?? file.name), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName: name.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "Couldn't rename");
    onDone(data.name);
  }

  return (
    <Dialog
      title="Rename"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="rename-form" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="rename-form" onSubmit={submit}>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          // Select just the name part so typing keeps the extension.
          onFocus={(e) => e.target.setSelectionRange(0, extAt > 0 ? extAt : file.name.length)}
          className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-violet-400/60"
        />
        <p className={`mt-2 text-sm text-red-400 ${error ? "" : "hidden"}`}>{error}</p>
      </form>
    </Dialog>
  );
}
