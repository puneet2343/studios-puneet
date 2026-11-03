"use client";

import Link from "next/link";
import { ArrowLeftIcon, SparkIcon } from "@/components/icons";
import { CURRENT } from "@/lib/changelog";

const BUILT_AT = Number(process.env.NEXT_PUBLIC_BUILT_AT) || null;
const updated = BUILT_AT
  ? new Date(BUILT_AT).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
  : null;

/** Big clean page title (like Google Photos), sticky at the top, with actions on the right. */
// `flush`: the page already has side padding (Albums, Settings), so add none here.
// `version`: show the app version and when it was last updated (links to Updates).
export default function PageHeader({ title, subtitle, onBack, actions, children, flush = false, version = false }) {
  return (
    <header className="sticky top-0 z-30 bg-background pt-[env(safe-area-inset-top)]">
      <div className={`flex min-h-16 items-center gap-1 ${flush ? "" : "px-2 sm:px-0"}`}>
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-100 hover:bg-white/5 active:bg-white/10">
            <ArrowLeftIcon size={22} />
          </button>
        )}
        <div className={`min-w-0 flex-1 ${onBack || flush ? "" : "pl-2 sm:pl-0"}`}>
          <h1 className={`truncate font-semibold tracking-tight text-zinc-50 ${onBack ? "text-xl" : "text-2xl sm:text-[28px]"}`}>{title}</h1>
          {subtitle && <p className="truncate text-[13px] text-zinc-500">{subtitle}</p>}
          {version && (
            <Link href="/updates" className="-mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-zinc-500 hover:text-accent">
              <SparkIcon size={12} className="shrink-0 text-accent" />
              <span className="truncate">
                Version {CURRENT.version}
                {updated ? ` · updated ${updated}` : ""}
              </span>
            </Link>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function HeaderButton({ label, onClick, children, primary = false }) {
  return primary ? (
    <button onClick={onClick} className="ml-1 flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-[#fff] transition-transform hover:bg-accent-strong active:scale-95">
      {children}
      <span className="max-sm:sr-only">{label}</span>
    </button>
  ) : (
    <button onClick={onClick} aria-label={label} title={label} className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-200 transition-colors hover:bg-white/5 active:bg-white/10">
      {children}
    </button>
  );
}

/** Rounded filter chips under a header. */
export function Chips({ options, value, onChange }) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 sm:px-0">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
            value === o.id ? "border-transparent bg-accent-soft text-accent" : "border-line text-zinc-300 hover:bg-white/5"
          }`}
        >
          {o.icon && <o.icon size={16} />}
          {o.label}
          {o.count !== undefined && <span className="tabular-nums opacity-70">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
