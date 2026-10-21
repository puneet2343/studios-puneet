"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, PauseIcon, PlayIcon, ScissorsIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { fileUrl } from "@/components/media/urls";

const MIN_LENGTH = 0.5;

// 0:03.4 — tenths matter when trimming.
const stamp = (t) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

// A lossless cut can only start on a keyframe: the last one at or before `t`.
const snapToKeyframe = (t, keyframes) => {
  let best = 0;
  for (const k of keyframes) {
    if (k <= t + 0.001) best = k;
    else break;
  }
  return best;
};

/**
 * Full-screen trim tool. Drag the two handles over the filmstrip, preview the loop,
 * then save as a new clip or replace the original. Saving copies the original
 * video and audio data without re-encoding, so quality is unchanged.
 */
export default function TrimEditor({ file, onClose, onSaved }) {
  useBackClose(true, onClose);
  const video = useRef(null);
  const track = useRef(null);
  const drag = useRef(null); // "start" | "end" | "playhead"
  const frame = useRef(0);
  const dragStart = useRef(0); // latest start while dragging (state can lag a frame behind)
  const [info, setInfo] = useState(null); // { duration, keyframes }
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(file.duration || 0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stripLoaded, setStripLoaded] = useState(false);
  const [snapNote, setSnapNote] = useState("");
  const [saving, setSaving] = useState(null); // "copy" | "replace"
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/trim?name=${encodeURIComponent(file.path ?? file.name)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (d.error) return setError(d.error);
        setInfo(d);
        setEnd(d.duration);
      })
      .catch(() => live && setError("Can't reach the studio PC."));
    return () => {
      live = false;
    };
  }, [file]);

  // Saving keeps the app from auto-reloading for an update mid-way.
  useEffect(() => {
    if (!saving) return;
    window.__psBusy = (window.__psBusy || 0) + 1;
    return () => {
      window.__psBusy -= 1;
    };
  }, [saving]);

  const duration = info?.duration || file.duration || 0;
  const keyframes = info?.keyframes ?? [];
  const pct = (t) => (duration ? (t / duration) * 100 : 0);

  // Preview loops inside the selection.
  function onTimeUpdate(e) {
    const v = e.currentTarget;
    setTime(v.currentTime);
    if (!drag.current && v.currentTime >= end) {
      v.currentTime = start;
      if (v.paused) setTime(start);
    }
  }

  function togglePlay() {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start;
      v.play().catch(() => {});
    } else v.pause();
  }

  // Seeking on every pointer move would flood the PC with requests; once per frame is plenty.
  function previewAt(t) {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (video.current) video.current.currentTime = t;
      setTime(t);
    });
  }

  const timeAt = (clientX) => {
    const r = track.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };

  function onDown(e, which) {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    drag.current = which;
    dragStart.current = start;
    setSnapNote("");
    video.current?.pause();
    onMove(e);
  }

  function onMove(e) {
    const which = drag.current;
    if (!which) return;
    const t = timeAt(e.clientX);
    if (which === "start") {
      const next = Math.min(t, end - MIN_LENGTH);
      dragStart.current = Math.max(0, next);
      setStart(dragStart.current);
      previewAt(dragStart.current);
    } else if (which === "end") {
      const next = Math.max(t, start + MIN_LENGTH);
      setEnd(Math.min(duration, next));
      previewAt(Math.min(duration, next) - 0.05);
    } else {
      previewAt(Math.min(Math.max(t, start), end));
    }
  }

  function onUp() {
    if (drag.current === "start" && keyframes.length) {
      const chosen = dragStart.current;
      const snapped = snapToKeyframe(chosen, keyframes);
      if (Math.abs(snapped - chosen) > 0.04) {
        setSnapNote(`Starts at ${stamp(snapped)}, the nearest keyframe (needed for a lossless cut)`);
      }
      setStart(snapped);
      previewAt(snapped);
    }
    drag.current = null;
  }

  async function save(replace) {
    setSaving(replace ? "replace" : "copy");
    setError("");
    const res = await fetch("/api/trim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.path ?? file.name, start, end, replace }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "Can't reach the studio PC." };
    setSaving(null);
    if (!res?.ok) return setError(data.error || "Couldn't save the trimmed clip");
    onSaved({ path: data.path, replaced: replace });
  }

  const length = end - start;
  const ready = Boolean(info) && duration > 0;
  const trimmed = ready && (start > 0.05 || end < duration - 0.05);

  return (
    <div data-theme="dark" className="anim-fade fixed inset-0 z-[55] flex flex-col overflow-hidden bg-black text-zinc-100">
      <header className="flex items-center gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
          <CloseIcon size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold">
            <ScissorsIcon size={16} className="text-violet-300" /> Trim
          </p>
          <p className="truncate text-xs text-zinc-500">{file.name}</p>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2" onClick={togglePlay}>
        <video
          ref={video}
          src={fileUrl(file)}
          playsInline
          preload="auto"
          className="max-h-full max-w-full"
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {!playing && ready && (
          <span className="pointer-events-none absolute flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-[#fff] backdrop-blur-sm">
            <PlayIcon size={28} className="translate-x-0.5" />
          </span>
        )}
      </div>

      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {/* Times */}
        <div className="mb-3 flex items-end justify-between text-xs tabular-nums">
          <div>
            <p className="text-zinc-500">Start</p>
            <p className="text-sm font-semibold text-zinc-100">{stamp(start)}</p>
          </div>
          <div className="text-center">
            <p className="text-zinc-500">Length</p>
            <p className="text-sm font-semibold text-violet-300">{stamp(length)}</p>
          </div>
          <div className="text-right">
            <p className="text-zinc-500">End</p>
            <p className="text-sm font-semibold text-zinc-100">{stamp(end)}</p>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            disabled={!ready}
            aria-label={playing ? "Pause preview" : "Play preview"}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#fff] transition-transform active:scale-90 disabled:opacity-40"
          >
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} className="translate-x-px" />}
          </button>

          <div
            ref={track}
            onPointerDown={(e) => ready && onDown(e, "playhead")}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className="relative mx-2 h-14 flex-1 touch-none select-none overflow-visible rounded-lg bg-white/5"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/trim?name=${encodeURIComponent(file.path ?? file.name)}&strip=1&k=${file.key}`}
              alt=""
              draggable={false}
              onLoad={() => setStripLoaded(true)}
              className={`absolute inset-0 h-full w-full rounded-lg object-fill transition-opacity duration-300 ${stripLoaded ? "opacity-100" : "opacity-0"}`}
            />
            {!stripLoaded && <div className="skeleton absolute inset-0 rounded-lg" />}

            {ready && (
              <>
                {/* Dim what gets cut away */}
                <div className="absolute inset-y-0 left-0 rounded-l-lg bg-black/65" style={{ width: `${pct(start)}%` }} />
                <div className="absolute inset-y-0 right-0 rounded-r-lg bg-black/65" style={{ width: `${100 - pct(end)}%` }} />
                {/* Kept part: framed */}
                <div
                  className="pointer-events-none absolute inset-y-0 border-y-[3px] border-violet-400"
                  style={{ left: `${pct(start)}%`, right: `${100 - pct(end)}%` }}
                />
                {/* Playhead */}
                <div
                  className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-[#fff] shadow"
                  style={{ left: `${pct(time)}%` }}
                />
                <Handle side="start" at={pct(start)} value={start} onDown={(e) => onDown(e, "start")} />
                <Handle side="end" at={pct(end)} value={end} onDown={(e) => onDown(e, "end")} />
              </>
            )}
          </div>
        </div>

        <p className="mt-3 min-h-[2.5rem] text-xs text-zinc-500">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : snapNote ? (
            <span className="text-amber-200">{snapNote}</span>
          ) : !ready ? (
            "Loading video details…"
          ) : (
            "Drag the purple handles. Saving is lossless: no re-encoding, same quality as the original."
          )}
        </p>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={() => save(true)}
            disabled={!trimmed || Boolean(saving)}
            className="h-12 rounded-xl border border-white/10 text-sm font-medium text-zinc-200 transition-colors active:bg-white/5 disabled:opacity-40"
          >
            {saving === "replace" ? "Saving…" : "Replace original"}
          </button>
          <button
            onClick={() => save(false)}
            disabled={!trimmed || Boolean(saving)}
            className="h-12 rounded-xl bg-white text-sm font-semibold text-zinc-950 transition-[transform,opacity] active:scale-[0.98] disabled:opacity-40"
          >
            {saving === "copy" ? "Saving…" : "Save as new clip"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Wide invisible grab area around a slim visible handle, so it's easy to catch with a thumb.
function Handle({ side, at, value, onDown }) {
  return (
    <div
      role="slider"
      aria-label={side === "start" ? "Trim start" : "Trim end"}
      aria-valuenow={Math.round(value * 10) / 10}
      onPointerDown={onDown}
      className="absolute -inset-y-2 z-10 flex w-11 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
      style={{ left: `${at}%` }}
    >
      <div className={`flex h-[calc(100%-0.5rem)] w-4 items-center justify-center bg-violet-400 shadow-lg ${side === "start" ? "rounded-l-lg" : "rounded-r-lg"}`}>
        <span className="h-5 w-0.5 rounded-full bg-violet-900/70" />
      </div>
    </div>
  );
}
