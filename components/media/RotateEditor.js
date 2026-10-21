"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, FlipIcon, RotateLeftIcon, RotateRightIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { fileUrl, thumbUrl } from "@/components/media/urls";
import { haptic } from "@/lib/haptics";

/**
 * Rotate / mirror a video. The preview turns live; saving only rewrites the video's
 * rotation setting (no re-encoding), so it's instant and the quality is untouched.
 */
export default function RotateEditor({ file, onClose, onSaved }) {
  useBackClose(true, onClose);
  const stage = useRef(null);
  const [turns, setTurns] = useState(0); // quarter turns clockwise (can go past 4 so the animation keeps spinning the right way)
  const [flip, setFlip] = useState(false);
  const [fit, setFit] = useState(1);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState("");

  const quarter = ((turns % 4) + 4) % 4;
  const sideways = quarter % 2 === 1;
  const changed = quarter !== 0 || flip;

  // When turned sideways the picture is shrunk so it still fits on screen.
  useEffect(() => {
    function measure() {
      const box = stage.current?.getBoundingClientRect();
      const media = stage.current?.querySelector("video");
      if (!box || !media?.videoWidth) return;
      const base = Math.min(box.width / media.videoWidth, box.height / media.videoHeight);
      const turned = Math.min(box.width / media.videoHeight, box.height / media.videoWidth);
      setFit(sideways ? turned / base : 1);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [sideways]);

  useEffect(() => {
    if (!saving) return;
    window.__psBusy = (window.__psBusy || 0) + 1;
    return () => {
      window.__psBusy -= 1;
    };
  }, [saving]);

  async function save(replace) {
    setSaving(replace ? "replace" : "copy");
    setError("");
    const res = await fetch("/api/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.path ?? file.name, turns: quarter, flip, replace }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "Can't reach the studio PC." };
    setSaving(null);
    if (!res?.ok) return setError(data.error || "Couldn't save the rotated video");
    haptic("success");
    onSaved({ path: data.path, replaced: replace });
  }

  return (
    <div data-theme="dark" className="anim-fade fixed inset-0 z-[55] flex flex-col overflow-hidden bg-black text-zinc-100">
      <header className="flex items-center gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
          <CloseIcon size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold">
            <RotateRightIcon size={16} className="text-violet-300" /> Rotate
          </p>
          <p className="truncate text-xs text-zinc-500">{file.name}</p>
        </div>
      </header>

      <div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 py-2">
        <video
          src={fileUrl(file)}
          poster={thumbUrl(file)}
          muted
          playsInline
          autoPlay
          loop
          preload="metadata"
          onLoadedMetadata={() => window.dispatchEvent(new Event("resize"))}
          className="max-h-full max-w-full rounded-lg shadow-2xl"
          style={{
            transform: `rotate(${turns * 90}deg) scaleX(${flip ? -1 : 1}) scale(${fit})`,
            transition: "transform 380ms cubic-bezier(0.3, 1.2, 0.5, 1)",
          }}
        />
      </div>

      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex gap-2">
          <Tool label="Left" onClick={() => setTurns((t) => t - 1)}>
            <RotateLeftIcon size={22} />
          </Tool>
          <Tool label="Right" onClick={() => setTurns((t) => t + 1)}>
            <RotateRightIcon size={22} />
          </Tool>
          <Tool label="Mirror" active={flip} onClick={() => setFlip((f) => !f)}>
            <FlipIcon size={22} />
          </Tool>
        </div>

        <p className="mt-3 min-h-[2.5rem] text-xs text-zinc-500">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : changed ? (
            `${quarter ? `Turned ${quarter * 90}° clockwise` : ""}${quarter && flip ? " and " : ""}${flip ? "mirrored" : ""}. Saving is instant and lossless: the video isn't re-encoded.`
          ) : (
            "Turn or mirror the video, then save. No re-encoding, so the quality stays exactly the same."
          )}
        </p>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={() => save(true)}
            disabled={!changed || Boolean(saving)}
            className="h-12 rounded-xl border border-white/10 text-sm font-medium text-zinc-200 transition-colors active:bg-white/5 disabled:opacity-40"
          >
            {saving === "replace" ? "Saving…" : "Replace original"}
          </button>
          <button
            onClick={() => save(false)}
            disabled={!changed || Boolean(saving)}
            className="h-12 rounded-xl bg-white text-sm font-semibold text-zinc-950 transition-[transform,opacity] active:scale-[0.98] disabled:opacity-40"
          >
            {saving === "copy" ? "Saving…" : "Save as new"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tool({ label, onClick, active, children }) {
  return (
    <button
      onClick={() => {
        haptic("tick");
        onClick();
      }}
      className={`flex h-[4.25rem] flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl text-xs font-medium transition-[background-color,transform] active:scale-95 ${
        active ? "bg-violet-500/20 text-violet-200" : "bg-white/[0.06] text-zinc-200"
      }`}
    >
      {children}
      {label}
    </button>
  );
}
