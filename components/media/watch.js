"use client";

import { useSyncExternalStore } from "react";

// What's playing, for the whole app (like YouTube): the watch page, or the mini player once
// it's swiped down. Lives outside the pages, so the video keeps playing while you move
// between Photos, Albums and Map. Rendered by components/media/WatchHost.js in AppShell.
let state = { file: null, items: [], mini: false, tools: null };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const set = (patch) => {
  state = { ...state, ...patch };
  emit();
};
const EMPTY = { file: null, items: [], mini: false, tools: null };

export const watch = {
  /** Open a video full size; `items` is the list it came from (for Up next). */
  open(file, items) {
    set({ file, items: items?.length ? items : state.items, mini: false });
  },
  /** Another video from the same list. */
  go(path) {
    const f = state.items.find((x) => x.path === path);
    if (f) set({ file: f });
  },
  /** The video was renamed: follow it to its new name. */
  renamed(from, to) {
    if (state.file?.path !== from) return;
    const moved = (f) => (f.path === from ? { ...f, path: to, name: to.split("/").pop() } : f);
    set({ file: moved(state.file), items: state.items.map(moved) });
  },
  minimize() {
    if (state.file && !state.mini) set({ mini: true });
  },
  expand() {
    if (state.file && state.mini) set({ mini: false });
  },
  close() {
    if (state.file) set({ file: null, mini: false });
  },
};

export function useWatch() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => EMPTY
  );
}

// Rename / Trim / Rotate / Save sound / Add to album open dialogs that belong to the page
// you're on (MediaBrowser). The page registers them here while it's showing; on a page
// without them (Map, Settings) those buttons are simply hidden.
export function setWatchTools(next) {
  set({ tools: next });
  return () => {
    if (state.tools === next) set({ tools: null });
  };
}
