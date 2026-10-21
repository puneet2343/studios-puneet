"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BackTenIcon,
  ExpandIcon,
  ForwardTenIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  ReplayIcon,
  ShrinkIcon,
  SpeedIcon,
  VolumeIcon,
} from "@/components/icons";
import { fileUrl, thumbUrl } from "@/components/media/urls";
import useBackClose from "@/components/useBackClose";

const SKIP = 10;
const HIDE_AFTER_MS = 2600;
const DOUBLE_TAP_MS = 280;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const QUALITY_KEY = "ps.quality";

const qualityLabel = (q, short) => (q === "original" ? (short >= 2160 ? "4K" : short ? `${short}p` : "Original") : `${q}p`);

// A slow or metered connection: Auto starts on a lighter copy instead of the full 4K file.
function slowConnection() {
  const c = typeof navigator !== "undefined" ? navigator.connection : null;
  return Boolean(c && (c.saveData || ["slow-2g", "2g", "3g"].includes(c.effectiveType) || (c.downlink && c.downlink < 8)));
}
const RESUME_KEY = "ps.resume";

const clock = (t) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

// Where each video was left off, so reopening it carries on like YouTube does.
function readResume(key) {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) || "{}")[key] || 0;
  } catch {
    return 0;
  }
}
function writeResume(key, time) {
  try {
    const all = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    if (time) all[key] = Math.round(time);
    else delete all[key];
    const keys = Object.keys(all);
    if (keys.length > 200) delete all[keys[0]]; // keep the list small
    localStorage.setItem(RESUME_KEY, JSON.stringify(all));
  } catch {}
}

/**
 * YouTube-style player. Tap: show/hide controls. Double-tap left/right: skip 10s
 * (keep tapping to skip more). Drag the bar to scrub. Mouse: click = play/pause,
 * double-click = full screen. Keys: space/k, j/l, m, f.
 * `onControls(visible)` lets the viewer fade its own header in step.
 */
export default function VideoPlayer({ file, onControls, onError }) {
  const video = useRef(null);
  const root = useRef(null);
  const bar = useRef(null);
  const hideTimer = useRef(null);
  const tap = useRef({ time: 0, x: 0, timer: null });
  const skipTimer = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(file.duration || 0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [speedMenu, setSpeedMenu] = useState(false);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrub, setScrub] = useState(null); // fraction 0..1 while dragging the bar
  const [skip, setSkip] = useState(null); // { side, seconds, id } ripple
  const [resumed, setResumed] = useState(0);
  // Quality: what the viewer chose ("auto", "original" or 720…) and what's playing now.
  const [choice, setChoice] = useState(() => {
    try {
      return localStorage.getItem(QUALITY_KEY) || "auto";
    } catch {
      return "auto";
    }
  });
  const [playingQ, setPlayingQ] = useState("original");
  const [qStatus, setQStatus] = useState(null); // { short, options: [{ q, ready, progress }] }
  const [qualityMenu, setQualityMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const switching = useRef(null); // { time, play } carried across a quality switch
  const stalls = useRef([]);
  // Back (or a tap on the picture) closes an open speed / quality menu, not the viewer.
  useBackClose(speedMenu || qualityMenu, () => {
    setSpeedMenu(false);
    setQualityMenu(false);
  });
  const downAt = useRef(null); // where the finger went down, to tell taps from swipes

  // ----- Quality -----
  const name = file.path ?? file.name;
  const loadStatus = useCallback(async () => {
    const d = await fetch(`/api/stream?name=${encodeURIComponent(name)}&status=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (d) setQStatus(d);
    return d;
  }, [name]);

  const switchTo = useCallback((q) => {
    const v = video.current;
    setPlayingQ((current) => {
      if (current === q) return current;
      if (v) switching.current = { time: v.currentTime, play: !v.paused };
      return q;
    });
  }, []);

  const prepare = useCallback(
    (q) =>
      fetch("/api/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, q }),
      }).catch(() => {}),
    [name]
  );

  // First look: what lighter copies exist, and pick the starting quality.
  useEffect(() => {
    let live = true;
    const first = setTimeout(() => loadStatus().then((d) => {
      if (!live || !d) return;
      const ready = (q) => d.options.find((o) => o.q === q)?.ready;
      if (typeof choice === "string" && choice !== "auto" && choice !== "original" && ready(Number(choice))) switchTo(Number(choice));
      else if (choice === "auto" && slowConnection()) {
        const best = d.options.find((o) => o.q <= 720 && o.ready);
        if (best) switchTo(best.q);
        else if (d.options.some((o) => o.q === 720)) prepare(720);
      }
    }), 0);
    return () => {
      live = false;
      clearTimeout(first);
    };
    // Only when a different video opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // While a copy is being made, keep checking; switch to it when it's ready (if still wanted).
  const preparing = qStatus?.options.some((o) => o.progress !== null);
  useEffect(() => {
    if (!preparing) return;
    const timer = setInterval(async () => {
      const d = await loadStatus();
      if (!d) return;
      const wanted = choice === "auto" ? d.options.find((o) => o.q <= 720 && o.ready)?.q : Number(choice);
      if (wanted && d.options.find((o) => o.q === wanted)?.ready && (choice !== "auto" || playingQ === "original")) {
        switchTo(wanted);
        if (choice === "auto") setNotice(`Switched to ${wanted}p for smoother playback`);
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [preparing, loadStatus, choice, playingQ, switchTo]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function choose(q) {
    setQualityMenu(false);
    setChoice(String(q));
    try {
      localStorage.setItem(QUALITY_KEY, String(q));
    } catch {}
    if (q === "auto" || q === "original") return switchTo("original");
    const option = qStatus?.options.find((o) => o.q === q);
    if (option?.ready) switchTo(q);
    else {
      prepare(q);
      setQStatus((st) => st && { ...st, options: st.options.map((o) => (o.q === q ? { ...o, progress: 0 } : o)) });
      setNotice(`Preparing ${q}p on the studio PC… it'll switch over when ready`);
    }
  }

  // Auto: if playback keeps pausing to load, step down to a lighter copy.
  function onStall() {
    if (choice !== "auto" || !playing) return;
    const now = Date.now();
    stalls.current = [...stalls.current.filter((t) => now - t < 20000), now];
    if (stalls.current.length < 2) return;
    stalls.current = [];
    const lower = qStatus?.options.filter((o) => (playingQ === "original" ? true : o.q < playingQ));
    const ready = lower?.find((o) => o.ready && o.q <= 720);
    if (ready) {
      switchTo(ready.q);
      setNotice(`Switched to ${ready.q}p for smoother playback`);
    } else if (lower?.some((o) => o.q === 720)) {
      prepare(720);
      setQStatus((st) => st && { ...st, options: st.options.map((o) => (o.q === 720 ? { ...o, progress: o.progress ?? 0 } : o)) });
    }
  }

  // ----- Controls visibility -----
  const show = useCallback((stay = false) => {
    setControls(true);
    clearTimeout(hideTimer.current);
    if (!stay) {
      hideTimer.current = setTimeout(() => {
        if (video.current && !video.current.paused) setControls(false);
      }, HIDE_AFTER_MS);
    }
  }, []);

  useEffect(() => {
    onControls?.(controls);
  }, [controls, onControls]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // ----- Playback -----
  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekBy = useCallback((seconds) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + seconds), v.duration || Infinity);
    setTime(v.currentTime);
  }, []);

  // Double-tap skipping stacks up: 10s, 20s, 30s… like YouTube.
  const skipFrom = useCallback(
    (side) => {
      seekBy(side === "left" ? -SKIP : SKIP);
      setSkip((s) => ({
        side,
        seconds: s?.side === side ? s.seconds + SKIP : SKIP,
        id: Date.now(),
      }));
      clearTimeout(skipTimer.current);
      skipTimer.current = setTimeout(() => setSkip(null), 650);
    },
    [seekBy]
  );

  const toggleFullscreen = useCallback(async () => {
    const el = root.current;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await (el.requestFullscreen?.() ?? video.current?.webkitEnterFullscreen?.());
        // Landscape videos fill the phone sideways, like YouTube's full screen.
        const v = video.current;
        if (v && v.videoWidth > v.videoHeight) await screen.orientation?.lock?.("landscape").catch(() => {});
      }
    } catch {}
  }, []);

  useEffect(() => {
    const onChange = () => {
      const on = Boolean(document.fullscreenElement);
      setFullscreen(on);
      if (!on) screen.orientation?.unlock?.();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Save the position now and then, and when leaving.
  useEffect(() => {
    const v = video.current;
    const save = () => {
      if (!v || !v.duration) return;
      const nearEnd = v.currentTime > v.duration - 5;
      writeResume(file.key, v.currentTime > 5 && !nearEnd ? v.currentTime : 0);
    };
    const timer = setInterval(save, 4000);
    return () => {
      clearInterval(timer);
      save();
    };
  }, [file.key]);

  // Keyboard, like YouTube. Arrow keys stay with the viewer (previous / next file).
  useEffect(() => {
    function onKey(e) {
      if (e.target.closest?.("input, textarea, [role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") {
        e.preventDefault();
        togglePlay();
      } else if (k === "j") skipFrom("left");
      else if (k === "l") skipFrom("right");
      else if (k === "m") video.current && (video.current.muted = !video.current.muted);
      else if (k === "f") toggleFullscreen();
      else return;
      show();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, skipFrom, togglePlay, toggleFullscreen]);

  // ----- Taps on the picture -----
  function onSurfaceUp(e) {
    if (e.target.closest("[data-control]")) return;
    // A finger that travelled was a swipe (next / previous / close), not a tap.
    const down = downAt.current;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
    if (speedMenu || qualityMenu) {
      setSpeedMenu(false);
      setQualityMenu(false);
      return;
    }
    const rect = root.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;

    if (e.pointerType === "mouse") {
      // Desktop: click plays/pauses; double-click toggles full screen.
      const now = Date.now();
      if (now - tap.current.time < DOUBLE_TAP_MS) {
        clearTimeout(tap.current.timer);
        tap.current.time = 0;
        toggleFullscreen();
        return;
      }
      tap.current.time = now;
      tap.current.timer = setTimeout(() => {
        togglePlay();
        show();
      }, DOUBLE_TAP_MS);
      return;
    }

    const side = x < 0.35 ? "left" : x > 0.65 ? "right" : "middle";
    const now = Date.now();
    const recent = now - tap.current.time < DOUBLE_TAP_MS * 1.4;
    // While a skip is showing, every further tap on that side adds 10s.
    if ((recent || skip) && side !== "middle" && (skip ? skip.side === side : true)) {
      clearTimeout(tap.current.timer);
      tap.current.time = now;
      skipFrom(side);
      return;
    }
    tap.current.time = now;
    tap.current.x = x;
    clearTimeout(tap.current.timer);
    tap.current.timer = setTimeout(() => {
      if (controls) {
        clearTimeout(hideTimer.current);
        setControls(false);
      } else show();
    }, DOUBLE_TAP_MS);
  }

  // ----- Seek bar -----
  function fractionAt(clientX) {
    const r = bar.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  }
  function onBarDown(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(fractionAt(e.clientX));
    show(true);
  }
  function onBarMove(e) {
    if (scrub !== null) setScrub(fractionAt(e.clientX));
  }
  function onBarUp(e) {
    if (scrub === null) return;
    const f = fractionAt(e.clientX);
    const v = video.current;
    if (v && duration) {
      v.currentTime = f * duration;
      setTime(f * duration);
    }
    setScrub(null);
    show();
  }

  const shown = scrub !== null ? scrub * duration : time;
  const pct = duration ? (shown / duration) * 100 : 0;
  const bufferedPct = duration ? (buffered / duration) * 100 : 0;
  // Menus keep the controls up, so they never fade away mid-choice.
  const controlsOn = controls || !playing || scrub !== null || speedMenu || qualityMenu;
  const fade = `transition-opacity duration-200 ${controlsOn ? "opacity-100" : "pointer-events-none opacity-0"}`;

  return (
    <div
      ref={root}
      data-player
      onPointerDown={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={onSurfaceUp}
      onPointerMove={(e) => e.pointerType === "mouse" && show()}
      className={`relative flex h-full w-full select-none items-center justify-center overflow-hidden bg-black ${
        controlsOn ? "" : "cursor-none"
      }`}
    >
      <video
        ref={video}
        src={playingQ === "original" ? fileUrl(file) : `/api/stream?name=${encodeURIComponent(name)}&q=${playingQ}&k=${file.key}`}
        poster={thumbUrl(file)}
        autoPlay
        playsInline
        preload="auto"
        className="max-h-full max-w-full"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration);
          // Quality switch: carry on from the same moment.
          if (switching.current) {
            const { time, play } = switching.current;
            switching.current = null;
            v.currentTime = time;
            if (play) v.play().catch(() => {});
            return;
          }
          const at = readResume(file.key);
          if (at > 5 && at < v.duration - 5) {
            v.currentTime = at;
            setResumed(at);
            setTimeout(() => setResumed(0), 5000);
          }
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
          show();
        }}
        onPause={() => {
          setPlaying(false);
          show(true);
        }}
        onEnded={() => {
          setEnded(true);
          writeResume(file.key, 0);
          show(true);
        }}
        onWaiting={() => {
          setWaiting(true);
          onStall();
        }}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
        onError={onError}
      />

      {/* Double-tap ripple */}
      {skip && (
        <div
          key={skip.id}
          className={`pointer-events-none absolute inset-y-0 flex w-[38%] items-center justify-center bg-white/10 anim-fade ${
            skip.side === "left" ? "left-0 rounded-r-[50%]" : "right-0 rounded-l-[50%]"
          }`}
        >
          <div className="flex flex-col items-center gap-1 text-[#fff]">
            {skip.side === "left" ? <BackTenIcon size={30} /> : <ForwardTenIcon size={30} />}
            <span className="text-xs font-semibold tabular-nums">{skip.seconds} seconds</span>
          </div>
        </div>
      )}

      {/* Dim layer behind the controls */}
      <div className={`pointer-events-none absolute inset-0 bg-black/35 ${fade}`} />

      {/* Middle: back 10 · play/pause · forward 10 */}
      <div className={`absolute inset-0 flex items-center justify-center gap-10 sm:gap-16 ${fade}`} style={{ pointerEvents: "none" }}>
        <CircleButton label="Back 10 seconds" onClick={() => skipFrom("left")} visible={controlsOn}>
          <BackTenIcon size={26} />
        </CircleButton>
        {waiting && playing ? (
          <div className="h-16 w-16 animate-spin rounded-full border-[3px] border-white/25 border-t-white" aria-label="Loading" />
        ) : (
          <CircleButton label={ended ? "Replay" : playing ? "Pause" : "Play"} onClick={togglePlay} visible={controlsOn} big>
            {ended ? <ReplayIcon size={30} strokeWidth={2.2} /> : playing ? <PauseIcon size={30} /> : <PlayIcon size={30} className="translate-x-0.5" />}
          </CircleButton>
        )}
        <CircleButton label="Forward 10 seconds" onClick={() => skipFrom("right")} visible={controlsOn}>
          <ForwardTenIcon size={26} />
        </CircleButton>
      </div>

      {notice && (
        <div className="anim-rise pointer-events-none absolute left-1/2 top-4 z-10 max-w-[90%] -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-center text-xs text-[#fff] backdrop-blur">
          {notice}
        </div>
      )}

      {resumed > 0 && (
        <div data-control className="anim-rise absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/70 py-1.5 pl-4 pr-1.5 text-xs text-[#fff] backdrop-blur">
          Resumed at {clock(resumed)}
          <button
            onClick={() => {
              video.current.currentTime = 0;
              setResumed(0);
            }}
            className="rounded-full bg-white/15 px-3 py-1.5 font-medium"
          >
            Start over
          </button>
        </div>
      )}

      {/* Bottom: time, seek bar, speed, mute, full screen */}
      <div
        data-control
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-10 sm:px-5 ${fade}`}
      >
        <div className="flex items-center gap-1 text-[#fff]">
          <span className="mr-auto pl-1 text-[13px] font-medium tabular-nums">
            {clock(shown)} <span className="text-[#fff]/60">/ {clock(duration)}</span>
          </span>

          {/* Not "relative": the menu lines up with the right edge of the player, not the button. */}
          {qStatus && (
            <div>
              <BarButton
                label="Quality"
                onClick={() => {
                  setSpeedMenu(false);
                  setQualityMenu((o) => !o);
                  loadStatus();
                }}
              >
                <span className="rounded-md border border-[#fff]/70 px-1.5 py-px text-[11px] font-bold tabular-nums leading-tight">
                  {choice === "auto" ? (playingQ === "original" ? "AUTO" : `AUTO·${playingQ}`) : qualityLabel(playingQ, qStatus.short)}
                </span>
              </BarButton>
              {qualityMenu && (
                <div className="anim-pop absolute bottom-[5.75rem] right-3 z-20 w-64 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 py-1.5 shadow-2xl backdrop-blur">
                  <p className="px-4 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-[#fff]/50">Quality</p>
                  {[
                    { q: "auto", label: "Auto", hint: "Adjusts to your connection" },
                    { q: "original", label: `Original · ${qualityLabel("original", qStatus.short)}`, hint: "Full quality, needs fast internet" },
                    ...qStatus.options.map((o) => ({
                      q: o.q,
                      label: `${o.q}p`,
                      hint: o.progress !== null ? `Preparing… ${Math.round(o.progress * 100)}%` : o.ready ? "Ready" : "Tap to prepare (one-time)",
                    })),
                  ].map(({ q, label, hint }) => {
                    const selected = String(choice) === String(q);
                    return (
                      <button
                        key={q}
                        onClick={() => choose(q)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/10 ${selected ? "text-violet-300" : "text-[#fff]"}`}
                      >
                        <span className="min-w-0">
                          <span className={`block text-sm ${selected ? "font-semibold" : ""}`}>{label}</span>
                          <span className="block truncate text-[11px] text-[#fff]/45">{hint}</span>
                        </span>
                        {selected && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="relative">
            <BarButton label="Playback speed" onClick={() => { setQualityMenu(false); setSpeedMenu((o) => !o); }}>
              {rate === 1 ? <SpeedIcon size={20} /> : <span className="text-[13px] font-semibold tabular-nums">{rate}×</span>}
            </BarButton>
            {speedMenu && (
              <div className="anim-pop absolute bottom-12 right-0 w-36 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 py-1.5 shadow-2xl backdrop-blur">
                <p className="px-4 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-[#fff]/50">Speed</p>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      video.current.playbackRate = s;
                      setSpeedMenu(false);
                      show();
                    }}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-white/10 ${
                      s === rate ? "font-semibold text-violet-300" : "text-[#fff]"
                    }`}
                  >
                    {s === 1 ? "Normal" : `${s}×`}
                    {s === rate && <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <BarButton label={muted ? "Unmute" : "Mute"} onClick={() => (video.current.muted = !video.current.muted)}>
            {muted ? <MuteIcon size={20} /> : <VolumeIcon size={20} />}
          </BarButton>
          <BarButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
            {fullscreen ? <ShrinkIcon size={20} /> : <ExpandIcon size={20} />}
          </BarButton>
        </div>

        {/* Tall invisible touch strip around a thin bar, so it's easy to grab. */}
        <div
          ref={bar}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(shown)}
          tabIndex={0}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerCancel={() => setScrub(null)}
          className="group relative flex h-9 cursor-pointer touch-none items-center"
        >
          <div className={`relative w-full overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 ${scrub !== null ? "h-1.5" : "h-1 group-hover:h-1.5"}`}>
            <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: `${bufferedPct}%` }} />
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-violet-500 to-pink-500" style={{ width: `${pct}%` }} />
          </div>
          <div
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#fff] shadow-md transition-[width,height] duration-150 ${
              scrub !== null ? "h-5 w-5" : "h-3.5 w-3.5"
            }`}
            style={{ left: `${pct}%` }}
          />
          {scrub !== null && (
            <div
              className="absolute bottom-9 -translate-x-1/2 rounded-lg bg-black/80 px-2.5 py-1 text-sm font-semibold tabular-nums text-[#fff] backdrop-blur"
              style={{ left: `clamp(2rem, ${pct}%, calc(100% - 2rem))` }}
            >
              {clock(shown)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CircleButton({ label, onClick, visible, big, children }) {
  return (
    <button
      data-control
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ pointerEvents: visible ? "auto" : "none" }}
      className={`flex items-center justify-center rounded-full bg-black/40 text-[#fff] backdrop-blur-sm transition-transform active:scale-90 ${
        big ? "h-16 w-16" : "h-12 w-12"
      }`}
    >
      {children}
    </button>
  );
}

function BarButton({ label, onClick, children }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-11 min-w-11 items-center justify-center rounded-full px-2 transition-colors hover:bg-white/10 active:bg-white/15"
    >
      {children}
    </button>
  );
}
