"use client";

import { memo, useRef, useState } from "react";
import { CheckIcon, DiamondIcon, FileIcon, ImageIcon, MusicIcon, PlayIcon, StarFilledIcon } from "@/components/icons";
import { formatDuration } from "@/lib/format";
import { thumbUrl } from "@/components/media/urls";

const LONG_PRESS_MS = 420;

function FallbackIcon({ kind }) {
  const Icon = kind === "audio" ? MusicIcon : kind === "image" ? ImageIcon : kind === "video" ? PlayIcon : FileIcon;
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-600">
      <Icon size={kind === "video" ? 20 : 26} />
    </div>
  );
}

function MediaTile({ file, selected, selecting, onOpen, onToggle, onDragSelect }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const pressTimer = useRef(null);
  const longPressed = useRef(false);
  const hasThumb = (file.kind === "image" || file.kind === "video") && !failed;

  // Long-press on touch screens starts multi-select, like a phone gallery.
  function onPointerDown(e) {
    if (e.pointerType !== "touch") return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onToggle(file.path);
      // Keep the finger down and slide over other tiles to select them too.
      onDragSelect?.(file.path);
    }, LONG_PRESS_MS);
  }
  const cancelPress = () => clearTimeout(pressTimer.current);

  function onClick() {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (selecting) onToggle(file.path);
    else onOpen(file.path);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={file.name}
      data-path={file.path}
      aria-pressed={selecting ? selected : undefined}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerMove={(e) => (Math.abs(e.movementX) + Math.abs(e.movementY) > 6 ? cancelPress() : null)}
      onContextMenu={(e) => e.pointerType !== "mouse" && e.preventDefault()}
      className="group relative aspect-square cursor-pointer select-none overflow-hidden bg-zinc-900 outline-none transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:ring-violet-400 active:scale-[0.97]"
    >
      <div
        className={`absolute inset-0 overflow-hidden transition-transform duration-200 ease-out ${
          selected ? "scale-[0.86] rounded-xl" : ""
        }`}
      >
        {hasThumb ? (
          <>
            {!loaded && <div className="skeleton absolute inset-0" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl(file)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              className={`h-full w-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.03] ${
                loaded ? "opacity-100" : "opacity-0"
              }`}
            />
          </>
        ) : (
          <FallbackIcon kind={file.kind} />
        )}
      </div>

      {file.kind === "video" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6 text-[11px] font-medium tabular-nums text-[#fff]">
          <PlayIcon size={9} />
          {formatDuration(file.duration)}
        </div>
      )}

      {file.favorite && (
        <span
          title="Favourite"
          className="pointer-events-none absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-amber-300 shadow-sm backdrop-blur-sm"
        >
          <StarFilledIcon size={11} />
        </span>
      )}

      {file.instagram && (
        <span
          title="Instagram export"
          className="pointer-events-none absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-pink-400 shadow-sm backdrop-blur-sm"
        >
          <DiamondIcon size={11} />
        </span>
      )}

      {file.kind !== "image" && file.kind !== "video" && (
        <p className="pointer-events-none absolute inset-x-0 bottom-0 truncate px-2 pb-1.5 text-[11px] text-zinc-400">
          {file.name}
        </p>
      )}

      <button
        type="button"
        aria-label={selected ? "Deselect" : "Select"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(file.path);
        }}
        className={`absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border transition-all duration-150 ${
          selected
            ? "border-violet-400 bg-violet-500 text-[#fff] opacity-100"
            : `border-[#fff]/70 bg-black/20 text-transparent hover:bg-black/40 ${
                selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:hidden"
              }`
        }`}
      >
        <CheckIcon size={14} strokeWidth={2.6} />
      </button>
    </div>
  );
}

export default memo(MediaTile);
