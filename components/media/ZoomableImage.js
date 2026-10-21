"use client";

import { useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;

/**
 * Photo that zooms like a phone gallery: pinch with two fingers, double-tap to zoom
 * in/out at that spot, drag to look around while zoomed. A single tap calls `onTap`
 * (the viewer uses it to show/hide its controls). While zoomed in it carries
 * data-zoomed, so the viewer's swipe-to-next / swipe-down-to-close stay out of the way.
 */
export default function ZoomableImage({ onTap, className = "", ...img }) {
  const box = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(0);
  const tapTimer = useRef(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const [active, setActive] = useState(false); // finger(s) down: follow them with no easing

  // Keep the photo covering the screen: no panning past its edges.
  function clamp(next) {
    const r = box.current.getBoundingClientRect();
    const maxX = ((next.s - 1) * r.width) / 2;
    const maxY = ((next.s - 1) * r.height) / 2;
    return {
      s: next.s,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  // Point relative to the box centre, in screen pixels.
  function local(p) {
    const r = box.current.getBoundingClientRect();
    return { x: p.x - (r.left + r.width / 2), y: p.y - (r.top + r.height / 2) };
  }

  // Zoom to `s` keeping the screen point `q` still under the finger.
  const zoomAt = (from, s, q) => ({ s, x: q.x - (s * (q.x - from.x)) / from.s, y: q.y - (s * (q.y - from.y)) / from.s });

  function onPointerDown(e) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setActive(true);
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const mid = local({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });
      gesture.current = { type: "pinch", dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), from: t, mid };
    } else if (pts.length === 1) {
      gesture.current = { type: "pan", start: pts[0], from: t, moved: false };
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (g?.type === "pinch" && pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const s = Math.max(1, Math.min(MAX_SCALE, (g.from.s * dist) / g.dist));
      const mid = local({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });
      const z = zoomAt(g.from, s, g.mid);
      setT(clamp({ s, x: z.x + (mid.x - g.mid.x), y: z.y + (mid.y - g.mid.y) }));
    } else if (g?.type === "pan") {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.from.s > 1) setT(clamp({ s: g.from.s, x: g.from.x + dx, y: g.from.y + dy }));
    }
  }

  function onPointerUp(e) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // One finger lifted from a pinch: carry on panning with the other.
      const [p] = pointers.current.values();
      gesture.current = { type: "pan", start: p, from: t, moved: true };
      return;
    }
    setActive(false);
    gesture.current = null;
    if (t.s < 1.05) setT({ s: 1, x: 0, y: 0 });
    if (g?.type !== "pan" || g.moved) return;

    // A tap: double-tap zooms, single tap is handed to the viewer.
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      haptic("tick");
      setT((cur) => (cur.s > 1 ? { s: 1, x: 0, y: 0 } : clamp(zoomAt(cur, DOUBLE_TAP_SCALE, local({ x: e.clientX, y: e.clientY })))));
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => onTap?.(), DOUBLE_TAP_MS);
  }

  return (
    <div
      ref={box}
      data-zoomable
      data-zoomed={t.s > 1 ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
      className="relative flex h-full w-full touch-none items-center justify-center"
    >
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img
        {...img}
        draggable={false}
        className={`${className} will-change-transform select-none`}
        style={{
          transform: `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.s})`,
          transition: active ? "opacity 300ms" : "transform 240ms var(--ease-out), opacity 300ms",
        }}
      />
    </div>
  );
}
