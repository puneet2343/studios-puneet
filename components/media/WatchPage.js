"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloseIcon,
  DownloadIcon,
  FolderIcon,
  FolderPlusIcon,
  HeartFilledIcon,
  HeartIcon,
  InfoIcon,
  MusicIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RotateRightIcon,
  ScissorsIcon,
  TrashIcon,
} from "@/components/icons";
import { app } from "@/components/appBridge";
import VideoPlayer from "@/components/media/VideoPlayer";
import { downloadUrl, thumbUrl } from "@/components/media/urls";
import { formatDuration, formatSize } from "@/lib/format";

// ---------------------------------------------------------------------------------------
// The watch page, laid out like the YouTube app:
//   phone:    the video at the top (16:9 for sideways videos, taller for upright ones),
//             then title, details ("…more"), the album row, a row of round action buttons,
//             and "Up next" videos as big cards below. Turn the phone sideways and the
//             video fills the screen; swipe up for full screen, swipe down to close.
//   computer: video and details on the left, the "Up next" list on the right.
// ---------------------------------------------------------------------------------------

const MORE_STEP = 24;

// "20261108_211645.mp4" says nothing; show when it was taken instead. Real names stay.
function titleOf(file) {
  const bare = file.name.replace(/\.[^.]+$/, "");
  if (/^(VID|PXL|IMG|MVIMG)?[_-]?\d{8}[_-]\d{6}/i.test(bare) || /^\d{8}_\d{6}/.test(bare)) {
    const d = new Date(file.taken);
    return `${d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}`;
  }
  return bare;
}

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const units = [
    [365 * 86400, "year"],
    [30 * 86400, "month"],
    [7 * 86400, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, unit] of units) {
    const n = Math.floor(s / size);
    if (n >= 1) return `${n} ${unit}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

const albumOf = (file) => {
  const parts = (file.path ?? file.name).split("/").slice(0, -1);
  return { name: parts.at(-1) || "Library", where: parts.slice(0, -1).join(" › ") };
};
const quality = (file) => {
  const q = Math.min(file.width || 0, file.height || 0);
  return q >= 4320 ? "8K" : q >= 2160 ? "4K" : q >= 1440 ? "1440p" : q >= 1080 ? "1080p" : q >= 720 ? "720p" : q ? `${q}p` : null;
};

export default function WatchPage({ file, items, mini = false, onMinimize, onExpand, onClose, onNavigate, onDetails, hold, onRename, onDelete, onTrim, onRotate, onExtractAudio, onFavorite, onAddToAlbum }) {
  const scroller = useRef(null);
  const playerApi = useRef(null);
  const miniDrag = useRef(null);
  const [drag, setDrag] = useState(null); // mini player being swiped away
  const [miniState, setMiniState] = useState({ playing: false, time: 0, duration: 0 });
  const [shown, setShown] = useState(MORE_STEP);

  // The other videos: the ones after this one first (what plays next), then the rest.
  const { upNext, prevVideo, related } = useMemo(() => {
    const videos = (items ?? []).filter((f) => f.kind === "video");
    const i = videos.findIndex((f) => f.path === file.path);
    const after = i === -1 ? videos : videos.slice(i + 1);
    const before = i === -1 ? [] : videos.slice(0, i).reverse();
    return { upNext: after[0] ?? null, prevVideo: i > 0 ? videos[i - 1] : null, related: [...after, ...before].filter((f) => f.path !== file.path) };
  }, [items, file.path]);

  // A new video: back to the top, like YouTube.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    document.querySelector("[data-watch-page]")?.scrollTo?.({ top: 0 });
  }, [file.path]);

  const aspect = file.width && file.height ? file.width / file.height : 16 / 9;

  // In the phone app, a sideways video turns with the phone (like YouTube): hold the phone
  // sideways and the video fills the screen, even with auto-rotate off.
  const wide = aspect > 1.05;
  useEffect(() => {
    app.setWatching(wide && !mini);
    return () => app.setWatching(false);
  }, [wide, mini, file.path]);

  // While the mini player shows, leave room for it at the bottom of the page.
  useEffect(() => {
    if (!mini) return;
    document.body.style.paddingBottom = "5rem";
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [mini]);
  const album = albumOf(file);
  const q = quality(file);
  const meta = [formatDuration(file.duration), formatSize(file.size), q, ago(file.taken)].filter(Boolean);
  const go = (f) => onNavigate(f.path);
  // Stable, so the player's Autoplay countdown isn't restarted by a re-render.
  const nextPath = upNext?.path;
  const prevPath = prevVideo?.path;
  const playNext = useCallback(() => nextPath && onNavigate(nextPath), [nextPath, onNavigate]);
  const playPrev = useCallback(() => prevPath && onNavigate(prevPath), [prevPath, onNavigate]);

  const actions = [
    onFavorite && {
      label: file.favorite ? "Favourited" : "Favourite",
      icon: file.favorite ? <HeartFilledIcon size={18} className="text-pink-400" /> : <HeartIcon size={18} />,
      run: () => onFavorite([file], !file.favorite),
    },
    { label: "Download", icon: <DownloadIcon size={18} />, href: downloadUrl(file) },
    onTrim && { label: "Trim", icon: <ScissorsIcon size={18} />, run: () => onTrim(file) },
    onRotate && { label: "Rotate", icon: <RotateRightIcon size={18} />, run: () => onRotate(file) },
    onExtractAudio && { label: "Save sound", icon: <MusicIcon size={18} />, run: () => onExtractAudio(file) },
    onRename && { label: "Rename", icon: <PencilIcon size={18} />, run: () => onRename(file) },
    { label: "Details", icon: <InfoIcon size={18} />, run: onDetails },
    { label: "Delete", icon: <TrashIcon size={18} />, run: () => onDelete([file.path]), danger: true },
  ].filter(Boolean);

  const details = (
    <div className="px-3 pt-3 lg:px-0">
      <h1 className="line-clamp-2 text-[18px] font-semibold leading-snug text-zinc-50 lg:text-xl">{titleOf(file)}</h1>
      <button onClick={onDetails} className="mt-1 text-left text-[12.5px] text-zinc-400">
        {meta.join(" · ")} <span className="font-semibold text-zinc-200">…more</span>
      </button>

      {/* Like YouTube's channel row: the album it's in, and "Add to album" as the white pill. */}
      <div className="mt-3 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-zinc-300">
          <FolderIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-zinc-50">{album.name}</p>
          {album.where && <p className="truncate text-xs text-zinc-400">{album.where}</p>}
        </div>
        {onAddToAlbum && (
          <button onClick={() => onAddToAlbum(file)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#f1f1f1] px-4 text-sm font-semibold text-[#0f0f0f] active:scale-95">
            <FolderPlusIcon size={17} /> Add to album
          </button>
        )}
      </div>

      {/* Action buttons: a sideways-scrolling row of round grey pills. */}
      <div className="no-scrollbar -mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
        {actions.map((a) => {
          const cls = `flex h-9 shrink-0 items-center gap-2 rounded-full bg-white/10 px-3.5 text-sm font-medium transition-colors hover:bg-white/20 active:bg-white/20 ${
            a.danger ? "text-zinc-100 hover:text-red-300" : "text-zinc-100"
          }`;
          return a.href ? (
            <a key={a.label} href={a.href} download={file.name} className={cls}>
              {a.icon} {a.label}
            </a>
          ) : (
            <button key={a.label} onClick={a.run} className={cls}>
              {a.icon} {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const list = (compact) => (
    <section className={compact ? "" : "mt-4 border-t border-white/10 pt-3"}>
      <h2 className={`text-base font-semibold text-zinc-50 ${compact ? "mb-3" : "mb-3 px-3"}`}>{related.length ? "Up next" : "No other videos"}</h2>
      <div className={compact ? "flex flex-col gap-2" : "flex flex-col gap-5 pb-8"}>
        {related.slice(0, shown).map((f) => (
          <button key={f.path} onClick={() => go(f)} className={`group text-left ${compact ? "flex gap-2 rounded-lg p-1 hover:bg-white/5" : "block"}`}>
            <span className={`relative block shrink-0 overflow-hidden bg-zinc-900 ${compact ? "aspect-video w-[168px] rounded-lg" : "aspect-video w-full"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(f)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
              <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 py-px text-[11.5px] font-semibold tabular-nums text-[#fff]">{formatDuration(f.duration)}</span>
              {f === upNext && <span className="absolute left-1.5 top-1.5 rounded bg-black/80 px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-[#fff]">Next</span>}
            </span>
            <span className={`flex min-w-0 gap-3 ${compact ? "flex-col gap-0.5 pt-0.5" : "px-3 pt-2.5"}`}>
              {!compact && (
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-zinc-400">
                  <FolderIcon size={17} />
                </span>
              )}
              <span className="min-w-0">
                <span className={`line-clamp-2 font-medium leading-snug text-zinc-50 ${compact ? "text-sm" : "text-[15px]"}`}>{titleOf(f)}</span>
                <span className="mt-0.5 block truncate text-xs text-zinc-400">
                  {[albumOf(f).name, formatSize(f.size), ago(f.taken)].join(" · ")}
                </span>
              </span>
            </span>
          </button>
        ))}
        {related.length > shown && (
          <button onClick={() => setShown((n) => n + MORE_STEP)} className="mx-3 h-10 rounded-full border border-white/15 text-sm font-medium text-zinc-100 hover:bg-white/5">
            Show more
          </button>
        )}
      </div>
    </section>
  );

  // ----- Mini player: swipe it sideways or down to close, tap it to open it again -----
  function onMiniDown(e) {
    if (!mini || e.target.closest("button")) return;
    miniDrag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }
  function onMiniMove(e) {
    const d = miniDrag.current;
    if (!d || d.id !== e.pointerId) return;
    setDrag({ x: e.clientX - d.x, y: Math.max(0, e.clientY - d.y) });
  }
  function onMiniUp(e) {
    const d = miniDrag.current;
    miniDrag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setDrag(null);
    if (Math.abs(dx) > 90 || dy > 45) onClose();
    else if (Math.hypot(dx, dy) < 10) onExpand();
  }

  const playBtn = (
    <button
      aria-label={miniState.playing ? "Pause" : "Play"}
      onClick={() => playerApi.current?.toggle()}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-50 hover:bg-white/10 active:bg-white/15"
    >
      {miniState.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
    </button>
  );
  const closeBtn = (
    <button aria-label="Close player" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-50 hover:bg-white/10 active:bg-white/15">
      <CloseIcon size={22} />
    </button>
  );

  // The same elements in both forms, so the video keeps playing without a hiccup when it
  // shrinks to the mini player and grows back.
  return (
    <div
      data-theme="dark"
      data-watch-page={mini ? undefined : ""}
      data-mini-player={mini ? "" : undefined}
      onPointerDown={onMiniDown}
      onPointerMove={onMiniMove}
      onPointerUp={onMiniUp}
      onPointerCancel={() => ((miniDrag.current = null), setDrag(null))}
      style={
        mini && drag
          ? { transform: `translate(${drag.x}px, ${drag.y}px)`, opacity: Math.max(0.2, 1 - Math.max(Math.abs(drag.x) / 260, drag.y / 160)), transition: "none" }
          : undefined
      }
      className={
        mini
          ? "yt-mini fixed inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+0.5rem)] z-[45] touch-none select-none overflow-hidden rounded-xl bg-[#212121] text-zinc-100 shadow-2xl transition-[transform,opacity] duration-200 lg:inset-x-auto lg:bottom-4 lg:right-4 lg:w-[400px] lg:touch-auto"
          : "anim-fade fixed inset-0 z-50 flex flex-col bg-[#0f0f0f] text-zinc-100 lg:block lg:overflow-y-auto"
      }
    >
      <div className={mini ? "" : "flex min-h-0 flex-1 flex-col lg:mx-auto lg:max-w-[1700px] lg:flex-row lg:gap-6 lg:px-6 lg:py-6"}>
        <div className={mini ? "flex items-center lg:flex-col lg:items-stretch" : "flex min-h-0 flex-1 flex-col lg:block lg:min-w-0"}>
          {/* The video. On a phone turned sideways it fills the screen (globals.css). */}
          <div className={mini ? "shrink-0 bg-black" : "shrink-0 bg-black pt-[env(safe-area-inset-top)] lg:pt-0"}>
            <div
              onClick={mini ? () => window.matchMedia("(pointer: fine)").matches && onExpand() : undefined}
              className={
                mini
                  ? "relative h-16 w-[114px] cursor-pointer overflow-hidden bg-black lg:aspect-video lg:h-auto lg:w-full"
                  : "yt-watch-player relative w-full overflow-hidden bg-black lg:rounded-xl"
              }
              style={mini ? undefined : { aspectRatio: String(Math.max(aspect, 0.75)), maxHeight: "min(62vh, calc(100vh - 140px))" }}
            >
              <VideoPlayer
                key={file.path}
                file={file}
                hold={hold}
                bare={mini}
                apiRef={playerApi}
                onState={setMiniState}
                onClose={onMinimize}
                onSwipeDown={onMinimize}
                onPrev={prevVideo ? playPrev : null}
                upNext={upNext}
                onUpNext={upNext ? playNext : null}
              />
            </div>
          </div>

          {mini ? (
            // Mini player: title and album, play/pause, close (YouTube's mini player).
            <div className="flex min-w-0 flex-1 items-center gap-1 pl-3 pr-1 lg:py-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-50">{titleOf(file)}</p>
                <p className="truncate text-xs text-zinc-400">{album.name}</p>
              </div>
              {playBtn}
              {closeBtn}
            </div>
          ) : (
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain lg:overflow-visible">
              {details}
              <div className="lg:hidden">{list(false)}</div>
            </div>
          )}
        </div>
        {!mini && <aside className="hidden w-[402px] shrink-0 lg:block">{list(true)}</aside>}
      </div>
      {mini && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-white/15">
          <div className="h-full bg-[#ff0033]" style={{ width: `${miniState.duration ? (miniState.time / miniState.duration) * 100 : 0}%` }} />
        </div>
      )}
    </div>
  );
}
