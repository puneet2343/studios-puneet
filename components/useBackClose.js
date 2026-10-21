"use client";

import { useEffect, useRef } from "react";

// Makes the phone's Back button close overlays (viewer, menus, dialogs, selection,
// search…) instead of leaving the app. Each open overlay pushes a history entry; Back
// pops only the top-most one, so nested overlays close one at a time.
//
// With nothing open, Back on the app's first screen asks "Press back again to exit"
// (useExitGuard) instead of closing the app straight away.
const stack = [];
let ignorePops = 0;
let listening = false;
let guard = null; // { onFirstPress } while the exit guard is on
let baseId = null; // tags the app's first history entry (below the guard = leaving the app)
let armedUntil = 0;
let rearm = null;
// Overlays closed from the UI give back their history entries a moment later, unless
// another overlay opens in the same instant (menu item -> sheet): that one takes over
// the entry instead. Going back and forward at once makes Chrome drop the "back", which
// used to leave the next Back press doing nothing.
let releasing = []; // ids of entries waiting to be given back (top of history last)
let releaseTimer = null;

// `below`: the entry sits under ones already being given back (closing together).
function scheduleRelease(id, below = false) {
  if (below) releasing.unshift(id);
  else releasing.push(id);
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    const ids = releasing;
    releasing = [];
    if (!ids.includes(window.history.state?.__psOverlay)) return; // user navigated away meanwhile
    ignorePops++;
    window.history.go(-ids.length);
  }, 0);
}

const isGuardState = (state) => Boolean(state?.__psGuard);

function pushGuard() {
  if (!isGuardState(window.history.state)) window.history.pushState({ ...window.history.state, __psGuard: true }, "");
}

function onPopState(event) {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = stack.pop();
  if (top) {
    top.popped = true;
    top.close();
    return;
  }
  // Nothing open and we're back on the app's very first entry: that's "leave the app".
  // (If the tag was lost, this simply never triggers and Back behaves as normal.)
  if (guard && baseId && event.state?.__psBaseId === baseId && !isGuardState(event.state) && !stack.length) {
    if (Date.now() < armedUntil) return; // second press: let Android close the app
    armedUntil = Date.now() + 2000;
    guard.onFirstPress?.();
    // Not pressed again in time: put the guard back for next time.
    clearTimeout(rearm);
    rearm = setTimeout(() => {
      if (guard && document.visibilityState === "visible") pushGuard();
    }, 2000);
  }
}

function listen() {
  if (!listening) {
    window.addEventListener("popstate", onPopState);
    listening = true;
  }
}

export default function useBackClose(open, onClose) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    listen();
    const entry = { id: Math.random().toString(36).slice(2), popped: false, close: () => closeRef.current() };
    stack.push(entry);
    const handover = releasing.length && window.history.state?.__psOverlay === releasing.at(-1);
    if (handover) {
      releasing.pop();
      if (!releasing.length) clearTimeout(releaseTimer);
      window.history.replaceState({ ...window.history.state, __psOverlay: entry.id }, "");
    } else {
      window.history.pushState({ ...window.history.state, __psOverlay: entry.id }, "");
    }

    return () => {
      const index = stack.indexOf(entry);
      if (index !== -1) stack.splice(index, 1);
      // Closed from the UI rather than Back: remove the history entry we added —
      // unless the user navigated to another page meanwhile, in which case leave history alone.
      const top = window.history.state?.__psOverlay;
      if (!entry.popped && top === entry.id) scheduleRelease(entry.id);
      else if (!entry.popped && releasing.includes(top)) scheduleRelease(entry.id, true);
    };
  }, [open]);
}

// Closes every open overlay's history entry first, then runs `then` (e.g. a page change),
// so no stale "open" entries are left behind for Back to trip over.
export function closeOverlaysThen(then) {
  const ours = stack.filter((e) => !e.popped).length;
  if (!ours) return then();
  const done = () => {
    window.removeEventListener("popstate", done);
    setTimeout(then, 0);
  };
  window.addEventListener("popstate", done);
  for (const entry of [...stack]) {
    entry.popped = true;
    entry.close();
  }
  stack.length = 0;
  ignorePops++;
  window.history.go(-ours);
}

// On the app's main screens: the first Back with nothing open shows a hint, the second exits.
export function useExitGuard(enabled, onFirstPress) {
  const cb = useRef(onFirstPress);
  useEffect(() => {
    cb.current = onFirstPress;
  }, [onFirstPress]);

  useEffect(() => {
    if (!enabled) return;
    listen();
    guard = { onFirstPress: () => cb.current?.() };
    // Tag the first entry once (after Next.js has set it up), then sit a guard on top.
    if (!baseId) {
      baseId = window.history.state?.__psBaseId || Math.random().toString(36).slice(2);
      if (!window.history.state?.__psBaseId) window.history.replaceState({ ...window.history.state, __psBaseId: baseId }, "");
    }
    if (window.history.state?.__psBaseId === baseId) pushGuard();
    return () => {
      guard = null;
      clearTimeout(rearm);
    };
  }, [enabled]);
}
