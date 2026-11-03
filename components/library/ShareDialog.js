"use client";

import { useCallback, useEffect, useState } from "react";
import Dialog, { Button } from "@/components/Dialog";
import { useToast } from "@/components/Toaster";

// Share an album: makes a private link (lib/shares.js). Whoever has the link sees this album
// and can download the originals, untouched; nothing else in the library. Stop any time.
const CHOICES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: null, label: "No end" },
];

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  }
}

export default function ShareDialog({ album, title, onClose }) {
  const toast = useToast();
  const [shares, setShares] = useState(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch(`/api/shares?album=${encodeURIComponent(album)}`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    setShares(d?.shares ?? []);
  }, [album]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const share = shares?.[0];
  const link = share ? `${window.location.origin}/api/share/${share.token}` : "";

  async function create() {
    setBusy(true);
    const res = await fetch("/api/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ album, days }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast("Couldn't make the link. Check the connection.");
    const made = await res.json();
    setShares([made]);
    if (await copy(`${window.location.origin}/api/share/${made.token}`)) toast("Link copied");
  }

  async function stop() {
    setBusy(true);
    await Promise.all((shares ?? []).map((s) => fetch(`/api/shares?token=${s.token}`, { method: "DELETE" }).catch(() => null)));
    setBusy(false);
    setShares([]);
    toast("Sharing stopped. The old link no longer works.");
  }

  return (
    <Dialog
      title={`Share "${title}"`}
      onClose={onClose}
      footer={
        share ? (
          <>
            <Button variant="danger" disabled={busy} onClick={stop}>
              Stop sharing
            </Button>
            <Button variant="primary" onClick={() => copy(link).then((ok) => toast(ok ? "Link copied" : "Couldn't copy. Press and hold the link to copy it."))}>
              Copy link
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || shares === null} onClick={create}>
              {busy ? "Making link…" : "Create link"}
            </Button>
          </>
        )
      }
    >
      {shares === null ? (
        <div className="skeleton h-24 rounded-2xl" />
      ) : share ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">Anyone with this link can see this album and download the photos and videos in full original quality. They can&apos;t see anything else.</p>
          <p className="select-all break-all rounded-2xl bg-white/5 px-4 py-3 font-mono text-[13px] text-zinc-100">{link}</p>
          <p className="text-xs text-zinc-500">
            {share.expires ? `Works until ${new Date(share.expires).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}.` : "Works until you stop sharing."} Opens on devices connected to your
            Tailscale.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">Make a private link to this album. Whoever has it can see the photos and videos and download the originals. Nothing else in your library is shared.</p>
          <div>
            <p className="mb-2 text-xs font-medium text-zinc-500">Link works for</p>
            <div className="flex gap-2">
              {CHOICES.map((c) => (
                <button
                  key={c.label}
                  onClick={() => setDays(c.days)}
                  className={`h-10 flex-1 rounded-full border text-sm font-medium transition-colors ${days === c.days ? "border-transparent bg-accent-soft text-accent" : "border-line text-zinc-300 hover:bg-white/5"}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
