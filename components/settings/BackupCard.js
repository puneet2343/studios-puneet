"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertIcon, CheckIcon, DriveIcon, RefreshIcon } from "@/components/icons";
import { formatSize } from "@/lib/format";

// Settings › Backup copy: the second copy of the library on an external drive (lib/backup.js).
function ago(t) {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

async function post(body) {
  const res = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return res ? res.json().catch(() => ({})) : { error: "Can't reach the studio PC." };
}

export default function BackupCard({ librarySize = 0 }) {
  const [s, setS] = useState(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const d = await fetch("/api/backup", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (d) setS(d);
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    const timer = setInterval(() => document.visibilityState === "visible" && load(), s?.running ? 1500 : 10000);
    return () => {
      clearTimeout(t);
      clearInterval(timer);
    };
  }, [load, s?.running]);

  if (!s) return <div className="skeleton h-28 rounded-3xl" />;

  const tone = { green: "text-emerald-300", amber: "text-amber-200", red: "text-red-300", none: "text-red-300" }[s.level];
  const headline = !s.configured
    ? "Only one copy of your photos"
    : s.running
      ? "Backing up…"
      : !s.connected
        ? "Backup drive not connected"
        : s.level === "green"
          ? "2 copies · all safe"
          : "Backup is out of date";
  const detail = !s.configured
    ? "If the PC's disk fails, the photos are gone. Plug in an external drive and set it up below."
    : s.running && s.progress
      ? `${s.progress.done} of ${s.progress.total} files · ${formatSize(s.progress.bytes)} of ${formatSize(s.progress.totalBytes)}`
      : `${s.totalFiles.toLocaleString("en-IN")} files · ${formatSize(s.totalBytes)} on ${s.drive?.label || "the drive"} · last backup ${ago(s.lastSuccessAt)}`;

  return (
    <div>
      <div className="flex items-center gap-3.5 px-4 py-4">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft ${tone}`}>
          {s.level === "green" && s.connected ? <CheckIcon size={22} strokeWidth={2.4} /> : s.configured ? <DriveIcon size={22} /> : <AlertIcon size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[17px] font-semibold ${tone}`}>{headline}</p>
          <p className="text-[13px] text-zinc-500">{detail}</p>
        </div>
        {s.configured && s.connected && (
          <button
            disabled={s.running}
            onClick={async () => {
              await post({ action: "run" });
              setTimeout(load, 500);
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#fff] active:scale-95 disabled:opacity-50"
          >
            <RefreshIcon size={15} className={s.running ? "animate-spin" : ""} /> {s.running ? "Working" : "Back up now"}
          </button>
        )}
      </div>

      {s.running && s.progress?.totalBytes > 0 && (
        <div className="mx-4 mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(100, (s.progress.bytes / s.progress.totalBytes) * 100)}%` }} />
        </div>
      )}

      {s.warnings?.length > 0 && (
        <div className="mx-4 mb-3 rounded-2xl bg-amber-200/10 p-3 text-[13px] text-amber-200">
          {s.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          {s.pendingConfirm && (
            <button
              onClick={async () => {
                await post({ action: "confirm" });
                setTimeout(load, 500);
              }}
              className="mt-2 rounded-full bg-amber-200/20 px-3 py-1.5 text-xs font-semibold"
            >
              Yes, those were deleted on purpose
            </button>
          )}
        </div>
      )}

      {/* Choose a drive (first time, or a different one) */}
      {(!s.configured || !s.connected) && (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-2 text-[13px] font-medium text-zinc-400">{s.configured ? "Use a different drive" : "Connected drives"}</p>
          {s.drives.length === 0 ? (
            <p className="text-[13px] text-zinc-500">No external drive found. Plug one in (USB hard disk or SSD, ideally at least twice the size of your library).</p>
          ) : (
            <ul className="space-y-2">
              {s.drives.map((d) => {
                const tooSmall = d.free < librarySize * 1.2;
                return (
                  <li key={d.root} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                    <DriveIcon size={20} className="shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">
                        {d.label || "Drive"} ({d.root.replace(/\\$/, "")})
                      </p>
                      <p className={`text-xs ${tooSmall ? "text-amber-200" : "text-zinc-500"}`}>
                        {formatSize(d.free)} free of {formatSize(d.size)} · {d.fs}
                        {tooSmall ? " · too small for your library" : ""}
                        {d.fs === "exFAT" ? " · NTFS is safer" : ""}
                      </p>
                    </div>
                    <button
                      disabled={tooSmall}
                      onClick={async () => {
                        const r = await post({ action: "setup", root: d.root });
                        setMessage(r.error || "Drive set up. The first backup starts now.");
                        if (!r.error) await post({ action: "run" });
                        setTimeout(load, 500);
                      }}
                      className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-zinc-100 disabled:opacity-40"
                    >
                      Use this drive
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {message && <p className="mt-2 text-[13px] text-accent">{message}</p>}
        </div>
      )}

      {s.configured && s.connected && (
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <p className="flex-1 text-[13px] text-zinc-400">
            Every file is re-checked about once a month.
            {s.lastRun?.verified ? ` Last check: ${s.lastRun.verified} files${s.lastRun.repaired ? `, ${s.lastRun.repaired} repaired` : ", all good"}.` : ""}
          </p>
          <button
            disabled={s.running}
            onClick={async () => {
              await post({ action: "verify" });
              setTimeout(load, 500);
            }}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-zinc-100 disabled:opacity-40"
          >
            Check every file now
          </button>
        </div>
      )}

      {s.configured && (
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <p className="flex-1 text-[13px] text-zinc-400">Keep deleted or changed files on the backup for</p>
          <select
            value={s.retentionDays}
            onChange={async (e) => {
              await post({ action: "retention", days: Number(e.target.value) });
              load();
            }}
            className="rounded-xl border border-line bg-surface-2 px-2 py-1.5 text-sm text-zinc-100"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>
      )}
    </div>
  );
}
