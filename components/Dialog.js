"use client";

import { useEffect } from "react";

export default function Dialog({ title, children, onClose, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="anim-fade absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* Phone: a bottom sheet that clears the gesture bar and scrolls if it's taller than the screen. */}
      <div
        role="dialog"
        aria-modal="true"
        className="anim-sheet relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col rounded-t-3xl border border-white/10 bg-zinc-900 shadow-2xl shadow-black/60 sm:m-3 sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl short:m-1 short:max-h-[calc(100dvh-0.5rem)] short:max-w-xl"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" />
        <h2 className="shrink-0 px-5 pb-3 pt-4 text-base font-semibold text-zinc-100 sm:pt-5 short:pb-2 short:pt-3">{title}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">{children}</div>
        {footer ? (
          <div className="flex shrink-0 gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 short:pb-3 short:pt-3 max-sm:[&>*]:h-12 short:[&>*]:h-11 max-sm:[&>*]:flex-1 sm:justify-end">
            {footer}
          </div>
        ) : (
          <div className="h-[max(1rem,env(safe-area-inset-bottom))] shrink-0" />
        )}
      </div>
    </div>
  );
}

export function Button({ variant = "secondary", className = "", ...props }) {
  const styles = {
    primary: "bg-accent text-[#fff] hover:bg-accent-strong",
    secondary: "border border-white/10 text-zinc-200 hover:bg-white/5",
    danger: "bg-red-500/90 text-[#fff] hover:bg-red-500",
    ghost: "text-zinc-300 hover:bg-white/5",
  };
  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}
