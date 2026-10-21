"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshIcon } from "@/components/icons";
import { haptic } from "@/lib/haptics";

const TRIGGER = 72; // px of pull needed to refresh
const MAX = 120;

/**
 * Pull down at the top of the page to refresh, like a native app. Only starts when the
 * page is scrolled to the very top and nothing (viewer, dialog, selection) is open.
 */
export default function PullToRefresh({ onRefresh, disabled = false }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [touching, setTouching] = useState(false);
  const start = useRef(null);
  const armed = useRef(false);
  const pullRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (disabled || refreshing) return;
    function onStart(e) {
      if (window.scrollY > 0 || e.touches.length > 1 || document.querySelector("[role=dialog], [data-player], [data-zoomable]")) return;
      start.current = e.touches[0].clientY;
      armed.current = false;
      setTouching(true);
    }
    function onMove(e) {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Rubber-band: the further you pull, the harder it gets.
      const eased = Math.min(MAX, dy * 0.5);
      if (eased >= TRIGGER && !armed.current) {
        armed.current = true;
        haptic("tick");
      } else if (eased < TRIGGER) armed.current = false;
      pullRef.current = eased;
      setPull(eased);
    }
    async function onEnd() {
      if (start.current === null) return;
      start.current = null;
      setTouching(false);
      if (pullRef.current >= TRIGGER) {
        setRefreshing(true);
        setPull(TRIGGER * 0.75);
        await Promise.resolve(onRefreshRef.current?.()).catch(() => {});
        setRefreshing(false);
      }
      pullRef.current = 0;
      setPull(0);
    }
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [disabled, refreshing]);

  const shown = pull > 2 || refreshing;
  const progress = Math.min(1, pull / TRIGGER);
  return (
    <div
      aria-hidden={!shown}
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.75rem)] z-30 flex justify-center lg:top-4"
      style={{
        transform: `translateY(${shown ? pull * 0.6 : -40}px)`,
        opacity: shown ? Math.max(0.2, progress) : 0,
        transition: touching ? "none" : "transform 260ms var(--ease-out), opacity 200ms",
      }}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-zinc-900 shadow-lg shadow-black/20 ${
          progress >= 1 || refreshing ? "text-violet-300" : "text-zinc-400"
        }`}
      >
        <span className={`flex ${refreshing ? "animate-spin" : ""}`} style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}>
          <RefreshIcon size={18} />
        </span>
      </div>
    </div>
  );
}
