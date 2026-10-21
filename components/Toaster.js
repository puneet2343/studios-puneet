"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

// toast("Deleted", { action: { label: "Undo", onClick } }) — one toast at a time, newest wins.
export default function Toaster({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const show = useCallback((message, { action, duration = 5000 } = {}) => {
    clearTimeout(timer.current);
    setToast({ id: Date.now(), message, action });
    timer.current = setTimeout(() => setToast(null), duration);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4 lg:bottom-5">
        {toast && (
          <div
            key={toast.id}
            role="status"
            className="anim-rise pointer-events-auto flex max-w-md items-center gap-4 rounded-xl border border-white/10 bg-zinc-900/95 py-2.5 pl-4 pr-2.5 text-sm text-zinc-100 shadow-2xl shadow-black/50 backdrop-blur"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  clearTimeout(timer.current);
                  setToast(null);
                  toast.action.onClick();
                }}
                className="rounded-md px-2.5 py-1 font-medium text-violet-300 transition-colors hover:bg-white/5"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
