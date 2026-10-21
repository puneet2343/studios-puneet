"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AppShell";
import PullToRefresh from "@/components/PullToRefresh";
import { StorageBanner } from "@/components/StorageAlerts";
import { UPLOAD_RESERVE } from "@/lib/storage-levels";
import { haptic } from "@/lib/haptics";
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
  StarFilledIcon,
  StarIcon,
  TrashIcon,
  UploadIcon,
} from "@/components/icons";
import MediaTile from "@/components/media/MediaTile";
import UploadPanel from "@/components/media/UploadPanel";
import TrimEditor from "@/components/media/TrimEditor";
import RotateEditor from "@/components/media/RotateEditor";
import { TripSuggestions, dismissTrip, readDismissed } from "@/components/media/Trips";
import Viewer from "@/components/media/Viewer";
import useUploader from "@/components/media/useUploader";
import useBackClose from "@/components/useBackClose";
import { actionUrl, downloadUrl, joinPath, zipFilesUrl } from "@/components/media/urls";
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

const CACHE_KEY = "ps.media.v2";
const POLL_MS = 20000;
const FILTERS = [
  { id: "all", label: "All" },
  { id: "video", label: "Videos" },
  { id: "image", label: "Photos" },
  { id: "audio", label: "Audio" },
  { id: "favorites", label: "Favourites", icon: StarFilledIcon },
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
  const [disk, setDisk] = useState(null);
  const [folders, setFolders] = useState([]);
  const [folderMenu, setFolderMenu] = useState(null);
  const [naming, setNaming] = useState(null); // { folder } to rename one, {} for a new folder
  const [deleting, setDeleting] = useState(null);
  const [moving, setMoving] = useState(null); // paths being moved
  const [trimming, setTrimming] = useState(null); // video file open in the trim editor
  const [rotating, setRotating] = useState(null); // video file open in the rotate editor
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState(() => new Set());
  const [openPath, setOpenPath] = useState(null);
  // Search and Favourites look across every folder; their results replace the folder view.
  const [remote, setRemote] = useState(null); // { files, folders, truncated } or null
  const [trips, setTrips] = useState([]);
  const [tripNaming, setTripNaming] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const hidden = useRef(new Set()); // paths deleted optimistically, until the server agrees
  const metaRetry = useRef(null);
  const metaRetries = useRef(0); // capped: files that can't be thumbnailed never get metadata
  const loadRef = useRef(null);
  const dirRef = useRef(dir);

  const apply = useCallback(
    (data) => {
      setFiles(data.files.filter((f) => !hidden.current.has(f.path)));
      setFolders((data.folders ?? []).filter((f) => !hidden.current.has(f.path)));
      setNow(Date.now());
      if (data.disk?.media !== undefined) {
        setStorage(data.disk);
        setDisk(data.disk);
      }
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
      setOpenPath(null);
      setQuery("");
      setFilter((f) => (f === "favorites" ? "all" : f));
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
  useBackClose(Boolean(openPath), () => setOpenPath(null));
  useBackClose(Boolean(renaming), () => setRenaming(null));
  useBackClose(selected.size > 0, () => setSelected(new Set()));
  const { enqueue } = uploader;

  // Check the picked files fit on the PC before spending time uploading them.
  const addFiles = useCallback(
    (list) => {
      const picked = Array.from(list ?? []);
      const total = picked.reduce((sum, f) => sum + f.size, 0);
      const usable = disk ? disk.free - UPLOAD_RESERVE : Infinity;
      if (picked.length && total > usable) {
        haptic("warn");
        toast(
          `Not enough space on the studio PC: you picked ${formatSize(total)} but only ${formatSize(Math.max(0, usable))} is free. Empty the Recycle Bin or remove duplicates first.`,
          { duration: 10000 }
        );
        return;
      }
      enqueue(picked);
    },
    [disk, enqueue, toast]
  );

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
      addFiles(e.dataTransfer.files);
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
  }, [addFiles]);

  const searching = query.trim() !== "";
  const favorites = filter === "favorites";
  const remoteMode = searching || favorites;

  // Library-wide search / favourites, fetched as you type (slightly delayed).
  const remoteKey = remoteMode ? `${favorites ? "fav=1&" : ""}q=${encodeURIComponent(query.trim())}` : null;
  const loadRemote = useCallback(async () => {
    if (!remoteKey) return;
    const data = await fetch(`/api/search?${remoteKey}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (data) setRemote({ ...data, key: remoteKey });
  }, [remoteKey]);
  useEffect(() => {
    if (!remoteKey) return;
    const timer = setTimeout(loadRemote, searching ? 250 : 0);
    return () => clearTimeout(timer);
  }, [remoteKey, searching, loadRemote]);
  const remoteReady = remote?.key === remoteKey;

  // Trip suggestions, only on the top level.
  const loadTrips = useCallback(async () => {
    const data = await fetch("/api/trips", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (data) {
      const dismissed = readDismissed();
      setTrips(data.trips.filter((t) => !dismissed.has(t.id)));
    }
  }, []);
  useEffect(() => {
    if (dir) return;
    const timer = setTimeout(loadTrips, 600);
    return () => clearTimeout(timer);
  }, [dir, loadTrips, files?.length]);

  const refreshAll = useCallback(async () => {
    await Promise.all([load(), remoteKey ? loadRemote() : null]);
  }, [load, loadRemote, remoteKey]);

  const visibleFolders = useMemo(() => {
    if (remoteMode) return remoteReady && !favorites ? remote.folders : [];
    return filter === "all" ? folders : [];
  }, [remoteMode, remoteReady, favorites, remote, folders, filter]);

  const visible = useMemo(() => {
    const source = remoteMode ? (remoteReady ? remote.files : []) : files ?? [];
    return source
      .filter((f) => filter === "all" || filter === "favorites" || f.kind === filter)
      .sort(SORTS[sort].compare);
  }, [remoteMode, remoteReady, remote, files, filter, sort]);

  const groups = useMemo(() => {
    if (remoteMode) {
      // Results from many folders: one section per folder.
      const byFolder = new Map();
      for (const f of visible) {
        const folder = f.path.includes("/") ? f.path.split("/").slice(0, -1).join(" › ") : "Media";
        if (!byFolder.has(folder)) byFolder.set(folder, []);
        byFolder.get(folder).push(f);
      }
      return [...byFolder].map(([label, items]) => ({ label, items }));
    }
    if (!SORTS[sort].grouped) return [{ label: null, items: visible }];
    const out = [];
    for (const f of visible) {
      const label = dayLabel(f.modified, now);
      if (out.at(-1)?.label === label) out.at(-1).items.push(f);
      else out.push({ label, items: [f] });
    }
    return out;
  }, [visible, sort, now, remoteMode]);

  const totalSize = useMemo(() => (files ?? []).reduce((sum, f) => sum + f.size, 0), [files]);
  const selecting = selected.size > 0;

  // Long-press a tile, then slide the finger over others to select them as well
  // (like Google Photos). Scrolling is held off while doing it; near the screen edges
  // the page scrolls along.
  const startDragSelect = useCallback((path) => {
    haptic("tap");
    const seen = new Set([path]);
    const move = (e) => {
      if (e.cancelable) e.preventDefault();
      const t = e.touches[0];
      const tile = document.elementFromPoint(t.clientX, t.clientY)?.closest?.("[data-path]");
      const p = tile?.dataset.path;
      if (p && !seen.has(p)) {
        seen.add(p);
        haptic("tick");
        setSelected((prev) => new Set(prev).add(p));
      }
      if (t.clientY > window.innerHeight - 140) window.scrollBy(0, 14);
      else if (t.clientY < 130) window.scrollBy(0, -14);
    };
    const end = () => {
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
  }, []);

  const toggle = useCallback((path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const remove = useCallback(
    async (paths) => {
      haptic("tap");
      paths.forEach((p) => hidden.current.add(p));
      setFiles((list) => list?.filter((f) => !paths.includes(f.path)));
      setRemote((r) => (r ? { ...r, files: r.files.filter((f) => !paths.includes(f.path)) } : r));
      setSelected(new Set());
      if (openPath && paths.includes(openPath)) {
        const idx = visible.findIndex((f) => f.path === openPath);
        const fallback = visible.slice(idx + 1).concat(visible.slice(0, idx).reverse()).find((f) => !paths.includes(f.path));
        setOpenPath(paths.length === 1 && fallback ? fallback.path : null);
      }

      const results = await Promise.all(
        paths.map((p) =>
          fetch(actionUrl(p), { method: "DELETE" })
            .then(readJson)
            .catch(() => ({ error: "Can't reach the studio PC. Check your connection and try again." }))
        )
      );
      const ids = results.map((r) => r.trashId).filter(Boolean);
      paths.forEach((p) => hidden.current.delete(p));
      refreshAll();

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
            await refreshAll();
            toast(ids.length === 1 ? "Restored" : `Restored ${ids.length} items`);
          },
        },
      });
    },
    [refreshAll, openPath, toast, visible]
  );

  // ----- Favourites -----
  // Optimistic: the star changes at once, then the PC is told.
  const setFavorite = useCallback(
    async (list, on) => {
      haptic("tap");
      const keys = new Set(list.map((f) => f.key));
      const mark = (arr) => arr?.map((f) => (keys.has(f.key) ? { ...f, favorite: on || undefined } : f));
      setFiles(mark);
      setRemote((r) => (r ? { ...r, files: favorites && !on ? r.files.filter((f) => !keys.has(f.key)) : mark(r.files) } : r));
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [...keys], on }),
      }).catch(() => null);
      if (!res?.ok) {
        toast("Couldn't update favourites. Check the connection.");
        return refreshAll();
      }
      toast(on ? (list.length === 1 ? "Added to favourites" : `Added ${list.length} to favourites`) : "Removed from favourites");
    },
    [favorites, refreshAll, toast]
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
    await refreshAll();
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

  async function createTrip(trip, name) {
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, paths: trip.paths }),
    }).catch(() => null);
    const data = res ? await readJson(res) : { error: "Can't reach the studio PC." };
    if (!res?.ok) return data.error || "Couldn't create the folder";
    setTripNaming(null);
    await Promise.all([load(), loadTrips()]);
    const failed = data.failed?.length ? ` (${data.failed.length} were open in another program and stayed)` : "";
    toast(`Moved ${data.moved} items to "${name}"${failed}`, {
      duration: failed ? 9000 : 6000,
      action: { label: "Open", onClick: () => setDir(data.path) },
    });
  }

  // Saves the video's sound next to it, untouched (no re-encoding).
  async function extractAudio(file) {
    toast("Extracting the sound…", { duration: 20000 });
    const res = await fetch("/api/audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.path }),
    }).catch(() => null);
    const data = res ? await readJson(res) : { error: "Can't reach the studio PC." };
    if (!res?.ok) return toast(data.error || "Couldn't extract the sound", { duration: 8000 });
    haptic("success");
    await refreshAll();
    toast(`Saved "${baseOf(data.path)}" in original quality`, {
      duration: 8000,
      action: { label: "Download", onClick: () => (window.location.href = downloadUrl({ path: data.path })) },
    });
  }

  function downloadSelected() {
    const chosen = visible.filter((f) => selected.has(f.path));
    // One file downloads as itself; several come as a single ZIP.
    const a = document.createElement("a");
    a.href = chosen.length === 1 ? downloadUrl(chosen[0]) : zipFilesUrl(chosen.map((f) => f.path));
    a.download = chosen.length === 1 ? chosen[0].name : "";
    a.click();
    toast(chosen.length === 1 ? "Downloading" : `Downloading ${chosen.length} items as one ZIP`);
    setSelected(new Set());
  }

  const openIndex = visible.findIndex((f) => f.path === openPath);
  const openFile = openIndex >= 0 ? visible[openIndex] : null;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col">
      <PullToRefresh
        disabled={selecting || Boolean(openPath) || Boolean(trimming) || Boolean(rotating)}
        onRefresh={async () => {
          await Promise.all([refreshAll(), dir ? null : loadTrips()]);
          haptic("success");
        }}
      />
      {selecting ? (
        <div className="anim-fade fixed inset-x-0 top-0 z-40 flex items-center gap-0.5 border-b border-white/[0.06] bg-zinc-950/90 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-4 lg:left-64">
          <button
            onClick={() => setSelected(new Set())}
            aria-label="Clear selection"
            className="rounded-full p-2.5 text-zinc-300 transition-colors hover:bg-white/5 max-sm:p-2"
          >
            <CloseIcon size={20} />
          </button>
          <span className="mr-auto whitespace-nowrap pl-0.5 text-[15px] font-semibold tabular-nums text-zinc-100">
            {selected.size}
            <span className="font-medium max-[400px]:hidden"> selected</span>
          </span>
          <Button variant="ghost" onClick={() => setSelected(new Set(visible.map((f) => f.path)))} className="whitespace-nowrap max-sm:h-11 max-sm:min-w-10 max-sm:px-2">
            <span className="sm:hidden">All</span>
            <span className="max-sm:hidden">Select all</span>
          </Button>
          <Button variant="ghost" onClick={downloadSelected} aria-label="Download" className="max-sm:h-11 max-sm:min-w-10 max-sm:px-2">
            <DownloadIcon size={18} />
            <span className="max-sm:hidden">Download</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const chosen = visible.filter((f) => selected.has(f.path));
              setFavorite(chosen, !chosen.every((f) => f.favorite));
              setSelected(new Set());
            }}
            aria-label="Favourite"
            className="max-sm:h-11 max-sm:min-w-10 max-sm:px-2"
          >
            {visible.filter((f) => selected.has(f.path)).every((f) => f.favorite) ? (
              <StarFilledIcon size={18} className="text-amber-300" />
            ) : (
              <StarIcon size={18} />
            )}
            <span className="max-sm:hidden">Favourite</span>
          </Button>
          <Button variant="ghost" onClick={() => setMoving([...selected])} aria-label="Move" className="max-sm:h-11 max-sm:min-w-10 max-sm:px-2">
            <MoveIcon size={18} />
            <span className="max-sm:hidden">Move</span>
          </Button>
          <Button variant="ghost" onClick={() => remove([...selected])} aria-label="Delete" className="text-red-300 hover:bg-red-500/10 max-sm:h-11 max-sm:min-w-10 max-sm:px-2">
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
              {remoteMode
                ? !remoteReady
                  ? "Searching all folders…"
                  : `${visible.length.toLocaleString()} ${favorites ? "favourite" : "result"}${visible.length === 1 ? "" : "s"} from all folders${remote.truncated ? " (showing the first 500)" : ""}`
                : files
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
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* Phone: search, sort and new folder share a row; the filter tabs get a full-width row. */}
        <div className="mt-3 flex flex-col gap-2.5 md:flex-row md:items-center lg:mt-5">
          <div className="flex items-center gap-2 md:contents">
            <label className="relative min-w-0 flex-1 md:max-w-sm">
              <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search all folders"
                className="w-full rounded-xl border border-white/[0.07] bg-white/[0.03] py-2.5 pl-9 pr-9 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/50 focus:bg-white/[0.05]"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2.5 text-zinc-500 hover:text-zinc-200"
                >
                  <CloseIcon size={15} />
                </button>
              )}
            </label>

            <div className="flex shrink-0 items-center gap-2 md:order-last">
              <label className="relative shrink-0">
                <SortIcon size={18} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-zinc-400 md:hidden" />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  aria-label="Sort"
                  className="h-11 w-11 appearance-none rounded-xl border border-white/[0.07] bg-white/[0.02] py-2 text-sm text-transparent outline-none transition-colors focus:border-violet-400/50 md:w-auto md:pl-3 md:pr-8 md:text-zinc-300 md:hover:text-zinc-100"
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
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.02] text-zinc-400 transition-colors hover:text-zinc-100 lg:hidden"
              >
                <FolderPlusIcon size={18} />
              </button>

              {files?.length > 0 && (
                <button
                  onClick={() => visible[0] && toggle(visible[0].path)}
                  aria-label="Select"
                  title="Select"
                  className="hidden rounded-xl border border-white/[0.07] bg-white/[0.02] p-2 text-zinc-400 transition-colors hover:text-zinc-100 sm:block"
                >
                  <SelectIcon size={18} />
                </button>
              )}
            </div>
          </div>

          <div className="no-scrollbar flex overflow-x-auto rounded-xl border border-white/[0.07] bg-white/[0.02] p-1 md:flex-none">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`flex-1 whitespace-nowrap rounded-lg px-2 py-2 text-sm transition-colors sm:px-3.5 md:flex-none ${
                  filter === f.id ? "bg-white/[0.09] text-zinc-50" : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {f.icon && <f.icon size={13} className={`mr-1 inline -translate-y-px ${filter === f.id ? "text-amber-300" : ""}`} />}
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <StorageBanner disk={disk} />

      {error && (
        <p className="anim-fade mx-4 mb-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-2.5 text-sm text-amber-200 sm:mx-6">
          {error}
        </p>
      )}

      <main className="flex-1 px-0.5 pb-28 sm:px-6">
        {!dir && !remoteMode && filter === "all" && (
          <TripSuggestions
            trips={trips}
            onCreate={setTripNaming}
            onDismiss={(trip) => {
              dismissTrip(trip.id);
              setTrips((list) => list.filter((t) => t.id !== trip.id));
            }}
          />
        )}
        {visibleFolders.length > 0 && (
          <section className="anim-fade mb-6 px-3 sm:px-0">
            <h2 className="mb-2.5 flex items-baseline gap-2 px-0.5 text-sm font-medium text-zinc-200 sm:px-0">
              Folders
              <span className="text-xs font-normal tabular-nums text-zinc-600">{visibleFolders.length}</span>
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {visibleFolders.map((f) => (
                <FolderCard key={f.path} folder={f} onOpen={setDir} onMenu={remoteMode ? () => setDir(f.path) : setFolderMenu} />
              ))}
            </div>
          </section>
        )}
        {(remoteMode ? !remoteReady : files === null) ? (
          <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 sm:gap-1.5 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {Array.from({ length: 21 }, (_, i) => (
              <div key={i} className="skeleton aspect-square" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          visibleFolders.length > 0 ? null : (
            <EmptyState
              searching={remoteMode || files.length + folders.length > 0}
              favorites={favorites && !searching}
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
                    key={f.path}
                    file={f}
                    selected={selected.has(f.path)}
                    selecting={selecting}
                    onOpen={setOpenPath}
                    onToggle={toggle}
                    onDragSelect={startDragSelect}
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

      {openFile && !trimming && !rotating && (
        <Viewer
          file={openFile}
          prev={visible[openIndex - 1] ?? null}
          next={visible[openIndex + 1] ?? null}
          onClose={() => setOpenPath(null)}
          onNavigate={setOpenPath}
          onRename={setRenaming}
          onDelete={remove}
          onTrim={setTrimming}
          onRotate={setRotating}
          onExtractAudio={extractAudio}
          onFavorite={setFavorite}
        />
      )}

      {rotating && (
        <RotateEditor
          file={rotating}
          onClose={() => setRotating(null)}
          onSaved={async ({ path, replaced }) => {
            setRotating(null);
            await refreshAll();
            setOpenPath(path);
            toast(replaced ? "Rotated. The original is in the Recycle Bin for 3 days." : `Saved "${baseOf(path)}"`, {
              duration: replaced ? 7000 : 5000,
            });
          }}
        />
      )}

      {trimming && (
        <TrimEditor
          file={trimming}
          onClose={() => setTrimming(null)}
          onSaved={async ({ path, replaced }) => {
            setTrimming(null);
            await refreshAll();
            setOpenPath(path);
            toast(replaced ? "Trimmed. The original is in the PC recycle folder for 3 days." : `Saved "${baseOf(path)}"`, {
              duration: replaced ? 7000 : 5000,
            });
          }}
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

      {tripNaming && (
        <NameDialog
          title="Name this trip folder"
          action={`Create & move ${tripNaming.count}`}
          initial={tripNaming.name}
          onClose={() => setTripNaming(null)}
          submit={(name) => createTrip(tripNaming, name)}
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
          onDone={async (path) => {
            setRenaming(null);
            if (openPath === renaming.path) setOpenPath(path);
            await refreshAll();
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

function EmptyState({ searching, favorites, inFolder, onUpload, onNewFolder }) {
  return (
    <div className="anim-rise flex flex-col items-center px-6 py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] text-zinc-400">
        {favorites ? <StarIcon size={26} /> : searching ? <SearchIcon size={26} /> : <MediaIcon size={28} />}
      </div>
      <p className="text-lg font-medium text-zinc-100">
        {favorites ? "No favourites yet" : searching ? "Nothing matches" : inFolder ? "This folder is empty" : "Your library is empty"}
      </p>
      <p className="mt-1.5 max-w-sm text-sm text-zinc-500">
        {favorites
          ? "Open a photo or video and tap the ☆ star to keep your best shots here."
          : searching
          ? "Nothing in any folder matches that name."
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
    onDone(data.path);
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
