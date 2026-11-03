"use client";

import { memo, useEffect, useRef, useState } from "react";
import Dialog, { Button } from "@/components/Dialog";
import {
  ArchiveIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DotsIcon,
  FolderIcon,
  MoveIcon,
  PencilIcon,
  TrashIcon,
} from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { thumbUrl, zipUrl } from "@/components/media/urls";

export const parentOf = (dir) => dir.split("/").slice(0, -1).join("/");
export const baseOf = (dir) => dir.split("/").at(-1);

// One per open folder level: the phone's Back button steps up a level instead of leaving the app.
export function BackLevel({ onBack }) {
  useBackClose(true, onBack);
  return null;
}

// "Media › Goa Trip › Beach" — every part but the last is tappable.
export function Breadcrumbs({ dir, onGo }) {
  const parts = dir.split("/");
  return (
    <nav aria-label="Folder path" className="no-scrollbar -mx-1 flex items-center gap-0.5 overflow-x-auto text-sm">
      <button onClick={() => onGo(parentOf(dir))} aria-label="Up one folder" className="-ml-1.5 mr-0.5 rounded-xl p-2.5 text-zinc-300 transition-colors hover:bg-white/5 active:bg-white/5">
        <ChevronLeftIcon size={18} />
      </button>
      <button onClick={() => onGo("")} className="shrink-0 rounded-md px-1.5 py-2.5 text-zinc-500 transition-colors hover:text-zinc-100">
        Media
      </button>
      {parts.map((part, i) => {
        const path = parts.slice(0, i + 1).join("/");
        const last = i === parts.length - 1;
        return (
          <span key={path} className="flex shrink-0 items-center gap-0.5">
            <ChevronRightIcon size={14} className="text-zinc-700" />
            {last ? (
              <span className="px-1.5 py-1 font-medium text-zinc-200">{part}</span>
            ) : (
              <button onClick={() => onGo(path)} className="rounded-md px-1.5 py-2.5 text-zinc-500 transition-colors hover:text-zinc-100">
                {part}
              </button>
            )}
          </span>
        );
      })}
      {/* The whole folder (with subfolders) as one ZIP. */}
      <a
        href={zipUrl(dir)}
        download
        aria-label="Download this folder as ZIP"
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 active:bg-white/5"
      >
        <ArchiveIcon size={16} />
        ZIP
      </a>
    </nav>
  );
}

function FolderCardImpl({ folder, onOpen, onMenu }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const pressTimer = useRef(null);
  const longPressed = useRef(false);
  const cover = folder.cover && !failed;

  // Long-press opens the folder's options, like the "⋯" button.
  function onPointerDown(e) {
    if (e.pointerType === "mouse") return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(10);
      onMenu(folder);
    }, 450);
  }
  const cancelPress = () => clearTimeout(pressTimer.current);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => (longPressed.current ? (longPressed.current = false) : onOpen(folder.path))}
      onKeyDown={(e) => e.key === "Enter" && onOpen(folder.path)}
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerMove={(e) => (Math.abs(e.movementX) + Math.abs(e.movementY) > 6 ? cancelPress() : null)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(folder);
      }}
      className="group relative aspect-[4/3] cursor-pointer select-none overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900 outline-none transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:ring-violet-400 active:scale-[0.97]"
    >
      {cover ? (
        <>
          {!loaded && <div className="skeleton absolute inset-0" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbUrl(folder.cover)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`h-full w-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.04] ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        </>
      ) : (
        // No photos inside yet: a tinted tile, so the label uses normal text colours.
        <div className="flex h-full items-start bg-gradient-to-br from-violet-500/[0.10] to-sky-500/[0.07] p-3 text-violet-300">
          <FolderIcon size={30} strokeWidth={1.5} />
        </div>
      )}

      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-2.5 ${
          cover ? "bg-gradient-to-t from-black/75 via-black/35 to-transparent pt-10" : ""
        }`}
      >
        <p className={`flex items-center gap-1.5 truncate text-sm font-semibold ${cover ? "text-[#fff]" : "text-zinc-100"}`}>
          {cover && <FolderIcon size={14} className="shrink-0 opacity-80" />}
          <span className="truncate">{folder.name}</span>
        </p>
        <p className={`mt-0.5 text-[11px] tabular-nums ${cover ? "text-[#fff]/65" : "text-zinc-500"}`}>
          {folder.count === undefined
            ? folder.path.includes("/") ? `in ${folder.path.split("/").slice(0, -1).join(" › ")}` : "Folder"
            : folder.count === 0
              ? "Empty"
              : `${folder.count} item${folder.count === 1 ? "" : "s"}`}
        </p>
      </div>

      <button
        type="button"
        aria-label={`Options for ${folder.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(folder);
        }}
        className={`absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full transition-[opacity,background-color] lg:opacity-0 lg:group-hover:opacity-100 ${
          cover ? "bg-black/30 text-[#fff] backdrop-blur-sm hover:bg-black/50" : "text-zinc-400 hover:bg-white/5"
        }`}
      >
        <DotsIcon size={16} />
      </button>
    </div>
  );
}
export const FolderCard = memo(FolderCardImpl);

// Bottom sheet of folder actions (phone-style), also used on desktop.
export function FolderMenu({ folder, onClose, onRename, onMove, onDelete }) {
  useBackClose(true, onClose);
  const item = "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] transition-colors hover:bg-white/5 active:bg-white/5";
  return (
    <Dialog title={folder.name} onClose={onClose}>
      <p className="-mt-2 mb-3 text-xs text-zinc-500">
        Folder · {folder.count === 0 ? "empty" : `${folder.count} item${folder.count === 1 ? "" : "s"}`}
      </p>
      <div className="-mx-2">
        <button className={`${item} text-zinc-100`} onClick={onRename}>
          <PencilIcon size={18} className="text-zinc-400" /> Rename
        </button>
        <button className={`${item} text-zinc-100`} onClick={onMove}>
          <MoveIcon size={18} className="text-zinc-400" /> Move to another folder
        </button>
        <a className={`${item} text-zinc-100`} href={zipUrl(folder.path)} download onClick={onClose}>
          <ArchiveIcon size={18} className="text-zinc-400" /> Download as ZIP
        </a>
        <button className={`${item} text-red-300`} onClick={onDelete}>
          <TrashIcon size={18} /> Delete folder
        </button>
      </div>
    </Dialog>
  );
}

// New folder / rename: one text box. `submit` returns an error message or nothing.
export function NameDialog({ title, initial = "", action, onClose, submit }) {
  useBackClose(true, onClose);
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    if (name.trim() === initial) return onClose();
    setBusy(true);
    const problem = await submit(name.trim());
    setBusy(false);
    if (problem) setError(problem);
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="name-form" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : action}
          </Button>
        </>
      }
    >
      <form id="name-form" onSubmit={onSubmit}>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onFocus={(e) => e.target.select()}
          placeholder="e.g. Goa Trip"
          maxLength={120}
          className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent"
        />
        <p className={`mt-2 text-sm text-red-400 ${error ? "" : "hidden"}`}>{error}</p>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ title, message, action, onClose, onConfirm }) {
  useBackClose(true, onClose);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>
            {action}
          </Button>
        </>
      }
    >
      <p className="text-sm text-zinc-400">{message}</p>
    </Dialog>
  );
}

// Folder picker for "Move to…". `moving` lists the paths being moved, so a folder
// can't be dropped into itself and the folder they're already in can't be chosen.
// With `pick` it's a plain folder chooser instead ("Save audio in…"): any folder can be
// chosen, including the one it opens in. `title` and `action` replace the Move wording.
export function MoveDialog({ moving, from, onClose, onMove, pick = false, title, action }) {
  useBackClose(true, onClose);
  const [dir, setDir] = useState(from);
  const [folders, setFolders] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/files?dir=${encodeURIComponent(dir)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setFolders(d.folders ?? []))
      .catch(() => live && setFolders([]));
    return () => {
      live = false;
    };
  }, [dir]);

  const blocked = (path) => moving.some((m) => path === m || path.startsWith(`${m}/`));
  const choices = (folders ?? []).filter((f) => !blocked(f.path));
  const canMove = (pick || dir !== from) && !blocked(dir);

  return (
    <Dialog
      title={title ?? (moving.length === 1 ? `Move "${baseOf(moving[0])}"` : `Move ${moving.length} items`)}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canMove || busy}
            onClick={async () => {
              setBusy(true);
              await onMove(dir);
            }}
          >
            {busy ? (pick ? "Saving…" : "Moving…") : action ?? "Move here"}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex min-h-9 items-center gap-1 text-sm">
        {dir && (
          <button onClick={() => { setFolders(null); setDir(parentOf(dir)); }} aria-label="Up one folder" className="rounded-xl p-2.5 text-zinc-300 hover:bg-white/5">
            <ChevronLeftIcon size={18} />
          </button>
        )}
        <span className="truncate font-medium text-zinc-200">{dir ? dir.replaceAll("/", " › ") : "Media (top level)"}</span>
      </div>
      <div className="-mx-1 max-h-[45vh] min-h-[120px] overflow-y-auto">
        {folders === null ? (
          <div className="space-y-1.5 px-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-11 rounded-xl" />
            ))}
          </div>
        ) : choices.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-zinc-500">No folders here. Tap {action ?? "Move here"} to use this folder.</p>
        ) : (
          choices.map((f) => (
            <button
              key={f.path}
              onClick={() => { setFolders(null); setDir(f.path); }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-zinc-100 transition-colors hover:bg-white/5 active:bg-white/5"
            >
              <FolderIcon size={19} className="shrink-0 text-violet-300" />
              <span className="flex-1 truncate">{f.name}</span>
              <ChevronRightIcon size={16} className="text-zinc-600" />
            </button>
          ))
        )}
      </div>
      {dir === from && !pick && <p className="mt-2 text-xs text-zinc-500">Open a folder above, then tap Move here.</p>}
    </Dialog>
  );
}
