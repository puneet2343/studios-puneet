"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DiamondIcon,
  DotsIcon,
  DownloadIcon,
  FileIcon,
  InfoIcon,
  MusicIcon,
  PencilIcon,
  RotateRightIcon,
  ScissorsIcon,
  StarFilledIcon,
  StarIcon,
  TrashIcon,
} from "@/components/icons";
import Properties from "@/components/media/Properties";
import VideoPlayer from "@/components/media/VideoPlayer";
import ZoomableImage from "@/components/media/ZoomableImage";
import useBackClose from "@/components/useBackClose";
import { downloadUrl, fileUrl, thumbUrl } from "@/components/media/urls";
import { formatDuration, formatSize } from "@/lib/format";

const SWIPE_PX = 60;

function IconButton({ label, onClick, href, download, danger, children }) {
  const className = `flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
    danger ? "text-zinc-200 hover:bg-red-500/20 hover:text-red-300" : "text-zinc-200 hover:bg-white/10"
  }`;
  return href ? (
    <a href={href} download={download} aria-label={label} title={label} className={className}>
      {children}
    </a>
  ) : (
    <button onClick={onClick} aria-label={label} title={label} className={className}>
      {children}
    </button>
  );
}

function Stage({ file, onControls, onTap }) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed || (file.kind !== "image" && file.kind !== "video" && file.kind !== "audio")) {
    return (
      <div className="anim-pop flex flex-col items-center text-center text-zinc-400">
        <FileIcon size={40} className="mb-4 text-zinc-600" />
        <p className="text-zinc-200">This file can&apos;t be previewed in the browser</p>
        <p className="mt-1 max-w-xs text-sm text-zinc-500">
          It&apos;s safe on the PC — download it, or open it in DaVinci.
        </p>
      </div>
    );
  }

  if (file.kind === "video") {
    return <VideoPlayer file={file} onControls={onControls} onError={() => setFailed(true)} />;
  }

  if (file.kind === "audio") {
    return <audio src={fileUrl(file)} controls autoPlay onError={() => setFailed(true)} className="anim-pop w-full max-w-md" />;
  }

  // Show the cached thumbnail instantly, then swap in the full image once it arrives.
  return (
    <div className="anim-pop relative flex h-full w-full items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbUrl(file)}
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 h-full w-full object-contain blur-[2px] transition-opacity duration-300 ${
          fullLoaded ? "opacity-0" : "opacity-100"
        }`}
      />
      <ZoomableImage
        src={fileUrl(file)}
        alt={file.name}
        decoding="async"
        onTap={onTap}
        onLoad={() => setFullLoaded(true)}
        onError={() => setFailed(true)}
        className={`relative max-h-full max-w-full object-contain ${fullLoaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

export default function Viewer({ file, prev, next, onClose, onNavigate, onRename, onDelete, onTrim, onRotate, onExtractAudio, onFavorite }) {
  const [showInfo, setShowInfo] = useState(false);
  const [more, setMore] = useState(false);
  useBackClose(more, () => setMore(false));
  const [chrome, setChrome] = useState(true); // tap the photo to hide/show controls
  const [drag, setDrag] = useState(null); // { dx, dy } while a finger is down
  const [enterFrom, setEnterFrom] = useState(null); // slide direction for the next file
  const gesture = useRef(null);

  function go(target, from) {
    setEnterFrom(from);
    onNavigate(target.path);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.target.closest?.("input, textarea, [role=dialog]")) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && prev) {
        setEnterFrom("left");
        onNavigate(prev.path);
      } else if (e.key === "ArrowRight" && next) {
        setEnterFrom("right");
        onNavigate(next.path);
      } else if (e.key === "Delete") onDelete([file.path]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file.path, prev, next, onClose, onNavigate, onDelete]);

  // Warm the cache for neighbouring photos so swiping feels instant.
  useEffect(() => {
    for (const f of [prev, next]) {
      if (f?.kind === "image") new Image().src = fileUrl(f);
    }
  }, [prev, next]);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Swipe gestures follow the finger: sideways browses, downwards closes.
  function onTouchStart(e) {
    // Swipes work on photos and videos alike; only the player's own controls (seek bar,
    // buttons, menus) and a zoomed-in photo keep the finger to themselves.
    if (e.touches.length > 1 || e.target.closest("button, a, aside, [role=dialog], [data-control], [data-zoomed]")) return;
    gesture.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null };
  }
  function onTouchMove(e) {
    const g = gesture.current;
    if (!g) return;
    // A second finger means a pinch-zoom, not a swipe.
    if (e.touches.length > 1) {
      gesture.current = null;
      setDrag(null);
      return;
    }
    const dx = e.touches[0].clientX - g.x;
    const dy = e.touches[0].clientY - g.y;
    if (!g.axis && Math.hypot(dx, dy) > 8) g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (g.axis === "x") {
      // Resist at the ends so it's clear there's nothing more.
      const blocked = (dx > 0 && !prev) || (dx < 0 && !next);
      setDrag({ dx: blocked ? dx * 0.25 : dx, dy: 0 });
    } else if (g.axis === "y") {
      setDrag({ dx: 0, dy: Math.max(0, dy) });
    }
  }
  function onTouchEnd() {
    const g = gesture.current;
    gesture.current = null;
    const d = drag;
    setDrag(null);
    if (!g?.axis || !d) return;
    if (g.axis === "x" && d.dx < -SWIPE_PX && next) go(next, "right");
    else if (g.axis === "x" && d.dx > SWIPE_PX && prev) go(prev, "left");
    else if (g.axis === "y" && d.dy > SWIPE_PX * 1.8) onClose();
  }

  const details = [
    formatSize(file.size),
    file.width && file.height ? `${file.width}×${file.height}` : null,
    file.kind === "video" ? formatDuration(file.duration) : null,
  ].filter(Boolean);

  const dragging = Boolean(drag);
  const pull = drag?.dy ?? 0;
  const stageStyle = {
    transform: `translate3d(${drag?.dx ?? 0}px, ${pull}px, 0) scale(${1 - Math.min(pull, 400) / 1600})`,
    transition: dragging ? "none" : "transform 260ms var(--ease-out)",
  };
  const fade = `transition-[opacity,transform] duration-200 ${chrome && !pull ? "opacity-100" : "pointer-events-none opacity-0"}`;

  return (
    <div
      data-theme="dark"
      className="anim-fade fixed inset-0 z-50 flex touch-none flex-col text-zinc-100"
      style={{ backgroundColor: `rgb(0 0 0 / ${1 - Math.min(pull, 400) / 600})` }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <header
        className={`relative z-10 flex items-center gap-1 bg-gradient-to-b from-black/60 to-transparent px-2 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-3 ${fade} ${
          chrome ? "" : "-translate-y-2"
        }`}
      >
        <IconButton label="Back" onClick={onClose}>
          <ArrowLeftIcon size={20} />
        </IconButton>
        <div className="mx-1 min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
            {file.instagram && <DiamondIcon size={12} className="shrink-0 text-pink-400" />}
            <span className="truncate">{file.name}</span>
          </p>
          <p className="truncate text-xs tabular-nums text-zinc-500">{details.join(" · ")}</p>
        </div>
        <span className="max-sm:hidden">
          <IconButton label="Properties" onClick={() => setShowInfo((v) => !v)}>
            <InfoIcon size={19} />
          </IconButton>
        </span>
        {onFavorite && (
          <IconButton label={file.favorite ? "Remove from favourites" : "Add to favourites"} onClick={() => onFavorite([file], !file.favorite)}>
            {file.favorite ? <StarFilledIcon size={19} className="text-amber-300" /> : <StarIcon size={19} />}
          </IconButton>
        )}
        {file.kind === "video" && onTrim && (
          <IconButton label="Trim" onClick={() => onTrim(file)}>
            <ScissorsIcon size={19} />
          </IconButton>
        )}
        <span className="flex max-sm:hidden">
          {file.kind === "video" && onRotate && (
            <IconButton label="Rotate" onClick={() => onRotate(file)}>
              <RotateRightIcon size={19} />
            </IconButton>
          )}
          {file.kind === "video" && onExtractAudio && (
            <IconButton label="Extract audio" onClick={() => onExtractAudio(file)}>
              <MusicIcon size={19} />
            </IconButton>
          )}
          <IconButton label="Rename" onClick={() => onRename(file)}>
            <PencilIcon size={18} />
          </IconButton>
          <IconButton label="Download" href={downloadUrl(file)} download={file.name}>
            <DownloadIcon size={19} />
          </IconButton>
        </span>
        <IconButton label="Delete" danger onClick={() => onDelete([file.path])}>
          <TrashIcon size={19} />
        </IconButton>
        {/* Phone: the less-used actions live in a menu so the file name stays readable. */}
        <span className="relative sm:hidden">
          <IconButton label="More" onClick={() => setMore((m) => !m)}>
            <DotsIcon size={19} />
          </IconButton>
          {/* Tap anywhere else to close the menu. */}
          {more && <div className="fixed inset-0 z-10" onClick={() => setMore(false)} />}
          {more && (
            <div className="anim-pop absolute right-0 top-11 z-20 w-48 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 py-1.5 shadow-2xl backdrop-blur">
              {[
                { label: "Properties", icon: InfoIcon, run: () => setShowInfo(true) },
                ...(file.kind === "video" && onRotate ? [{ label: "Rotate / mirror", icon: RotateRightIcon, run: () => onRotate(file) }] : []),
                ...(file.kind === "video" && onExtractAudio ? [{ label: "Extract audio", icon: MusicIcon, run: () => onExtractAudio(file) }] : []),
                { label: "Rename", icon: PencilIcon, run: () => onRename(file) },
              ].map(({ label, icon: Icon, run }) => (
                <button
                  key={label}
                  onClick={() => {
                    setMore(false);
                    run();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-100 hover:bg-white/5 active:bg-white/5"
                >
                  <Icon size={18} className="text-zinc-400" /> {label}
                </button>
              ))}
              <a
                href={downloadUrl(file)}
                download={file.name}
                onClick={() => setMore(false)}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-zinc-100 hover:bg-white/5 active:bg-white/5"
              >
                <DownloadIcon size={18} className="text-zinc-400" /> Download to phone
              </a>
            </div>
          )}
        </span>
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-16"
        onClick={(e) => {
          if (!e.target.closest("video, button, a, aside, [data-player], [data-zoomable]")) setChrome((c) => !c);
        }}
      >
        <div className="flex h-full w-full items-center justify-center will-change-transform" style={stageStyle}>
          <div
            key={file.name}
            className={`flex h-full w-full items-center justify-center ${
              enterFrom === "right" ? "anim-from-right" : enterFrom === "left" ? "anim-from-left" : "anim-pop"
            }`}
          >
            <Stage file={file} onControls={setChrome} onTap={() => setChrome((c) => !c)} />
          </div>
        </div>

        {prev && (
          <button
            onClick={() => go(prev, "left")}
            aria-label="Previous"
            className={`absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/5 text-zinc-200 backdrop-blur hover:bg-white/15 sm:flex ${fade}`}
          >
            <ChevronLeftIcon size={22} />
          </button>
        )}
        {next && (
          <button
            onClick={() => go(next, "right")}
            aria-label="Next"
            className={`absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/5 text-zinc-200 backdrop-blur hover:bg-white/15 sm:flex ${fade}`}
          >
            <ChevronRightIcon size={22} />
          </button>
        )}


      </div>

      {showInfo && <Properties file={file} onClose={() => setShowInfo(false)} />}
    </div>
  );
}
