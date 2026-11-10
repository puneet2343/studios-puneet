"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Talks to the Puneet Studios Android app when this page is running inside it.
// The app adds window.PuneetApp (see android/src/.../Bridge.java) and answers slow
// questions later with a "puneetapp" event, e.g. { type: "freeable", count, bytes }.
export const inApp = () => typeof window !== "undefined" && Boolean(window.PuneetApp);

export function useInApp() {
  return useSyncExternalStore(
    () => () => {},
    () => inApp(),
    () => false
  );
}

function call(name, ...args) {
  try {
    return window.PuneetApp?.[name]?.(...args);
  } catch {
    return undefined;
  }
}

export const app = {
  status: () => {
    try {
      return JSON.parse(call("status") || "null");
    } catch {
      return null;
    }
  },
  syncNow: () => call("syncNow"),
  setWifiOnly: (on) => call("setWifiOnly", Boolean(on)),
  setPaused: (on) => call("setPaused", Boolean(on)),
  checkFreeable: () => call("checkFreeable"),
  freeUpSpace: () => call("freeUpSpace"),
  allowBackground: () => call("allowBackground"),
  allowPhotos: () => call("allowPhotos"),
  signOut: () => call("signOut"),
  signedIn: (username, password) => call("signedIn", String(username), String(password)),
  backupAll: () => call("backupAll"),
  checkUpdate: () => call("checkUpdate"),
  lockNow: () => call("lockNow"),
  setTheme: (dark) => call("setTheme", Boolean(dark)),
  setOrientation: (mode) => call("setOrientation", String(mode)),
  // A sideways video is open: the phone app turns the screen as the phone is turned.
  setWatching: (sideways) => call("setWatching", Boolean(sideways)),
};

/** Live status of this phone's syncing (refreshes every 2 s while shown). */
export function useAppStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!inApp()) return;
    const tick = () => setStatus(app.status());
    tick();
    const timer = setInterval(tick, 2000);
    return () => clearInterval(timer);
  }, []);
  return status;
}

export function useAppEvent(handler) {
  useEffect(() => {
    const listener = (e) => handler(e.detail ?? {});
    window.addEventListener("puneetapp", listener);
    return () => window.removeEventListener("puneetapp", listener);
  }, [handler]);
}
