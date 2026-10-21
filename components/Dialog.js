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
      <div
        role="dialog"
        aria-modal="true"
        className="anim-sheet relative m-3 w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-2xl shadow-black/60"
      >
        <h2 className="mb-3 text-base font-semibold text-zinc-100">{title}</h2>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Button({ variant = "secondary", className = "", ...props }) {
  const styles = {
    primary: "bg-white text-zinc-950 hover:bg-zinc-200",
    secondary: "border border-white/10 text-zinc-200 hover:bg-white/5",
    danger: "bg-red-500/90 text-[#fff] hover:bg-red-500",
    ghost: "text-zinc-300 hover:bg-white/5",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}
