"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AppShell";
import { Button } from "@/components/Dialog";
import { useToast } from "@/components/Toaster";
import { FileIcon, FolderIcon, ImageIcon, MusicIcon, PlayIcon, ReplayIcon, TrashIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/media/Folders";
import { formatSize } from "@/lib/format";

const DAY = 24 * 60 * 60 * 1000;

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function left(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "removing soon";
  if (ms < DAY) return "less than a day left";
  const d = Math.ceil(ms / DAY);
  return `${d} day${d === 1 ? "" : "s"} left`;
}

function Thumb({ item }) {
  const [failed, setFailed] = useState(false);
  if ((item.kind === "image" || item.kind === "video") && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/thumb?trash=${encodeURIComponent(item.id)}&k=${item.key}`}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    );
  }
  const Icon = item.kind === "folder" ? FolderIcon : item.kind === "audio" ? MusicIcon : item.kind === "video" ? PlayIcon : item.kind === "image" ? ImageIcon : FileIcon;
  return (
    <div className={`flex h-full w-full items-center justify-center ${item.kind === "folder" ? "bg-violet-500/10 text-violet-300" : "text-zinc-500"}`}>
      <Icon size={22} />
    </div>
  );
}

export default function RecycleBin() {
  const { loggedOut } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [confirm, setConfirm] = useState(null); // { ids, all, label }
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/trash", { cache: "no-store" }).catch(() => null);
    if (res?.status === 401) return loggedOut();
    const data = res?.ok ? await res.json() : null;
    if (data) setItems(data.items);
  }, [loggedOut]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  async function restore(list) {
    setBusy(list.length === 1 ? list[0].id : "all");
    const res = await fetch("/api/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: list.map((i) => i.id) }),
    }).catch(() => null);
    const data = res?.ok ? await res.json() : null;
    setBusy(null);
    await load();
    if (!data) return toast("Couldn't restore. Check the connection.");
    if (data.restored.length < list.length) {
      return toast(`Restored ${data.restored.length} of ${list.length}. The rest may be open in another program on the PC.`, { duration: 8000 });
    }
    if (list.length === 1) {
      const where = list[0].from ? list[0].from.replaceAll("/", " › ") : "Media";
      toast(`Restored to ${where}`);
    } else toast(`Restored ${list.length} items`);
  }

  async function purge({ ids, all }) {
    setConfirm(null);
    const res = await fetch("/api/trash", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(all ? { all: true } : { ids }),
    }).catch(() => null);
    await load();
    toast(res?.ok ? "Deleted forever" : "Couldn't delete. Check the connection.");
  }

  const total = (items ?? []).reduce((sum, i) => sum + (i.size || 0), 0);

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 pb-32 pt-4 sm:px-6 lg:pb-12 lg:pt-8">
      <header className="mb-5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">Recycle Bin</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {items?.length
              ? `${items.length} item${items.length === 1 ? "" : "s"} · ${formatSize(total)} · kept for 3 days, then removed for good`
              : "Deleted items are kept here for 3 days, then removed for good."}
          </p>
        </div>
      </header>

      {items?.length > 1 && (
        <div className="anim-fade mb-4 grid grid-cols-2 gap-2">
          <Button onClick={() => restore(items)} disabled={Boolean(busy)} className="h-11">
            <ReplayIcon size={16} />
            Restore all
          </Button>
          <Button
            onClick={() => setConfirm({ all: true, label: `all ${items.length} items` })}
            className="h-11 text-red-300 hover:bg-red-500/10"
          >
            <TrashIcon size={16} />
            Empty bin
          </Button>
        </div>
      )}

      {items === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-20 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="anim-rise flex flex-col items-center px-6 py-20 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] text-zinc-400">
            <TrashIcon size={26} />
          </div>
          <p className="text-lg font-medium text-zinc-100">Recycle Bin is empty</p>
          <p className="mt-1.5 max-w-sm text-sm text-zinc-500">Anything you delete shows up here for 3 days, so you can bring it back.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            // Phone: details on top, buttons underneath, so the name has room. Wider screens: one row.
            <li key={item.id} className="anim-fade flex flex-col gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-zinc-900">
                  <Thumb item={item} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">{item.name}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {item.kind === "folder" ? `Folder · ${item.count} item${item.count === 1 ? "" : "s"}` : formatSize(item.size)}
                    {" · from "}
                    {item.from ? item.from.replaceAll("/", " › ") : "Media"}
                  </p>
                  <p className="truncate text-xs text-zinc-600">
                    Deleted {ago(item.deletedAt)} · {left(item.expiresAt)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => restore([item])}
                  disabled={Boolean(busy)}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 text-sm font-semibold text-zinc-950 transition-transform active:scale-95 disabled:opacity-50 sm:flex-none"
                >
                  <ReplayIcon size={15} strokeWidth={2.2} />
                  {busy === item.id ? "Restoring…" : "Restore"}
                </button>
                <button
                  onClick={() => setConfirm({ ids: [item.id], label: `"${item.name}"` })}
                  aria-label={`Delete ${item.name} forever`}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-white/[0.07] px-3 text-sm text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-300 active:bg-red-500/10"
                >
                  <TrashIcon size={17} />
                  <span className="sm:hidden">Delete forever</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <ConfirmDialog
          title="Delete forever?"
          message={`This permanently removes ${confirm.label} from the studio PC. It can't be undone.`}
          action="Delete forever"
          onClose={() => setConfirm(null)}
          onConfirm={() => purge(confirm)}
        />
      )}
    </div>
  );
}
