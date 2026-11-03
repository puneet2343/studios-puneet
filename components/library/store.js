"use client";

import { useEffect, useSyncExternalStore } from "react";
import { actionUrl } from "@/components/media/urls";

// The whole library, shared by Photos, Albums and Map (GET /api/library).
// Opens instantly from the last copy saved on the phone, then refreshes: every 20 s while
// the app is open, right away when it comes back to the screen, and every few seconds
// while the PC is still reading dates/places of new files.
const CACHE_KEY = "ps.library.v1";
const EMPTY = { files: null, folders: [], disk: null, pending: 0, error: "", loadedAt: 0 };

let state = EMPTY;
let started = false;
let timer = null;
let onUnauthorized = () => {};
const listeners = new Set();
const hidden = new Set(); // deleted on this phone, until the PC agrees

function set(next) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function readCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (data?.files) set({ files: data.files, folders: data.folders ?? [], disk: data.disk ?? null });
  } catch {}
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ files: data.files, folders: data.folders, disk: data.disk }));
  } catch {
    // Phone storage full or blocked: the app still works, it just opens a moment slower.
  }
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export function clearLibraryCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
  state = EMPTY;
}

export async function refreshLibrary() {
  try {
    const res = await fetch("/api/library", { cache: "no-store" });
    if (res.status === 401) return onUnauthorized();
    if (!res.ok) throw new Error();
    const data = await res.json();
    const files = data.files.filter((f) => !hidden.has(f.path));
    set({ files, folders: data.folders, disk: data.disk, pending: data.pending, error: "", loadedAt: Date.now() });
    writeCache({ ...data, files });
  } catch {
    set({ error: "Can't reach the studio PC right now. Retrying…" });
  }
  schedule();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (document.visibilityState === "visible") refreshLibrary();
    else schedule();
  }, state.pending ? 4000 : 20000);
}

function start() {
  if (started) return;
  started = true;
  readCache();
  refreshLibrary();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshLibrary());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLibrary() {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

// ----- Changes (optimistic: the screen updates at once, then the PC is told) -----
const json = (res) => res.json().catch(() => ({}));

/** Moves files to the PC's Recycle Bin. Returns { ids, failed, reason } (ids can be restored). */
export async function removeFiles(paths) {
  paths.forEach((p) => hidden.add(p));
  set({ files: state.files?.filter((f) => !paths.includes(f.path)) });
  const results = await Promise.all(
    paths.map((p) =>
      fetch(actionUrl(p), { method: "DELETE" })
        .then(json)
        .catch(() => ({ error: "Can't reach the studio PC. Check your connection and try again." }))
    )
  );
  paths.forEach((p) => hidden.delete(p));
  refreshLibrary();
  const failed = results.filter((r) => !r.trashId);
  return { ids: results.map((r) => r.trashId).filter(Boolean), failed: failed.length, reason: failed[0]?.error || "" };
}

export async function restoreFiles(ids) {
  await fetch("/api/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
  await refreshLibrary();
}

export async function setFavorite(list, on) {
  const keys = new Set(list.map((f) => f.key));
  set({ files: state.files?.map((f) => (keys.has(f.key) ? { ...f, favorite: on || undefined } : f)) });
  const res = await fetch("/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: [...keys], on }),
  }).catch(() => null);
  if (!res?.ok) refreshLibrary();
  return Boolean(res?.ok);
}

/** Moves files into an album (folder path; "" = no album). Returns how many moved. */
export async function moveFiles(paths, folder) {
  let moved = 0;
  let reason = "";
  for (const p of paths) {
    const res = await fetch(actionUrl(p), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moveTo: folder }) }).catch(() => null);
    if (res?.ok) moved++;
    else reason ||= res ? (await json(res)).error : "Can't reach the studio PC.";
  }
  await refreshLibrary();
  return { moved, reason };
}

export async function renamePath(path, newName) {
  const res = await fetch(actionUrl(path), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newName }) }).catch(() => null);
  const data = res ? await json(res) : { error: "Can't reach the studio PC." };
  await refreshLibrary();
  return res?.ok ? { path: data.path } : { error: data.error || "Couldn't rename" };
}

export async function createAlbum(name) {
  const res = await fetch(`/api/files?folder=${encodeURIComponent(name)}`, { method: "POST" }).catch(() => null);
  const data = res ? await json(res) : { error: "Can't reach the studio PC." };
  await refreshLibrary();
  return res?.ok ? { path: data.path } : { error: data.error || "Couldn't create the album" };
}

export async function deleteAlbum(path) {
  const res = await fetch(actionUrl(path), { method: "DELETE" }).catch(() => null);
  const data = res ? await json(res) : { error: "Can't reach the studio PC." };
  await refreshLibrary();
  return res?.ok ? { trashId: data.trashId } : { error: data.error || "Couldn't delete the album" };
}

// ----- Helpers -----
export const folderOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Albums: every folder that holds photos/videos (directly), newest first, with a cover. */
export function albumsFrom(files, folders) {
  const byFolder = new Map((folders ?? []).map((f) => [f.path, { path: f.path, name: f.name, items: [] }]));
  for (const f of files ?? []) {
    const dir = folderOf(f.path);
    if (dir && byFolder.has(dir)) byFolder.get(dir).items.push(f);
  }
  return [...byFolder.values()]
    .filter((a) => a.items.length || !a.path.includes("/")) // empty top-level albums still show
    .map((a) => ({
      ...a,
      count: a.items.length,
      cover: a.items.find((f) => f.kind === "image" || f.kind === "video") ?? null,
      latest: a.items[0]?.taken ?? 0,
      parent: folderOf(a.path),
    }))
    .sort((a, b) => b.latest - a.latest);
}
