"use client";

import { useEffect, useRef } from "react";

// Makes the phone's Back button close overlays (viewer, menu, dialogs, selection)
// instead of leaving the app. Each open overlay pushes a history entry; Back pops
// only the top-most one, so nested overlays close one at a time.
const stack = [];
let ignorePops = 0;
let listening = false;

function onPopState() {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = stack.pop();
  if (top) {
    top.popped = true;
    top.close();
  }
}

export default function useBackClose(open, onClose) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    if (!listening) {
      window.addEventListener("popstate", onPopState);
      listening = true;
    }
    const entry = { id: Math.random().toString(36).slice(2), popped: false, close: () => closeRef.current() };
    stack.push(entry);
    window.history.pushState({ ...window.history.state, __psOverlay: entry.id }, "");

    return () => {
      const index = stack.indexOf(entry);
      if (index !== -1) stack.splice(index, 1);
      // Closed from the UI rather than Back: remove the history entry we added —
      // unless the user navigated to another page meanwhile, in which case leave history alone.
      if (!entry.popped && window.history.state?.__psOverlay === entry.id) {
        ignorePops++;
        window.history.back();
      }
    };
  }, [open]);
}
