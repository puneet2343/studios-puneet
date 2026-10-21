"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AppShell";
import { useToast } from "@/components/Toaster";
import { CheckIcon, CopyIcon, FileIcon, MusicIcon, RefreshIcon, StarFilledIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/media/Folders";
import { actionUrl, thumbUrl } from "@/components/media/urls";
import { formatDateTime, formatSize } from "@/lib/format";

const where = (path) => (path.includes("/") ? path.split("/").slice(0, -1).join(" › ") : "Media");

function Copy({ file, keep, onKeep }) {
  const [failed, setFailed] = useState(false);
  const visual = (file.kind === "image" || file.kind === "video") && !failed;
  return (
    <button
      onClick={onKeep}
      aria-pressed={keep}
      className={`relative w-[132px] shrink-0 snap-start overflow-hidden rounded-xl border text-left transition-[border-color,opacity] ${
        keep ? "border-emerald-400/70" : "border-white/[0.07] opacity-75"
      }`}
    >
      <div className="relative aspect-square bg-zinc-900">
        {visual ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl(file)} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-500">
            {file.kind === "audio" ? <MusicIcon size={24} /> : <FileIcon size={24} />}
          </div>
        )}
        <span
          className={`absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            keep ? "bg-emerald-500 text-[#fff]" : "bg-black/55 text-[#fff]/80 backdrop-blur-sm"
          }`}
        >
          {keep ? (
            <>
              <CheckIcon size={11} strokeWidth={3} /> Keep
            </>
          ) : (
            "Remove"
          )}
        </span>
        {file.favorite && (
          <span className="absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-amber-300">
            <StarFilledIcon size={11} />
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="truncate text-xs font-medium text-zinc-100">{file.name}</p>
        <p className="truncate text-[11px] text-zinc-500">in {where(file.path)}</p>
        <p className="truncate text-[11px] text-zinc-600">{formatDateTime(file.modified)}</p>
      </div>
    </button>
  );
}

export default function Duplicates() {
  const { loggedOut } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [keep, setKeep] = useState({}); // group id -> path to keep (overrides the suggestion)
  const [confirm, setConfirm] = useState(null); // groups to clean
  const [scanning, setScanning] = useState(true);

  const scan = useCallback(async () => {
    setScanning(true);
    const res = await fetch("/api/duplicates", { cache: "no-store" }).catch(() => null);
    if (res?.status === 401) return loggedOut();
    setScanning(false);
    if (res?.ok) setData(await res.json());
    else toast("Couldn't scan the library. Check the connection.");
  }, [loggedOut, toast]);

  useEffect(() => {
    const first = setTimeout(scan, 0);
    return () => clearTimeout(first);
  }, [scan]);

  const keeperOf = (g) => keep[g.id] ?? g.keep;
  const extras = (groups) => groups.flatMap((g) => g.files.filter((f) => f.path !== keeperOf(g)));
  const groups = data?.groups ?? [];
  const allExtras = extras(groups);
  const freeable = allExtras.reduce((sum, f) => sum + f.size, 0);

  // Extra copies go to the Recycle Bin (restorable for 3 days), never straight to deletion.
  async function clean(list) {
    setConfirm(null);
    const files = extras(list);
    const results = await Promise.all(
      files.map((f) =>
        fetch(actionUrl(f.path), { method: "DELETE" })
          .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }))
          .catch(() => ({ ok: false, error: "Can't reach the studio PC." }))
      )
    );
    const done = results.filter((r) => r.ok).length;
    const failed = results.find((r) => !r.ok);
    toast(
      `Moved ${done} extra cop${done === 1 ? "y" : "ies"} to the Recycle Bin${failed ? `. ${results.length - done} failed: ${failed.error}` : ""}`,
      { duration: failed ? 9000 : 5000 }
    );
    scan();
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 pb-32 pt-4 sm:px-6 lg:pb-12 lg:pt-8">
      <header className="mb-5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">Duplicates</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Identical files anywhere in your library, matched by their contents, not their names.</p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          aria-label="Scan again"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-50"
        >
          <RefreshIcon size={18} className={scanning ? "animate-spin" : ""} />
        </button>
      </header>

      {scanning && !data ? (
        <div className="anim-fade flex flex-col items-center py-20 text-center">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-[3px] border-white/15 border-t-violet-400" />
          <p className="text-sm text-zinc-300">Checking every file in your library…</p>
          <p className="mt-1 text-xs text-zinc-600">The first scan of big videos can take a minute. Later scans are quick.</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="anim-rise flex flex-col items-center px-6 py-20 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/5 text-emerald-300">
            <CheckIcon size={28} strokeWidth={2.2} />
          </div>
          <p className="text-lg font-medium text-zinc-100">No duplicates</p>
          <p className="mt-1.5 max-w-sm text-sm text-zinc-500">Checked {data?.scanned ?? 0} files. Every one is unique.</p>
        </div>
      ) : (
        <>
          <div className="anim-fade mb-5 flex items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
              <CopyIcon size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100">
                {groups.length} set{groups.length === 1 ? "" : "s"} of duplicates · {formatSize(freeable)} can be freed
              </p>
              <p className="text-xs text-zinc-500">Tap a copy to choose which one to keep.</p>
            </div>
          </div>
          <button
            onClick={() => setConfirm(groups)}
            className="mb-6 flex h-12 w-full items-center justify-center rounded-xl bg-white text-sm font-semibold text-zinc-950 transition-transform active:scale-[0.98]"
          >
            Remove all {allExtras.length} extra cop{allExtras.length === 1 ? "y" : "ies"}
          </button>

          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.id} className="anim-fade rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
                  <p className="text-sm text-zinc-300">
                    <span className="font-semibold text-zinc-100">{g.files.length} copies</span> · {formatSize(g.size)} each
                  </p>
                  <button
                    onClick={() => setConfirm([g])}
                    className="h-9 shrink-0 rounded-lg px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 active:bg-red-500/10"
                  >
                    Remove {g.files.length - 1}
                  </button>
                </div>
                <div className="no-scrollbar -mx-3 flex snap-x gap-2 overflow-x-auto px-3">
                  {g.files.map((f) => (
                    <Copy key={f.path} file={f} keep={f.path === keeperOf(g)} onKeep={() => setKeep((k) => ({ ...k, [g.id]: f.path }))} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {confirm && (
        <ConfirmDialog
          title={`Remove ${extras(confirm).length} extra cop${extras(confirm).length === 1 ? "y" : "ies"}?`}
          message="They go to the Recycle Bin, so you can still restore them for 3 days. The copies marked Keep stay where they are."
          action="Move to Recycle Bin"
          onClose={() => setConfirm(null)}
          onConfirm={() => clean(confirm)}
        />
      )}
    </div>
  );
}
