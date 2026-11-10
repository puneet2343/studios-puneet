"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BackTenIcon,
  ChartIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ExpandIcon,
  ForwardTenIcon,
  GearIcon,
  LoopIcon,
  MuteIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  QualityIcon,
  ReplayIcon,
  ShrinkIcon,
  SkipNextIcon,
  SpeedIcon,
  VolumeIcon,
} from "@/components/icons";
import { fileUrl, thumbUrl } from "@/components/media/urls";
import useBackClose from "@/components/useBackClose";

// ---------------------------------------------------------------------------------------
// A YouTube-style player.
//
// Streaming: the PC cuts every video into 4-second pieces at 1080p / 720p / 480p / 360p
// (lib/renditions.js). hls.js measures the connection while it plays and picks the best
// quality piece by piece ("Auto"), starting from the last speed it measured, never fetching
// more pixels than the screen can show, and stepping down before the buffer runs out. So it
// starts fast, seeks instantly and doesn't stall on mobile data. "Original" in the quality
// menu plays the untouched file (4K / 8K / HDR) exactly as recorded.
//
// Gestures and keys follow YouTube: tap = show/hide controls, double-tap sides = ±10 s,
// press and hold = 2× speed, swipe up = full screen, swipe down = leave full screen;
// space/k, j/l, ←/→, ↑/↓, m, f, i, 0–9, Home/End, , . (frame), < > (speed).
// ---------------------------------------------------------------------------------------

const SKIP = 10;
const HIDE_AFTER_MS = 3000;
const DOUBLE_TAP_MS = 280;
const HOLD_MS = 450;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const RED = "#ff0033";
const STORE = { resume: "ps.resume", quality: "ps.quality", volume: "ps.volume", muted: "ps.muted", autoplay: "ps.autoplay", bandwidth: "ps.bw" };

const clock = (t) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
const shortSide = (w, h) => Math.min(w || 0, h || 0);
const label4k = (q) => (q >= 4320 ? "8K" : q >= 2160 ? "4K" : q >= 1440 ? "1440p" : `${q}p`);

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
// Where each video was left off, so reopening it carries on like YouTube does.
function readResume(key) {
  return load(STORE.resume, {})[key] || 0;
}
function writeResume(key, time) {
  const all = load(STORE.resume, {});
  if (time) all[key] = Math.round(time);
  else delete all[key];
  const keys = Object.keys(all);
  if (keys.length > 200) delete all[keys[0]];
  save(STORE.resume, all);
}

/**
 * `onControls(visible)` lets the viewer fade its own bars in step. `hold` keeps the controls
 * up (a viewer menu is open); `poke` changes when the viewer's bars are touched.
 * `upNext` (the next item, if it's a video) and `onUpNext` drive Autoplay.
 */
export default function VideoPlayer({ file, onControls, onError, onMenu, hold = false, poke = 0, upNext = null, onUpNext }) {
  const video = useRef(null);
  const root = useRef(null);
  const bar = useRef(null);
  const hls = useRef(null);
  const hideTimer = useRef(null);
  const tap = useRef({ time: 0, timer: null });
  const skipTimer = useRef(null);
  const press = useRef(null); // { x, y, timer, held, type }
  const restore = useRef(null); // { time, playing } carried across a source change
  const holdRef = useRef(hold);

  // ----- What we're playing -----
  const [status, setStatus] = useState(null); // from /api/stream
  const [pref, setPref] = useState(() => load(STORE.quality, "auto")); // "auto" | "original" | 1080 …
  const [mode, setMode] = useState(null); // "hls" | "original"
  const [upgrade, setUpgrade] = useState(false); // ok to switch from the original to streaming now
  const [level, setLevel] = useState(-1); // the rung hls.js is playing
  const [levels, setLevels] = useState([]); // [{ q, index }]

  // ----- Playback state -----
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(file.duration || 0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(() => load(STORE.volume, 1));
  const [muted, setMuted] = useState(() => load(STORE.muted, false));
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [autoplay, setAutoplay] = useState(() => load(STORE.autoplay, true));
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [canPip, setCanPip] = useState(false);
  const [fine, setFine] = useState(false); // a mouse: desktop layout (volume slider, play button)

  // ----- UI state -----
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState(null); // null | "main" | "quality" | "speed"
  const [stats, setStats] = useState(false);
  const [scrub, setScrub] = useState(null); // fraction 0..1 while dragging the bar
  const [hover, setHover] = useState(null); // fraction under the mouse on the bar
  const [skip, setSkip] = useState(null); // { side, seconds, id }
  const [flash, setFlash] = useState(null); // { icon | text, id } big centre bubble
  const [boost, setBoost] = useState(false); // press-and-hold 2×
  const [resumed, setResumed] = useState(0);
  const [countdown, setCountdown] = useState(null); // seconds until Up next plays
  const [stuck, setStuck] = useState(false); // the original can't play here and no copy yet

  // The box the picture fills (contain), so controls sit on the video itself.
  const [aspect, setAspect] = useState(() => (file.width && file.height ? file.width / file.height : 0));
  const [box, setBox] = useState(null);
  useEffect(() => {
    const el = root.current;
    if (!el || !aspect) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      let w = W;
      let h = W / aspect;
      if (h > H) {
        h = H;
        w = H * aspect;
      }
      setBox({ w: Math.round(w), h: Math.round(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useBackClose(Boolean(menu), () => setMenu(null));
  useEffect(() => {
    onMenu?.(Boolean(menu));
  }, [menu, onMenu]);
  useBackClose(stats, () => setStats(false));
  useEffect(() => {
    holdRef.current = hold || Boolean(menu);
  }, [hold, menu]);
  useEffect(() => {
    const t = setTimeout(() => {
      setFine(window.matchMedia("(pointer: fine)").matches);
      setCanPip(Boolean(document.pictureInPictureEnabled));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // ===================================================================== Controls visibility
  const show = useCallback((stay = false) => {
    setControls(true);
    clearTimeout(hideTimer.current);
    if (!stay) {
      hideTimer.current = setTimeout(() => {
        if (video.current && !video.current.paused && !holdRef.current) setControls(false);
      }, HIDE_AFTER_MS);
    }
  }, []);
  useEffect(() => {
    if (!poke) return;
    const t = setTimeout(() => show(), 0);
    return () => clearTimeout(t);
  }, [poke, show]);
  useEffect(() => {
    if (hold) return;
    const t = setTimeout(() => show(), 0);
    return () => clearTimeout(t);
  }, [hold, show]);
  const controlsOn = controls || hold || !playing || scrub !== null || Boolean(menu);
  useEffect(() => {
    onControls?.(controlsOn);
  }, [controlsOn, onControls]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const bubble = useCallback((content) => {
    setFlash({ ...content, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [flash]);

  // ===================================================================== Choosing the source
  // Ask the PC whether this video's pieces are ready. Until they are, the original plays,
  // and we check again every few seconds (opening a video moves it to the front of the queue).
  useEffect(() => {
    let alive = true;
    let timer;
    async function check() {
      const s = await fetch(`/api/stream?name=${encodeURIComponent(file.path ?? file.name)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!alive) return;
      setStatus(s ?? { ready: false, failed: "offline" });
      if (s && !s.ready && !s.failed) timer = setTimeout(check, 3000);
    }
    check();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [file.path, file.name]);

  const ready = Boolean(status?.ready);
  // Which source to use. "Original" plays the file itself; anything else streams the pieces.
  useEffect(() => {
    if (!status) return;
    const want = ready && pref !== "original" ? "hls" : "original";
    if (want === mode) return;
    const v = video.current;
    // The pieces became ready while the original is playing smoothly: don't interrupt it.
    // Switch at the next stall or pause (or when Auto is picked in the menu), like YouTube.
    if (mode === "original" && want === "hls" && !upgrade && v && !v.paused && !v.ended && v.readyState >= 3) return;
    const t = setTimeout(() => {
      if (mode && v) restore.current = { time: v.currentTime, playing: !v.paused };
      setMode(want);
    }, 0);
    return () => clearTimeout(t);
  }, [status, ready, pref, mode, upgrade]);

  // Attach the chosen source to the <video>.
  useEffect(() => {
    const v = video.current;
    if (!v || !mode) return;
    let cancelled = false;
    setWaiting(true);
    setStuck(false);
    if (mode === "original") {
      v.src = fileUrl(file);
      v.load();
    } else {
      const url = `/api/hls/${status.key}/master.m3u8`;
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const h = new Hls({
            startLevel: -1,
            capLevelToPlayerSize: true, // never fetch more pixels than the screen shows
            abrEwmaDefaultEstimate: load(STORE.bandwidth, 3_000_000), // start from the last speed seen
            maxBufferLength: 30,
            maxMaxBufferLength: 90,
            backBufferLength: 30,
            startFragPrefetch: true,
          });
          hls.current = h;
          h.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
            const list = data.levels.map((l, index) => ({ q: shortSide(l.width, l.height), index }));
            setLevels(list);
            const fixed = list.find((l) => l.q === pref);
            if (fixed) h.currentLevel = fixed.index;
          });
          h.on(Hls.Events.LEVEL_SWITCHED, (_, data) => setLevel(data.level));
          let lastSave = 0;
          h.on(Hls.Events.FRAG_LOADED, () => {
            if (Date.now() - lastSave > 5000 && h.bandwidthEstimate) {
              lastSave = Date.now();
              save(STORE.bandwidth, Math.round(h.bandwidthEstimate));
            }
          });
          let recovered = 0;
          h.on(Hls.Events.ERROR, (_, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recovered++ < 3) h.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovered++ < 3) h.recoverMediaError();
            else {
              // Streaming isn't working here: fall back to the original file.
              restore.current = { time: v.currentTime, playing: !v.paused };
              setPref("original");
            }
          });
          h.loadSource(url);
          h.attachMedia(v);
        } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
          v.src = url; // iPhone / Safari stream it natively
        } else {
          setPref("original");
        }
      });
    }
    return () => {
      cancelled = true;
      hls.current?.destroy();
      hls.current = null;
      setLevels([]);
      setLevel(-1);
      v.removeAttribute("src");
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status?.key]);

  function chooseQuality(q) {
    setMenu(null);
    save(STORE.quality, q === "original" || q === "auto" ? q : Number(q));
    if (q === "original") return setPref("original");
    setUpgrade(true);
    setPref(q);
    const h = hls.current;
    if (!h) return; // switches to streaming via the effect above
    if (q === "auto") h.currentLevel = -1;
    else {
      const l = levels.find((x) => x.q === q);
      if (l) h.currentLevel = l.index;
    }
    show();
  }

  // The original can't play in this browser (e.g. 8K HEVC on a PC): wait for the pieces.
  function onVideoError() {
    if (mode !== "original") return;
    if (ready) {
      restore.current = { time: video.current?.currentTime || 0, playing: true };
      setPref("auto");
    } else if (status?.failed) onError?.();
    else setStuck(true);
  }
  useEffect(() => {
    if (stuck && ready) {
      const t = setTimeout(() => {
        restore.current = { time: 0, playing: true };
        setPref("auto");
      }, 0);
      return () => clearTimeout(t);
    }
    if (stuck && status?.failed) onError?.();
  }, [stuck, ready, status?.failed, onError]);

  // ===================================================================== Playback
  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) {
      v.play().catch(() => {});
      return true;
    }
    v.pause();
    return false;
  }, []);

  const seekTo = useCallback((t) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, t), v.duration || Infinity);
    setTime(v.currentTime);
    setEnded(false);
  }, []);
  const seekBy = useCallback((s) => seekTo((video.current?.currentTime || 0) + s), [seekTo]);

  // Double-tap skipping stacks up: 10 s, 20 s, 30 s…
  const skipFrom = useCallback(
    (side, seconds = SKIP) => {
      seekBy(side === "left" ? -seconds : seconds);
      setSkip((s) => ({ side, seconds: s?.side === side ? s.seconds + seconds : seconds, id: Date.now() }));
      clearTimeout(skipTimer.current);
      skipTimer.current = setTimeout(() => setSkip(null), 650);
    },
    [seekBy]
  );

  const setVol = useCallback((value) => {
    const v = video.current;
    if (!v) return;
    v.volume = Math.min(1, Math.max(0, value));
    v.muted = v.volume === 0;
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = root.current;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await (el.requestFullscreen?.() ?? video.current?.webkitEnterFullscreen?.());
        // Landscape videos turn the phone sideways, like YouTube's full screen.
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

  const togglePip = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.current?.requestPictureInPicture();
    } catch {}
  }, []);

  const setSpeed = useCallback((s) => {
    if (video.current) video.current.playbackRate = Math.round(s * 100) / 100;
  }, []);

  // Save the position now and then, and when leaving.
  useEffect(() => {
    const v = video.current;
    const keep = () => {
      if (!v || !v.duration) return;
      writeResume(file.key, v.currentTime > 5 && v.currentTime < v.duration - 5 ? v.currentTime : 0);
    };
    const timer = setInterval(keep, 4000);
    return () => {
      clearInterval(timer);
      keep();
    };
  }, [file.key]);

  // Lock screen / notification controls (Android, Chrome).
  useEffect(() => {
    const ms = typeof navigator !== "undefined" && navigator.mediaSession;
    if (!ms) return;
    try {
      ms.metadata = new window.MediaMetadata({ title: file.name, artist: "Puneet Studios", artwork: [{ src: thumbUrl(file), sizes: "512x512", type: "image/jpeg" }] });
      ms.setActionHandler("play", () => video.current?.play());
      ms.setActionHandler("pause", () => video.current?.pause());
      ms.setActionHandler("seekbackward", (d) => seekBy(-(d.seekOffset || SKIP)));
      ms.setActionHandler("seekforward", (d) => seekBy(d.seekOffset || SKIP));
      ms.setActionHandler("seekto", (d) => seekTo(d.seekTime));
      ms.setActionHandler("nexttrack", upNext && onUpNext ? () => onUpNext() : null);
    } catch {}
    return () => {
      try {
        ["play", "pause", "seekbackward", "seekforward", "seekto", "nexttrack"].forEach((a) => ms.setActionHandler(a, null));
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.key, upNext, onUpNext, seekBy, seekTo]);

  // ----- Autoplay: when a video ends and the next item is a video, play it after 5 s.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      const t = setTimeout(() => {
        setCountdown(null);
        onUpNext?.();
      }, 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, onUpNext]);

  // ===================================================================== Keyboard (YouTube's keys)
  useEffect(() => {
    function onKey(e) {
      if (e.target.closest?.("input, textarea, [role=dialog]") || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = video.current;
      if (!v) return;
      const k = e.key;
      const lower = k.toLowerCase();
      if (k === " " || lower === "k") {
        e.preventDefault();
        bubble({ icon: togglePlay() ? "play" : "pause" });
      } else if (lower === "j") skipFrom("left");
      else if (lower === "l") skipFrom("right");
      else if (k === "ArrowLeft") skipFrom("left", 5);
      else if (k === "ArrowRight") skipFrom("right", 5);
      else if (k === "ArrowUp" || k === "ArrowDown") {
        e.preventDefault();
        setVol(v.volume + (k === "ArrowUp" ? 0.05 : -0.05));
        bubble({ text: `${Math.round(v.volume * 100)}%`, icon: v.volume === 0 ? "mute" : "volume" });
      } else if (lower === "m") {
        v.muted = !v.muted;
        bubble({ icon: v.muted ? "mute" : "volume" });
      } else if (lower === "f") toggleFullscreen();
      else if (lower === "i") togglePip();
      else if (/^[0-9]$/.test(k) && v.duration) seekTo((Number(k) / 10) * v.duration);
      else if (k === "Home") seekTo(0);
      else if (k === "End" && v.duration) seekTo(v.duration);
      else if (k === "," && v.paused) seekBy(-1 / 30);
      else if (k === "." && v.paused) seekBy(1 / 30);
      else if (k === "<" || k === ">") {
        const i = SPEEDS.indexOf(v.playbackRate);
        const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i === -1 ? 3 : i) + (k === ">" ? 1 : -1)))];
        setSpeed(next);
        bubble({ text: `${next}x` });
      } else return;
      e.stopPropagation();
      show();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, skipFrom, togglePlay, toggleFullscreen, togglePip, seekTo, seekBy, setVol, setSpeed, bubble]);

  // ===================================================================== Touch & mouse on the picture
  function onSurfaceDown(e) {
    if (e.target.closest("[data-control]")) return;
    const p = { x: e.clientX, y: e.clientY, held: false, type: e.pointerType };
    // Press and hold: 2× speed while the finger (or mouse button) stays down.
    p.timer = setTimeout(() => {
      const v = video.current;
      if (!v || v.paused) return;
      p.held = true;
      p.rate = v.playbackRate;
      v.playbackRate = 2;
      setBoost(true);
      navigator.vibrate?.(10);
    }, HOLD_MS);
    press.current = p;
  }
  function onSurfaceMove(e) {
    if (e.pointerType === "mouse") {
      // A mouse is in use (also on touch-screen laptops): computer layout.
      if (!fine) setFine(true);
      show();
    }
    const p = press.current;
    if (p && !p.held && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) clearTimeout(p.timer);
  }
  function endHold() {
    const p = press.current;
    if (!p) return false;
    clearTimeout(p.timer);
    if (p.held) {
      if (video.current) video.current.playbackRate = p.rate;
      setBoost(false);
    }
    return p.held;
  }
  function onSurfaceUp(e) {
    const p = press.current;
    const wasHeld = endHold();
    press.current = null;
    if (wasHeld || e.target.closest("[data-control]")) return;
    const dx = p ? e.clientX - p.x : 0;
    const dy = p ? e.clientY - p.y : 0;
    // Swipe up = full screen, swipe down (in full screen) = back. Sideways swipes belong to
    // the viewer (previous / next).
    if (e.pointerType !== "mouse" && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      if (dy < 0 && !document.fullscreenElement) toggleFullscreen();
      else if (dy > 0 && document.fullscreenElement) toggleFullscreen();
      return;
    }
    if (Math.hypot(dx, dy) > 12) return;
    if (menu) {
      setMenu(null);
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
        bubble({ icon: togglePlay() ? "play" : "pause" });
        show();
      }, DOUBLE_TAP_MS);
      return;
    }

    const side = x < 0.35 ? "left" : x > 0.65 ? "right" : "middle";
    const now = Date.now();
    const recent = now - tap.current.time < DOUBLE_TAP_MS * 1.4;
    if ((recent || skip) && side !== "middle" && (skip ? skip.side === side : true)) {
      clearTimeout(tap.current.timer);
      tap.current.time = now;
      skipFrom(side);
      return;
    }
    tap.current.time = now;
    clearTimeout(tap.current.timer);
    tap.current.timer = setTimeout(() => {
      if (controlsOn && playing) {
        clearTimeout(hideTimer.current);
        setControls(false);
      } else show();
    }, DOUBLE_TAP_MS);
  }

  // ===================================================================== Seek bar
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
    else if (e.pointerType === "mouse") setHover(fractionAt(e.clientX));
  }
  function onBarUp(e) {
    if (scrub === null) return;
    const f = fractionAt(e.clientX);
    if (duration) seekTo(f * duration);
    setScrub(null);
    show();
  }

  // ===================================================================== Derived
  const shown = scrub !== null ? scrub * duration : time;
  const pct = duration ? (shown / duration) * 100 : 0;
  const bufferedPct = duration ? (buffered / duration) * 100 : 0;
  const previewAt = scrub ?? hover; // fraction to preview on the bar
  const source = status?.source;
  const originalQ = source ? shortSide(source.width, source.height) : 0;
  const originalLabel = `Original · ${label4k(originalQ)}${source?.hdr ? " HDR" : ""}`;
  const playingQ = mode === "original" ? originalQ : (levels.find((l) => l.index === level)?.q ?? 0);
  const ladder = status?.ladder ?? [];
  const qualityText =
    pref === "original" || mode === "original"
      ? mode === "original" && pref !== "original" && !ready
        ? `Original${status?.progress != null ? " · preparing" : ""}`
        : label4k(originalQ) + (source?.hdr ? " HDR" : "")
      : pref === "auto"
        ? `Auto${playingQ ? ` (${playingQ}p)` : ""}`
        : `${pref}p`;
  const hd = playingQ >= 720;
  const fade = `transition-opacity duration-200 ${controlsOn ? "opacity-100" : "pointer-events-none opacity-0"}`;
  const ui = { pointerEvents: controlsOn ? "auto" : "none" };

  return (
    <div
      ref={root}
      data-player
      onPointerDown={onSurfaceDown}
      onPointerMove={onSurfaceMove}
      onPointerUp={onSurfaceUp}
      onPointerCancel={() => {
        endHold();
        press.current = null;
      }}
      onPointerLeave={(e) => e.pointerType === "mouse" && endHold()}
      onContextMenu={(e) => e.preventDefault()}
      // While holding for 2×, a moving finger mustn't become a swipe in the viewer.
      onTouchMove={(e) => boost && e.stopPropagation()}
      className={`relative flex h-full w-full select-none items-center justify-center overflow-hidden bg-black ${controlsOn ? "" : "cursor-none"}`}
    >
      {/* The video and its controls sit in a box the shape of the video, like YouTube:
          the bar and buttons are on the picture, not at the bottom of the screen. */}
      <div className={box ? "relative" : "absolute inset-0"} style={box ? { width: box.w, height: box.h } : undefined}>
      <video
        ref={video}
        poster={thumbUrl(file)}
        autoPlay
        playsInline
        preload="auto"
        loop={loop}
        className="h-full w-full object-contain"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration);
          if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
          v.volume = volume;
          v.muted = muted;
          // Carry on from where we were (quality change) or where it was left last time.
          const back = restore.current;
          restore.current = null;
          if (back) {
            if (back.time) v.currentTime = back.time;
            if (back.playing) v.play().catch(() => {});
            return;
          }
          const at = readResume(file.key);
          if (at > 5 && at < v.duration - 5) {
            v.currentTime = at;
            setResumed(at);
            setTimeout(() => setResumed(0), 5000);
          }
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setTime(v.currentTime);
          const b = v.buffered;
          for (let i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime + 0.5 && b.end(i) >= v.currentTime) setBuffered(b.end(i));
        }}
        onProgress={(e) => {
          const v = e.currentTarget;
          const b = v.buffered;
          for (let i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime + 0.5 && b.end(i) >= v.currentTime) setBuffered(b.end(i));
        }}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
          setCountdown(null);
          show();
        }}
        onPause={() => {
          setPlaying(false);
          show(true);
          if (mode === "original" && ready) setUpgrade(true);
        }}
        onEnded={() => {
          setEnded(true);
          setPlaying(false);
          writeResume(file.key, 0);
          show(true);
          if (autoplay && upNext && onUpNext) setCountdown(5);
        }}
        onWaiting={() => {
          setWaiting(true);
          if (mode === "original" && ready) setUpgrade(true); // the original is stalling: stream instead
        }}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onSeeked={() => setWaiting(false)}
        onVolumeChange={(e) => {
          const v = e.currentTarget;
          setVolume(v.volume);
          setMuted(v.muted);
          save(STORE.volume, v.volume);
          save(STORE.muted, v.muted);
        }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
        onEnterPictureInPicture={() => setPip(true)}
        onLeavePictureInPicture={() => setPip(false)}
        onError={onVideoError}
      />

      {/* Double-tap left/right ripple */}
      {skip && (
        <div
          key={skip.id}
          className={`pointer-events-none absolute inset-y-0 flex w-[38%] items-center justify-center bg-white/10 anim-fade ${skip.side === "left" ? "left-0 rounded-r-[50%]" : "right-0 rounded-l-[50%]"}`}
        >
          <div className="flex flex-col items-center gap-1 text-[#fff]">
            {skip.side === "left" ? <BackTenIcon size={30} /> : <ForwardTenIcon size={30} />}
            <span className="text-xs font-semibold tabular-nums">{skip.seconds} seconds</span>
          </div>
        </div>
      )}

      {/* Press and hold: 2× */}
      {boost && (
        <div className="anim-fade pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3.5 py-1.5 text-sm font-semibold text-[#fff] backdrop-blur">
          2x <PlayIcon size={11} /> <PlayIcon size={11} className="-ml-1.5" />
        </div>
      )}

      {/* Centre bubble for clicks and keys (play, pause, volume, speed) */}
      {flash && (
        <div key={flash.id} className="yt-flash pointer-events-none absolute left-1/2 top-1/2 flex h-16 min-w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1.5 rounded-full bg-black/55 px-4 text-[#fff]">
          {flash.icon === "play" && <PlayIcon size={26} className="translate-x-0.5" />}
          {flash.icon === "pause" && <PauseIcon size={26} />}
          {flash.icon === "volume" && <VolumeIcon size={22} />}
          {flash.icon === "mute" && <MuteIcon size={22} />}
          {flash.text && <span className="text-base font-semibold tabular-nums">{flash.text}</span>}
        </div>
      )}

      {/* Middle: play / pause (phones), or the spinner while loading */}
      {stuck ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-8 text-center text-[#fff]">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
          <p className="text-sm font-medium">Getting this video ready to play here…</p>
          <p className="text-xs text-[#fff]/60">{status?.progress != null ? `${Math.round(status.progress * 100)}%` : "Waiting for the PC"}</p>
        </div>
      ) : waiting && !ended && (playing || !mode) ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-white/20 border-t-white" aria-label="Loading" />
        </div>
      ) : countdown === null && (!fine || !playing || ended) ? (
        <div className={`pointer-events-none absolute inset-0 flex items-center justify-center ${fade}`}>
          <button
            data-control
            aria-label={ended ? "Replay" : playing ? "Pause" : "Play"}
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
              show();
            }}
            style={ui}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-[#fff] backdrop-blur-sm transition-transform active:scale-90"
          >
            {ended ? <ReplayIcon size={28} strokeWidth={2.2} /> : playing ? <PauseIcon size={26} /> : <PlayIcon size={26} className="translate-x-0.5" />}
          </button>
        </div>
      ) : null}


      {resumed > 0 && (
        <div data-control className="anim-rise absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-black/70 py-1.5 pl-4 pr-1.5 text-xs text-[#fff] backdrop-blur">
          Carrying on from {clock(resumed)}
          <button
            onClick={() => {
              seekTo(0);
              setResumed(0);
            }}
            className="rounded-full bg-white/15 px-3 py-1.5 font-medium"
          >
            Start over
          </button>
        </div>
      )}


      {/* While the controls are hidden, a thin progress line stays at the bottom. */}
      {!controlsOn && duration > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
          <div className="h-full" style={{ width: `${pct}%`, background: RED }} />
        </div>
      )}

      {/* ===== Bottom controls: seek bar, then the button row ===== */}
      <div data-control className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pt-16 sm:px-4 ${fade}`} style={ui}>
        <div
          ref={bar}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
          tabIndex={0}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerLeave={() => setHover(null)}
          onPointerCancel={() => setScrub(null)}
          className="group relative flex h-6 cursor-pointer touch-none items-center"
        >
          <div className={`relative w-full rounded-full bg-white/25 transition-[height] duration-100 ${scrub !== null ? "h-[5px]" : "h-[3px] group-hover:h-[5px]"}`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${bufferedPct}%` }} />
            {hover !== null && scrub === null && <div className="absolute inset-y-0 left-0 rounded-full bg-white/50" style={{ width: `${hover * 100}%` }} />}
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: RED }} />
          </div>
          <div
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-100 ${scrub !== null ? "h-4 w-4 scale-110" : "h-3.5 w-3.5 scale-0 group-hover:scale-100 max-sm:scale-100"}`}
            style={{ left: `${pct}%`, background: RED }}
          />
          {previewAt !== null && duration > 0 && <Preview at={previewAt} duration={duration} storyboard={status?.storyboard} sbUrl={status?.key && `/api/hls/${status.key}/storyboard.jpg`} big={scrub !== null && !fine} />}
        </div>

        <div className="flex h-12 items-center gap-0.5 pb-1 text-[#fff]">
          {fine && (
            <BarButton label={ended ? "Replay (k)" : playing ? "Pause (k)" : "Play (k)"} onClick={() => togglePlay()}>
              {ended ? <ReplayIcon size={22} strokeWidth={2.2} /> : playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
            </BarButton>
          )}
          {fine && upNext && onUpNext && (
            <BarButton label="Next (Shift+N)" onClick={onUpNext}>
              <SkipNextIcon size={20} />
            </BarButton>
          )}
          <span className="group/vol flex items-center">
            <BarButton label={muted || volume === 0 ? "Unmute (m)" : "Mute (m)"} onClick={() => (video.current.muted = !video.current.muted)}>
              {muted || volume === 0 ? <MuteIcon size={21} /> : <VolumeIcon size={21} />}
            </BarButton>
            {fine && (
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => setVol(Number(e.target.value))}
                aria-label="Volume"
                className="yt-volume w-0 opacity-0 transition-all duration-200 group-hover/vol:mr-2 group-hover/vol:w-16 group-hover/vol:opacity-100 focus:mr-2 focus:w-16 focus:opacity-100"
                style={{ "--fill": `${(muted ? 0 : volume) * 100}%` }}
              />
            )}
          </span>
          <span className="ml-1 whitespace-nowrap text-[13px] font-medium tabular-nums">
            {clock(shown)} <span className="text-[#fff]/60">/ {clock(duration)}</span>
          </span>
          <span className="flex-1" />
          {fine && upNext && onUpNext && (
            <button
              aria-label={`Autoplay is ${autoplay ? "on" : "off"}`}
              title={`Autoplay is ${autoplay ? "on" : "off"}`}
              onClick={() => {
                setAutoplay((a) => (save(STORE.autoplay, !a), !a));
              }}
              className="mx-1.5 flex h-11 items-center"
            >
              <Toggle on={autoplay} />
            </button>
          )}
          <span className="relative">
            <BarButton label="Settings" onClick={() => setMenu((m) => (m ? null : "main"))}>
              <GearIcon size={21} className={`transition-transform duration-300 ${menu ? "rotate-45" : ""}`} />
              {(hd || mode === "original") && playingQ >= 720 && (
                <span className="absolute right-1 top-1.5 rounded-[3px] px-[3px] text-[8px] font-bold leading-[11px] text-[#fff]" style={{ background: RED }}>
                  {playingQ >= 2160 ? "4K" : "HD"}
                </span>
              )}
            </BarButton>
          </span>
          {canPip && (
            <BarButton label={pip ? "Exit picture-in-picture (i)" : "Picture-in-picture (i)"} onClick={togglePip}>
              <PipIcon size={21} />
            </BarButton>
          )}
          <BarButton label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"} onClick={toggleFullscreen}>
            {fullscreen ? <ShrinkIcon size={21} /> : <ExpandIcon size={21} />}
          </BarButton>
        </div>
      </div>

      </div>

      {/* Up next (Autoplay) */}
      {countdown !== null && upNext && (
        <div data-control className="anim-fade absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 px-6 text-[#fff]">
          <p className="text-xs font-medium uppercase tracking-wider text-[#fff]/60">Up next in {countdown}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbUrl(upNext)} alt="" className="aspect-video w-56 max-w-full rounded-xl object-cover" />
          <p className="max-w-xs truncate text-sm font-medium">{upNext.name}</p>
          <div className="flex gap-3">
            <button onClick={() => setCountdown(null)} className="rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold hover:bg-white/25">
              Cancel
            </button>
            <button
              onClick={() => {
                setCountdown(null);
                onUpNext?.();
              }}
              className="rounded-full bg-[#fff] px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90"
            >
              Play now
            </button>
          </div>
        </div>
      )}

      {stats && (
        <Stats
          video={video}
          hls={hls}
          file={file}
          source={source}
          mode={mode}
          pref={pref}
          playingQ={playingQ}
          onClose={() => setStats(false)}
        />
      )}

      {/* ===== Settings (gear) ===== */}
      {menu && (
        <SettingsMenu
          page={menu}
          setPage={setMenu}
          sheet={!fine}
          qualityText={qualityText}
          rate={rate}
          loop={loop}
          autoplay={autoplay}
          showAutoplay={!fine && Boolean(upNext && onUpNext)}
          stats={stats}
          onLoop={() => setLoop((l) => !l)}
          onAutoplay={() => setAutoplay((a) => (save(STORE.autoplay, !a), !a))}
          onStats={() => {
            setStats((s) => !s);
            setMenu(null);
          }}
          onSpeed={(s) => {
            setSpeed(s);
            show();
          }}
          quality={{ pref, mode, ready, ladder, levels, playingQ, originalLabel, progress: status?.progress, failed: status?.failed }}
          onQuality={chooseQuality}
        />
      )}
    </div>
  );
}

// ----- Seek preview: the picture at that moment (from the storyboard), and the time.
function Preview({ at, duration, storyboard: sb, sbUrl, big }) {
  const t = at * duration;
  const scale = big ? 1.35 : 1;
  const w = sb ? sb.w * scale : 0;
  const h = sb ? sb.h * scale : 0;
  const i = sb ? Math.min(sb.count - 1, Math.floor(t / sb.interval)) : 0;
  const half = Math.max(w, 48) / 2 + 4;
  return (
    <div className="pointer-events-none absolute bottom-7 flex -translate-x-1/2 flex-col items-center gap-1" style={{ left: `clamp(${half}px, ${at * 100}%, calc(100% - ${half}px))` }}>
      {sb && sbUrl && (
        <div
          className="overflow-hidden rounded-lg border-2 border-[#fff] bg-black shadow-xl"
          style={{
            width: w,
            height: h,
            backgroundImage: `url(${sbUrl})`,
            backgroundSize: `${sb.cols * w}px ${sb.rows * h}px`,
            backgroundPosition: `-${(i % sb.cols) * w}px -${Math.floor(i / sb.cols) * h}px`,
          }}
        />
      )}
      <span className="rounded bg-black/70 px-1.5 py-0.5 text-[13px] font-semibold tabular-nums text-[#fff]">{clock(t)}</span>
    </div>
  );
}

function Toggle({ on }) {
  return (
    <span className={`relative inline-flex h-[14px] w-9 items-center rounded-full transition-colors ${on ? "bg-white/70" : "bg-white/30"}`}>
      <span
        className={`absolute flex h-5 w-5 items-center justify-center rounded-full shadow transition-transform ${on ? "translate-x-4 bg-[#fff] text-black" : "-translate-x-0.5 bg-zinc-300 text-zinc-700"}`}
      >
        {on ? <PlayIcon size={9} /> : <PauseIcon size={9} />}
      </span>
    </span>
  );
}

// ----- The gear menu: Quality, Playback speed, Loop, Autoplay, Stats for nerds.
// A panel above the bar on a computer; a sheet from the bottom on a phone.
function SettingsMenu({ page, setPage, sheet, qualityText, rate, loop, autoplay, showAutoplay, stats, onLoop, onAutoplay, onStats, onSpeed, quality, onQuality }) {
  const row = "flex w-full items-center gap-4 px-4 text-left text-sm text-[#fff] transition-colors hover:bg-white/10 active:bg-white/10 " + (sheet ? "h-14" : "h-11");
  const header = (title) => (
    <button onClick={() => setPage("main")} className={`${row} border-b border-white/10 font-medium`}>
      <ChevronLeftIcon size={18} /> {title}
    </button>
  );
  const check = (on) => <span className="flex w-5 justify-center">{on && <CheckIcon size={18} strokeWidth={2.4} />}</span>;

  let body;
  if (page === "quality") {
    const { pref, mode, ready, ladder, levels, playingQ, originalLabel, progress, failed } = quality;
    const autoOn = pref === "auto" && mode !== "original";
    body = (
      <>
        {header("Quality")}
        <button onClick={() => onQuality("original")} className={row}>
          {check(mode === "original" && (pref === "original" || !ready))}
          <span className="flex-1">{originalLabel}</span>
          <span className="text-[11px] text-[#fff]/50">exact file</span>
        </button>
        {ready ? (
          ladder.map((r) => (
            <button key={r.q} onClick={() => onQuality(r.q)} disabled={!levels.length && mode === "hls"} className={row}>
              {check(pref === r.q && mode === "hls")}
              <span className="flex-1">
                {r.q}p{r.q >= 720 && <sup className="ml-0.5 text-[9px] font-bold text-[#ff4d6d]">HD</sup>}
              </span>
            </button>
          ))
        ) : (
          <p className="px-4 py-3 text-xs leading-relaxed text-[#fff]/55">
            {failed && failed !== "offline"
              ? "Lighter qualities couldn't be made for this video."
              : `Lighter qualities are being made on the PC${progress != null ? ` (${Math.round(progress * 100)}%)` : ""}. Auto turns on by itself when they're ready.`}
          </p>
        )}
        <button onClick={() => onQuality("auto")} disabled={!ready} className={`${row} disabled:opacity-40`}>
          {check(autoOn)}
          <span className="flex-1">Auto{autoOn && playingQ ? ` (${playingQ}p)` : ""}</span>
          <span className="text-[11px] text-[#fff]/50">best for your connection</span>
        </button>
      </>
    );
  } else if (page === "speed") {
    body = (
      <>
        {header("Playback speed")}
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="w-12 text-center text-sm font-semibold tabular-nums text-[#fff]">{rate.toFixed(2)}x</span>
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={rate}
            onChange={(e) => onSpeed(Number(e.target.value))}
            aria-label="Custom speed"
            className="yt-volume flex-1"
            style={{ "--fill": `${((rate - 0.25) / 1.75) * 100}%` }}
          />
        </div>
        <div className={sheet ? "" : "max-h-64 overflow-y-auto"}>
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => onSpeed(s)} className={row}>
              {check(Math.abs(s - rate) < 0.001)}
              {s === 1 ? "Normal" : s}
            </button>
          ))}
        </div>
      </>
    );
  } else {
    const item = (icon, title, value, onClick, arrow = true) => (
      <button onClick={onClick} className={row}>
        <span className="text-[#fff]/90">{icon}</span>
        <span className="flex-1">{title}</span>
        <span className="text-[13px] text-[#fff]/60">{value}</span>
        {arrow && <ChevronRightIcon size={16} className="text-[#fff]/50" />}
      </button>
    );
    body = (
      <>
        {item(<QualityIcon size={20} />, "Quality", qualityText, () => setPage("quality"))}
        {item(<SpeedIcon size={20} />, "Playback speed", rate === 1 ? "Normal" : `${rate}x`, () => setPage("speed"))}
        {item(<LoopIcon size={20} />, "Loop video", <Toggle on={loop} />, onLoop, false)}
        {showAutoplay && item(<SkipNextIcon size={18} />, "Autoplay next video", <Toggle on={autoplay} />, onAutoplay, false)}
        {item(<ChartIcon size={20} />, "Stats for nerds", stats ? "On" : "", onStats, false)}
      </>
    );
  }

  if (sheet) {
    return (
      <div data-control className="absolute inset-0 z-30 flex items-end bg-black/40" onClick={(e) => e.target === e.currentTarget && setPage(null)}>
        <div className="anim-rise mx-auto max-h-[85%] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[#212121] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl">
          <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-white/25" />
          {body}
        </div>
      </div>
    );
  }
  return (
    <div data-control className="anim-pop absolute bottom-16 right-3 z-30 w-72 overflow-hidden rounded-xl bg-[#1c1c1c]/95 py-1.5 shadow-2xl backdrop-blur">
      {body}
    </div>
  );
}

// ----- Stats for nerds: what's actually playing and how the connection is doing.
function Stats({ video, hls, file, source, mode, pref, playingQ, onClose }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const v = video.current;
  const h = hls.current;
  const q = v?.getVideoPlaybackQuality?.();
  let ahead = 0;
  if (v) for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
  const rows = [
    ["Video", file.name],
    ["Playing", mode === "original" ? "Original file" : `Streaming ${playingQ ? `${playingQ}p` : "…"} (${pref === "auto" ? "Auto" : "fixed"})`],
    ["Current res", v ? `${v.videoWidth}x${v.videoHeight}` : "—"],
    ["Original", source ? `${source.width}x${source.height}@${source.fps ?? "?"} ${source.codec ?? ""}${source.hdr ? ` ${source.hdr.toUpperCase()}` : ""} · ${Math.round((source.bitrate || 0) / 1e5) / 10} Mbps` : "—"],
    ["Viewport", viewportOf(v)],
    ["Frames", q ? `${q.droppedVideoFrames} dropped of ${q.totalVideoFrames}` : "—"],
    ["Connection", h?.bandwidthEstimate ? `${Math.round(h.bandwidthEstimate / 1000).toLocaleString()} Kbps` : "—"],
    ["Buffer health", `${ahead.toFixed(2)} s`],
    ["Volume", v ? `${Math.round(v.volume * 100)}%${v.muted ? " (muted)" : ""}` : "—"],
    ["Speed", v ? `${v.playbackRate}x` : "—"],
  ];
  return (
    <div data-control className="absolute left-2 top-2 z-20 max-w-[min(26rem,calc(100%-1rem))] rounded-lg bg-black/75 p-3 pr-9 font-mono text-[11px] leading-[1.5] text-[#fff] backdrop-blur">
      <button aria-label="Close stats" onClick={onClose} className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15">
        <CloseIcon size={14} />
      </button>
      {rows.map(([k, val]) => (
        <div key={k} className="flex gap-2">
          <span className="w-24 shrink-0 text-right font-semibold text-[#fff]/70">{k}</span>
          <span className="min-w-0 break-all">{val}</span>
        </div>
      ))}
    </div>
  );
}
const viewportOf = (v) => (v ? `${Math.round(v.clientWidth)}x${Math.round(v.clientHeight)} × ${window.devicePixelRatio}` : "—");

function BarButton({ label, onClick, children }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="relative flex h-11 min-w-11 items-center justify-center rounded-full px-2 transition-colors hover:bg-white/10 active:bg-white/15"
    >
      {children}
    </button>
  );
}
