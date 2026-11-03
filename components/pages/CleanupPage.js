"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AppShell";
import { useToast } from "@/components/Toaster";
import { CheckIcon, CopyIcon, HeartFilledIcon, SparkIcon, TrashIcon } from "@/components/icons";
import { refreshLibrary, removeFiles, restoreFiles } from "@/components/library/store";
import { thumbUrl } from "@/components/media/urls";
import PageHeader from "@/components/shell/PageHeader";
import { formatSize } from "@/lib/format";

// Best-shot cleanup: groups of the same or nearly the same photo; the best one is kept.
const TIER = {
  exact: { label: "Same file saved twice", icon: CopyIcon },
  near: { label: "Re-saved copy", icon: CopyIcon },
  burst: { label: "Shots in a row", icon: SparkIcon },
};
const when = (t) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function Group({ group, onRemoved }) {
  const toast = useToast();
  const [items, setItems] = useState(group.items);
  const [busy, setBusy] = useState(false);
  const removing = items.filter((i) => !i.keep);
  const save = removing.reduce((s, i) => s + i.size, 0);
  const T = TIER[group.tier];

  async function remove() {
    setBusy(true);
    const { ids, failed, reason } = await removeFiles(removing.map((i) => i.path));
    setBusy(false);
    if (!ids.length) return toast(reason || "Couldn't remove them. Check the connection.");
    onRemoved(group.id);
    toast(`${ids.length} moved to Recycle Bin · ${formatSize(save)} freed${failed ? ` · ${failed} couldn't be moved` : ""}`, {
      duration: 7000,
      action: { label: "Undo", onClick: () => restoreFiles(ids).then(() => toast("Put back")) },
    });
  }

  return (
    <section className="anim-fade overflow-hidden rounded-3xl bg-surface">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <T.icon size={16} className="text-accent" />
        <p className="flex-1 truncate text-sm font-semibold text-zinc-100">
          {T.label}
          {group.tier === "burst" && <span className="font-normal text-zinc-500"> · {items.length} shots</span>}
        </p>
        <span className="shrink-0 text-xs text-zinc-500">{when(group.taken)}</span>
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
        {items.map((it) => (
          <button
            key={it.path}
            onClick={() => !it.favorite && setItems((list) => list.map((x) => (x.path === it.path ? { ...x, keep: !x.keep } : x)))}
            aria-pressed={!it.keep}
            aria-label={`${it.name}: ${it.keep ? "keep" : "remove"}`}
            className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-surface-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(it)} alt="" loading="lazy" className={`h-full w-full object-cover transition ${it.keep ? "" : "opacity-60"}`} />
            {it.keep ? (
              <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-[#fff]">
                {it.favorite ? <HeartFilledIcon size={10} /> : <CheckIcon size={10} strokeWidth={3} />} {items.indexOf(it) === 0 ? "BEST" : "KEEP"}
              </span>
            ) : (
              <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-[#fff]">
                <TrashIcon size={13} />
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] font-medium text-[#fff]">{it.reason}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
        <p className="flex-1 text-xs text-zinc-500">{removing.length ? `Tap a photo to keep or remove it` : "Everything here will be kept"}</p>
        <button
          disabled={busy || !removing.length}
          onClick={remove}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#fff] active:scale-95 disabled:opacity-40"
        >
          {busy ? "Removing…" : removing.length ? `Remove ${removing.length} · ${formatSize(save)}` : "Nothing to remove"}
        </button>
      </div>
    </section>
  );
}

export default function CleanupPage() {
  const { loggedOut } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [gone, setGone] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/cleanup", { cache: "no-store" }).catch(() => null);
    if (res?.status === 401) return loggedOut();
    if (res?.ok) setData(await res.json());
  }, [loggedOut]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (!data?.progress?.working) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data?.progress?.working, load]);

  const groups = (data?.groups ?? []).filter((g) => !gone.has(g.id));
  const copies = groups.filter((g) => g.tier !== "burst");
  const copyItems = copies.flatMap((g) => g.items.filter((i) => !i.keep));
  const copyBytes = copyItems.reduce((s, i) => s + i.size, 0);
  const total = groups.reduce((s, g) => s + g.saveBytes, 0);

  // One tap for exact and re-saved copies only (bursts always get a look first).
  async function removeAllCopies() {
    setBulkBusy(true);
    const { ids, failed, reason } = await removeFiles(copyItems.map((i) => i.path));
    setBulkBusy(false);
    if (!ids.length) return toast(reason || "Couldn't remove them.");
    setGone((s) => new Set([...s, ...copies.map((g) => g.id)]));
    toast(`${ids.length} copies moved to Recycle Bin · ${formatSize(copyBytes)} freed${failed ? ` · ${failed} couldn't be moved` : ""}`, {
      duration: 8000,
      action: { label: "Undo", onClick: () => restoreFiles(ids).then(() => (setGone(new Set()), load(), refreshLibrary())) },
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 sm:px-6 lg:pb-12">
      <PageHeader flush title="Clean up" subtitle={data ? (groups.length ? `${groups.length} groups · up to ${formatSize(total)} to free` : "Nothing to clean up") : "Looking…"} />

      {data?.progress?.working && (
        <p className="mb-4 rounded-2xl bg-accent-soft px-4 py-3 text-[13px] text-zinc-300">
          Checking how sharp each photo is… {data.progress.done} of {data.progress.total}. More groups may appear.
        </p>
      )}

      {copyItems.length > 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-3xl bg-gradient-to-br from-[#ff9a5a]/15 via-[#f0457f]/10 to-[#6a5cf0]/15 p-4">
          <CopyIcon size={22} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-zinc-50">{copyItems.length} extra copies of the same photos</p>
            <p className="text-[13px] text-zinc-500">Identical or re-saved files. One of each is kept.</p>
          </div>
          <button disabled={bulkBusy} onClick={removeAllCopies} className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#fff] active:scale-95 disabled:opacity-50">
            {bulkBusy ? "Removing…" : `Free ${formatSize(copyBytes)}`}
          </button>
        </div>
      )}

      {data === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-48 rounded-3xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-3xl bg-surface p-6 text-center">
          <p className="text-lg font-semibold text-zinc-50">All tidy</p>
          <p className="mt-1 text-sm text-zinc-500">No repeated or near-identical photos found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Group key={g.id} group={g} onRemoved={(id) => setGone((s) => new Set([...s, id]))} />
          ))}
        </div>
      )}
      <p className="mt-6 text-center text-xs text-zinc-500">Removed photos go to the Recycle Bin for 3 days. Favourites are always kept.</p>
    </div>
  );
}
