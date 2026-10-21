"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/Toaster";
import { ClipIcon, CloseIcon, FileIcon, ImageIcon } from "@/components/icons";
import { formatSize } from "@/lib/format";

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-zinc-950 px-3.5 py-2.5 text-[15px] text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/60";

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block px-0.5 text-xs font-medium text-zinc-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block px-0.5 text-[11px] text-zinc-600">{hint}</span>}
    </label>
  );
}

export function TextInput({ value, onChange, ...props }) {
  return <input {...props} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
}

// Number field that keeps what you type (e.g. "12." while typing) and reports a number or null.
export function MoneyInput({ value, onChange, currency, ...props }) {
  const [text, setText] = useState(value ?? value === 0 ? String(value) : "");
  return (
    <div className="flex items-center rounded-xl border border-white/10 bg-zinc-950 focus-within:border-violet-400/60">
      <span className="pl-3.5 text-sm text-zinc-500">{currency}</span>
      <input
        {...props}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          setText(t);
          onChange(t === "" ? null : Number(t));
        }}
        className="min-w-0 flex-1 bg-transparent px-2.5 py-2.5 text-[15px] tabular-nums text-zinc-100 outline-none placeholder:text-zinc-600"
      />
    </div>
  );
}

// Row of choice buttons (scrolls sideways if there are many).
export function Segmented({ options, value, onChange, size = "md" }) {
  return (
    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
      {options.map(({ id, label, icon: Icon }) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 transition-colors active:scale-[0.97] ${size === "sm" ? "h-9 text-xs" : "h-10 text-sm"} ${
              on ? "border-violet-400/50 bg-violet-500/15 font-medium text-violet-300" : "border-white/10 text-zinc-400"
            }`}
          >
            {Icon && <Icon size={size === "sm" ? 14 : 16} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function SectionTitle({ children, action }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between gap-2 px-0.5 first:mt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{children}</h3>
      {action}
    </div>
  );
}

export const fileUrl = (tripId, fileId, download = false) => `/api/plans/files?trip=${tripId}&file=${fileId}${download ? "&download=1" : ""}`;

// Tickets / booking PDFs / receipts: attach, open, remove. `ids` are the attached file ids.
export function Attachments({ tripId, files, ids, onAdd, onRemove, accept = "image/*,application/pdf", capture, label = "Attach ticket or PDF" }) {
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const attached = ids.map((id) => files.find((f) => f.id === id)).filter(Boolean);

  async function upload(list) {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    setBusy(true);
    for (const file of picked) {
      const res = await fetch(`/api/plans/files?trip=${tripId}&name=${encodeURIComponent(file.name)}`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok && data.file) onAdd(data.file);
      else toast(data.error || "Couldn't attach the file. Check the connection.");
    }
    setBusy(false);
  }

  return (
    <div>
      {attached.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {attached.map((f) => {
            const Icon = f.type.startsWith("image/") ? ImageIcon : FileIcon;
            return (
              <li key={f.id} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] py-1.5 pl-3 pr-1">
                <Icon size={17} className="shrink-0 text-zinc-400" />
                <a href={fileUrl(tripId, f.id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm text-zinc-100 underline-offset-2 hover:underline">
                  {f.name}
                </a>
                <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{formatSize(f.size)}</span>
                <button type="button" onClick={() => onRemove(f.id)} aria-label={`Remove ${f.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/5">
                  <CloseIcon size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-sm text-zinc-400 transition-colors active:bg-white/5 disabled:opacity-50"
      >
        <ClipIcon size={16} />
        {busy ? "Attaching…" : label}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        capture={capture}
        className="hidden"
        onChange={(e) => {
          upload(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function Pill({ children, className = "" }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>;
}
