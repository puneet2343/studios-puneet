"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toaster";
import { AlertIcon, CloseIcon } from "@/components/icons";
import { formatSize } from "@/lib/format";
import { storageLevel } from "@/lib/storage-levels";
import { haptic } from "@/lib/haptics";

const DISMISS_KEY = "ps.storage.dismissed";

function keyBytes(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** "Notify this phone when the studio PC runs low on space" switch (More → Storage). */
export function StorageAlertsSwitch() {
  const toast = useToast();
  const [state, setState] = useState("checking"); // checking | off | on | blocked | unsupported | busy

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supported()) return live && setState("unsupported");
      if (Notification.permission === "denied") return live && setState("blocked");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return live && setState("off");
      const info = await fetch(`/api/storage?endpoint=${encodeURIComponent(sub.endpoint)}`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);
      if (live) setState(info?.subscribed ? "on" : "off");
    })();
    return () => {
      live = false;
    };
  }, []);

  async function turnOn() {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await fetch("/api/storage", { cache: "no-store" }).then((r) => r.json());
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const res = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error();
      setState("on");
      haptic("success");
      toast("Storage alerts on for this phone");
    } catch {
      setState("off");
      toast("Couldn't turn on notifications. Is the app installed on your home screen?");
    }
  }

  async function turnOff() {
    setState("busy");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/storage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    setState("off");
  }

  async function test() {
    const res = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    }).catch(() => null);
    const data = res?.ok ? await res.json() : null;
    toast(data?.sent ? "Test sent. It should pop up in a moment." : "Couldn't send the test. Check the connection.");
  }

  const on = state === "on";
  const note = {
    unsupported: "This browser can't show notifications. Install the app to your home screen first.",
    blocked: "Notifications are blocked for this app. Allow them in your phone's Settings → Apps → Puneet Studios → Notifications.",
  }[state];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">Low-space alerts</p>
          <p className="text-xs text-zinc-500">Notify this phone when the studio PC is running out of space</p>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="Low-space alerts"
          disabled={state === "checking" || state === "busy" || state === "unsupported" || state === "blocked"}
          onClick={on ? turnOff : turnOn}
          className={`relative h-7 w-12 shrink-0 rounded-full before:absolute before:-inset-2.5 before:content-[""] transition-colors duration-200 disabled:opacity-40 ${on ? "bg-violet-500" : "bg-white/15"}`}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-[#fff] shadow transition-[left] duration-200 ${on ? "left-[1.375rem]" : "left-0.5"}`} />
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-amber-200">{note}</p>}
      {on && (
        <button onClick={test} className="mt-2 text-xs font-medium text-violet-300">
          Send a test notification
        </button>
      )}
    </div>
  );
}

/** Banner on the Media page while the PC is low (yellow) or nearly full (red). */
export function StorageBanner({ disk }) {
  const level = storageLevel(disk);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });
  if (level === "ok" || dismissed === level) return null;
  const critical = level === "critical";
  return (
    <div
      role="status"
      className={`anim-fade mx-4 mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 sm:mx-6 ${
        critical ? "border-red-400/30 bg-red-500/10" : "border-amber-400/25 bg-amber-400/[0.07]"
      }`}
    >
      <AlertIcon size={18} className={`mt-0.5 shrink-0 ${critical ? "text-red-300" : "text-amber-200"}`} />
      <div className="min-w-0 flex-1 text-sm">
        <p className={`font-semibold ${critical ? "text-red-300" : "text-amber-200"}`}>
          {critical ? "Studio PC is almost full" : "Studio PC is running low on space"}
        </p>
        <p className="mt-0.5 text-zinc-400">
          {formatSize(disk.free)} left of {formatSize(disk.total)}. Empty the Recycle Bin or remove duplicates (More tab) to free space.
        </p>
      </div>
      <button
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, level);
          } catch {}
          setDismissed(level);
        }}
        aria-label="Hide"
        className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
