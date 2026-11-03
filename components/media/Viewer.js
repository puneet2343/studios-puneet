"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DotsIcon,
  DownloadIcon,
  FileIcon,
  FolderPlusIcon,
  HeartFilledIcon,
  HeartIcon,
  InfoIcon,
  MusicIcon,
  PencilIcon,
  RotateRightIcon,
  ScissorsIcon,
  TrashIcon,
} from "@/components/icons";
import Properties from "@/components/media/Properties";
import VideoPlayer from "@/components/media/VideoPlayer";
import ZoomableImage from "@/components/media/ZoomableImage";
import useBackClose from "@/components/useBackClose";
import { downloadUrl, fileUrl, thumbUrl } from "@/components/media/urls";
import { formatDuration, formatSize } from "@/lib/format";

const SWIPE_PX = 60;

function IconButton({ label, onClick, href, download, danger, children, caption }) {
  const className = `flex min-w-11 flex-col items-center justify-center gap-0.5 rounded-full px-1 transition-colors ${caption ? "h-14 sm:h-12" : "h-11"} ${
    danger ? "text-zinc-100 hover:bg-red-500/20 hover:text-red-300" : "text-zinc-100 hover:bg-white/10"
  }`;
  children = (
    <>
      {children}
      {caption && <span className="text-[10.5px] font-medium text-zinc-300">{caption}</span>}
    </>
  );
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

export default function Viewer({ file, prev, next, position, onClose, onNavigate, onRename, onDelete, onTrim, onRotate, onExtractAudio, onFavorite, onAddToAlbum }) {
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

  // (No early loading of the next photo: originals aren't cached on the phone, so it would
  // download twice. The thumbnail shows at once while the full photo loads.)

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

  const takenAt = file.taken ? new Date(file.taken) : null;
  const title = takenAt
    ? takenAt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : file.name;
  const details = [
    takenAt && takenAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }),
    file.kind === "video" ? formatDuration(file.duration) : null,
    formatSize(file.size),
    position,
  ].filter(Boolean);

  const dragging = Boolean(drag);
  const pull = drag?.dy ?? 0;
  const stageStyle = {
    transform: `translate3d(${drag?.dx ?? 0}px, ${pull}px, 0) scale(${1 - Math.min(pull, 400) / 1600})`,
    transition: dragging ? "none" : "transform 260ms var(--ease-out)",
  };
  const fade = `transition-[opacity,transform] duration-200 ${chrome && !pull ? "opacity-100" : "pointer-events-none opacity-0"}`;
  const moreItems = [
    { label: "Details", icon: InfoIcon, run: () => setShowInfo(true) },
    { label: "Rename", icon: PencilIcon, run: () => onRename(file) },
    ...(file.kind === "video" && onTrim ? [{ label: "Trim video", icon: ScissorsIcon, run: () => onTrim(file) }] : []),
    ...(file.kind === "video" && onRotate ? [{ label: "Rotate / mirror", icon: RotateRightIcon, run: () => onRotate(file) }] : []),
    ...(file.kind === "video" && onExtractAudio ? [{ label: "Save the sound", icon: MusicIcon, run: () => onExtractAudio(file) }] : []),
  ];
  const arrow =
    "absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-[#fff] backdrop-blur-md transition-colors hover:bg-black/55 active:scale-95 sm:h-12 sm:w-12";

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
        className={`relative z-20 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-2 pb-4 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-3 ${fade} ${
          chrome ? "" : "-translate-y-2"
        }`}
      >
        <IconButton label="Back" onClick={onClose}>
          <ArrowLeftIcon size={22} />
        </IconButton>
        <div className="mx-1 min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-zinc-50">{title}</p>
          <p className="truncate text-xs tabular-nums text-zinc-400">{details.join(" · ")}</p>
        </div>
        <span className="max-sm:hidden">
          <IconButton label="Details" onClick={() => setShowInfo((v) => !v)}>
            <InfoIcon size={20} />
          </IconButton>
        </span>
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden sm:px-16"
        onClick={(e) => {
          if (!e.target.closest("video, button, a, aside, [data-player], [data-zoomable]")) setChrome((c) => !c);
        }}
      >
        <div className="flex h-full w-full items-center justify-center will-change-transform" style={stageStyle}>
          <div
            key={file.path ?? file.name}
            className={`flex h-full w-full items-center justify-center ${
              enterFrom === "right" ? "anim-from-right" : enterFrom === "left" ? "anim-from-left" : "anim-pop"
            }`}
          >
            <Stage file={file} onControls={setChrome} onTap={() => setChrome((c) => !c)} />
          </div>
        </div>

        {/* Previous / next: on phones too (swiping sideways also works). */}
        {prev && (
          <button onClick={() => go(prev, "left")} aria-label="Previous" className={`${arrow} left-2 sm:left-4 ${fade}`}>
            <ChevronLeftIcon size={22} />
          </button>
        )}
        {next && (
          <button onClick={() => go(next, "right")} aria-label="Next" className={`${arrow} right-2 sm:right-4 ${fade}`}>
            <ChevronRightIcon size={22} />
          </button>
        )}
      </div>

      <footer className={`relative z-20 bg-gradient-to-t from-black/75 to-transparent px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-4 ${fade}`}>
        <div className="mx-auto flex max-w-md items-center justify-around">
          <IconButton label="Download original" caption="Download" href={downloadUrl(file)} download={file.name}>
            <DownloadIcon size={21} />
          </IconButton>
          {onFavorite && (
            <IconButton label={file.favorite ? "Remove from favourites" : "Add to favourites"} caption="Favourite" onClick={() => onFavorite([file], !file.favorite)}>
              {file.favorite ? <HeartFilledIcon size={21} className="text-pink-400" /> : <HeartIcon size={21} />}
            </IconButton>
          )}
          {onAddToAlbum && (
            <IconButton label="Add to album" caption="Album" onClick={() => onAddToAlbum(file)}>
              <FolderPlusIcon size={21} />
            </IconButton>
          )}
          <span className="relative">
            <IconButton label="More" caption="More" onClick={() => setMore((m) => !m)}>
              <DotsIcon size={21} className="rotate-90" />
            </IconButton>
            {more && <div className="fixed inset-0 z-10" onClick={() => setMore(false)} />}
            {more && (
              <div className="anim-pop absolute bottom-16 left-1/2 z-20 w-56 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 py-1.5 shadow-2xl backdrop-blur">
                {moreItems.map(({ label, icon: Icon, run }) => (
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
              </div>
            )}
          </span>
          <IconButton label="Delete" caption="Delete" danger onClick={() => onDelete([file.path])}>
            <TrashIcon size={21} />
          </IconButton>
        </div>
      </footer>

      {showInfo && <Properties file={file} onClose={() => setShowInfo(false)} />}
    </div>
  );
}
