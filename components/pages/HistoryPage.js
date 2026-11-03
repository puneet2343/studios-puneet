"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AppShell";
import { AlertIcon, CheckIcon, CopyIcon, FileIcon } from "@/components/icons";
import { dayTitle } from "@/components/library/MediaGrid";
import PageHeader from "@/components/shell/PageHeader";
import { formatSize } from "@/lib/format";

// Every file the phones backed up, newest first: when it arrived, from which phone, where
// it went on the PC, and what was skipped because the PC already had the exact same file.
const STATUS = {
  uploaded: { label: "Backed up", tone: "text-emerald-300 bg-emerald-300/10", icon: CheckIcon },
  already: { label: "Already on PC", tone: "text-zinc-300 bg-white/5", icon: CopyIcon },
  corrupt: { label: "Re-sent (arrived damaged)", tone: "text-amber-200 bg-amber-200/10", icon: AlertIcon },
};

function Thumb({ entry }) {
  const [failed, setFailed] = useState(false);
  const media = /\.(jpe?g|png|heic|heif|webp|gif|mp4|mov|mkv|webm|3gp|m4v)$/i.test(entry.path);
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-2">
      {media && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/thumb?name=${encodeURIComponent(entry.path)}&k=h${entry.at}`} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-600">
          <FileIcon size={20} />
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const { loggedOut } = useAuth();
  const [data, setData] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (before) => {
      const res = await fetch(`/api/sync?history=1${before ? `&before=${before}` : ""}`, { cache: "no-store" }).catch(() => null);
      if (res?.status === 401) return loggedOut();
      const d = res?.ok ? await res.json() : null;
      if (!d) return;
      const fetchedAt = Date.now();
      setData((old) => (before && old ? { ...d, fetchedAt, entries: [...old.entries, ...d.entries] } : { ...d, fetchedAt }));
    },
    [loggedOut]
  );

  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 15000);
    return () => {
      clearTimeout(t);
      clearInterval(timer);
    };
  }, [load]);

  const groups = useMemo(() => {
    const out = [];
    for (const e of data?.entries ?? []) {
      const label = dayTitle(e.at, data.fetchedAt);
      if (out.at(-1)?.label === label) out.at(-1).items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [data]);

  const t = data?.totals;
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 sm:px-6 lg:pb-12">
      <PageHeader flush title="Backup history" subtitle="Everything your phones sent to this PC" />

      {t && (
        <div className="mb-6 mt-1 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-surface p-3">
            <p className="text-xl font-semibold tabular-nums text-zinc-50">{t.uploaded.toLocaleString("en-IN")}</p>
            <p className="text-xs text-zinc-500">backed up · {formatSize(t.bytes)}</p>
          </div>
          <div className="rounded-2xl bg-surface p-3">
            <p className="text-xl font-semibold tabular-nums text-zinc-50">{t.already.toLocaleString("en-IN")}</p>
            <p className="text-xs text-zinc-500">duplicates skipped</p>
          </div>
          <div className="rounded-2xl bg-surface p-3">
            <p className="text-xl font-semibold tabular-nums text-zinc-50">{t.corrupt.toLocaleString("en-IN")}</p>
            <p className="text-xs text-zinc-500">re-sent after a damaged upload</p>
          </div>
        </div>
      )}

      {data === null ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 rounded-2xl" />
          ))}
        </div>
      ) : data.entries.length === 0 ? (
        <p className="rounded-2xl bg-surface p-5 text-sm text-zinc-500">Nothing yet. Once the Android app is set up, every photo and video it backs up is listed here.</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-2 px-1 text-sm font-semibold text-zinc-400">{g.label}</h2>
              <ul className="overflow-hidden rounded-3xl bg-surface">
                {g.items.map((e, i) => {
                  const st = STATUS[e.status] ?? STATUS.uploaded;
                  return (
                    <li key={`${e.at}-${i}`} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-0">
                      <Thumb entry={e} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium text-zinc-100">{e.name}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {new Date(e.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })} · {e.device}
                          {e.size ? ` · ${formatSize(e.size)}` : ""}
                        </p>
                        <p className="truncate text-xs text-zinc-600">{e.path.split("/").slice(0, -1).join(" › ") || "Photos"}</p>
                      </div>
                      <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${st.tone}`}>
                        <st.icon size={12} /> {st.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {data.more && (
            <button
              disabled={loadingMore}
              onClick={async () => {
                setLoadingMore(true);
                await load(data.entries.at(-1).at);
                setLoadingMore(false);
              }}
              className="h-11 w-full rounded-full border border-line text-sm text-zinc-200"
            >
              {loadingMore ? "Loading…" : "Show older"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
