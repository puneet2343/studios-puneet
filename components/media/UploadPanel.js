"use client";

import { useState } from "react";
import { CheckIcon, ChevronDownIcon, CloseIcon } from "@/components/icons";
import { formatEta, formatSize } from "@/lib/format";

export default function UploadPanel({ items, speed, active, onCancel, onClear, onAdd }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!items.length) return null;

  const live = items.filter((it) => it.status !== "cancelled");
  const total = live.reduce((sum, it) => sum + it.file.size, 0);
  const loaded = live.reduce((sum, it) => sum + it.loaded, 0);
  const done = live.filter((it) => it.status === "done").length;
  const errors = live.filter((it) => it.status === "error").length;
  const pct = total ? (loaded / total) * 100 : 100;

  const title = active
    ? `Uploading ${Math.min(done + 1, live.length)} of ${live.length}`
    : errors
      ? `${errors} upload${errors > 1 ? "s" : ""} failed`
      : `${done} upload${done === 1 ? "" : "s"} complete`;
  const subtitle = active
    ? [speed > 0 && `${formatSize(speed)}/s`, speed > 0 && formatEta((total - loaded) / speed)].filter(Boolean).join(" · ") ||
      "Starting…"
    : formatSize(total);

  return (
    <div className="anim-sheet fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl shadow-black/40 backdrop-blur-xl sm:inset-x-auto sm:right-4 sm:w-[380px] lg:bottom-5 lg:right-5">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="relative h-9 w-9 shrink-0">
          <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-white/[0.08]" />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke={errors && !active ? "#f87171" : "url(#upload-grad)"}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 94.25} 94.25`}
              className="transition-[stroke-dasharray] duration-500"
            />
            <defs>
              <linearGradient id="upload-grad">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
          </svg>
          {!active && !errors && (
            <CheckIcon size={15} strokeWidth={2.6} className="anim-pop absolute inset-0 m-auto text-sky-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{title}</p>
          <p className="truncate text-xs tabular-nums text-zinc-500">{subtitle}</p>
        </div>
        {onAdd && (
          <button
            onClick={onAdd}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5 active:scale-95"
          >
            Add more
          </button>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand" : "Collapse"}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
        >
          <ChevronDownIcon size={18} className={`transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} />
        </button>
        {!active && (
          <button
            onClick={onClear}
            aria-label="Dismiss"
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
          >
            <CloseIcon size={18} />
          </button>
        )}
      </div>

      {!collapsed && (
        <ul className="max-h-64 overflow-y-auto border-t border-white/[0.06] py-1">
          {items.map((it) => {
            const itemPct = it.file.size ? (it.loaded / it.file.size) * 100 : 100;
            return (
              <li key={it.id} className="group px-4 py-2">
                <div className="flex items-center gap-3 text-sm">
                  <span className={`min-w-0 flex-1 truncate ${it.status === "cancelled" ? "text-zinc-600 line-through" : "text-zinc-300"}`}>
                    {it.savedAs || it.file.name}
                  </span>
                  <span
                    className={`shrink-0 text-xs tabular-nums ${
                      it.status === "error" ? "text-red-400" : it.status === "done" ? "text-sky-300" : "text-zinc-500"
                    }`}
                  >
                    {it.status === "uploading"
                      ? `${Math.round(itemPct)}%`
                      : it.status === "done"
                        ? formatSize(it.file.size)
                        : it.status === "error"
                          ? it.error
                          : it.status === "cancelled"
                            ? "Cancelled"
                            : "Queued"}
                  </span>
                  {(it.status === "uploading" || it.status === "waiting") && (
                    <button
                      onClick={() => onCancel(it.id)}
                      aria-label="Cancel upload"
                      className="-mr-1 rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
                    >
                      <CloseIcon size={14} />
                    </button>
                  )}
                </div>
                {it.status === "uploading" && (
                  <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-400 to-sky-400 transition-[width] duration-300"
                      style={{ width: `${itemPct}%` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {active && !collapsed && (
        <p className="border-t border-white/[0.06] px-4 py-2 text-[11px] text-zinc-500">
          Keep this screen open until uploads finish.
        </p>
      )}
    </div>
  );
}
