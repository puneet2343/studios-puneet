"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { CheckIcon, HeartFilledIcon, MusicIcon, FileIcon, PlayIcon } from "@/components/icons";
import { thumbUrl } from "@/components/media/urls";
import { formatDuration } from "@/lib/format";
import { haptic } from "@/lib/haptics";

const LONG_PRESS_MS = 420;

// "Today", "Yesterday", "Monday", "Sat, 18 Oct", "Sat, 18 Oct 2025".
export function dayTitle(t, now) {
  const start = (x) => new Date(new Date(x).toDateString()).getTime();
  const days = Math.round((start(now) - start(t)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const d = new Date(t);
  if (days > 1 && days < 7) return d.toLocaleDateString("en-IN", { weekday: "long" });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function Tile({ file, selected, selecting, onOpen, onToggle, onLongPress }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const press = useRef(null);
  const visual = (file.kind === "image" || file.kind === "video") && !failed;

  const down = (e) => {
    if (e.pointerType === "mouse") return;
    const start = { x: e.clientX, y: e.clientY };
    press.current = {
      start,
      fired: false,
      timer: setTimeout(() => {
        press.current.fired = true;
        onLongPress(file.path);
      }, LONG_PRESS_MS),
    };
  };
  const move = (e) => {
    const p = press.current;
    if (p && !p.fired && Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) > 10) clearTimeout(p.timer);
  };
  const up = () => {
    const p = press.current;
    if (p) clearTimeout(p.timer);
  };
  const click = (e) => {
    if (press.current?.fired) {
      press.current = null;
      return;
    }
    press.current = null;
    if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) onToggle(file.path);
    else onOpen(file.path);
  };

  return (
    <button
      type="button"
      data-path={file.path}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      onClick={click}
      aria-label={file.name}
      aria-pressed={selecting ? selected : undefined}
      className="group relative block aspect-square w-full touch-manipulation overflow-hidden bg-surface outline-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className={`absolute inset-0 transition-transform duration-200 ease-out ${selected ? "scale-[0.86] overflow-hidden rounded-xl" : ""}`}>
        {visual ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl(file)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`tile-img h-full w-full select-none object-cover ${loaded ? "loaded" : ""}`}
          />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 text-zinc-500">
            {file.kind === "audio" ? <MusicIcon size={24} /> : <FileIcon size={24} />}
            <span className="line-clamp-2 break-all text-center text-[10px] leading-tight">{file.name}</span>
          </span>
        )}
        {file.kind === "video" && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#fff] backdrop-blur-sm">
            <PlayIcon size={7} />
            {file.duration ? formatDuration(file.duration) : ""}
          </span>
        )}
        {file.favorite && (
          <span className="absolute bottom-1.5 left-1.5 text-[#fff] drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]">
            <HeartFilledIcon size={15} />
          </span>
        )}
      </span>
      {/* Selection circle: always while selecting; on hover with a mouse. */}
      <span
        onClick={(e) => {
          e.stopPropagation();
          onToggle(file.path);
        }}
        className={`absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-150 ${
          selected
            ? "border-accent bg-accent text-[#fff] opacity-100"
            : `border-[#fff] bg-black/20 text-transparent ${selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:hidden"}`
        }`}
      >
        <CheckIcon size={14} strokeWidth={3} />
      </span>
    </button>
  );
}

const MemoTile = memo(Tile);

/**
 * Photos in a tight grid, grouped by the day they were taken (or one flat group).
 * Tap opens, long-press starts selecting (then slide a finger over more), like Google Photos.
 */
export default function MediaGrid({ files, grouped = true, selected, setSelected, onOpen, now }) {
  const selecting = selected.size > 0;

  const groups = useMemo(() => {
    if (!grouped) return [{ label: null, items: files }];
    const out = [];
    for (const f of files) {
      const label = dayTitle(f.taken, now);
      if (out.at(-1)?.label === label) out.at(-1).items.push(f);
      else out.push({ label, items: [f] });
    }
    return out;
  }, [files, grouped, now]);

  const toggle = useCallback(
    (path) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [setSelected]
  );

  // Long-press, then slide over other photos to add them; the page scrolls near the edges.
  const longPress = useCallback(
    (path) => {
      haptic("tap");
      setSelected((prev) => new Set(prev).add(path));
      const seen = new Set([path]);
      const move = (e) => {
        if (e.cancelable) e.preventDefault();
        const t = e.touches[0];
        const p = document.elementFromPoint(t.clientX, t.clientY)?.closest?.("[data-path]")?.dataset.path;
        if (p && !seen.has(p)) {
          seen.add(p);
          haptic("tick");
          setSelected((prev) => new Set(prev).add(p));
        }
        if (t.clientY > window.innerHeight - 140) window.scrollBy(0, 14);
        else if (t.clientY < 130) window.scrollBy(0, -14);
      };
      const end = () => {
        window.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", end);
        window.removeEventListener("touchcancel", end);
      };
      window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("touchend", end);
      window.addEventListener("touchcancel", end);
    },
    [setSelected]
  );

  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const allOn = selecting && g.items.every((f) => selected.has(f.path));
        return (
          <section key={g.label ?? "all"} className="lazy-section">
            {g.label && (
              <div className="flex items-center gap-2 px-4 pb-2.5 pt-1 sm:px-0">
                <h3 className="text-[15px] font-semibold text-zinc-100">{g.label}</h3>
                {selecting && (
                  <button
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        g.items.forEach((f) => (allOn ? next.delete(f.path) : next.add(f.path)));
                        return next;
                      })
                    }
                    className={`ml-1 flex h-6 w-6 items-center justify-center rounded-full border-2 ${allOn ? "border-accent bg-accent text-[#fff]" : "border-zinc-500 text-transparent"}`}
                    aria-label={allOn ? `Unselect ${g.label}` : `Select all from ${g.label}`}
                  >
                    <CheckIcon size={13} strokeWidth={3} />
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 sm:gap-1 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
              {g.items.map((f) => (
                <MemoTile key={f.path} file={f} selected={selected.has(f.path)} selecting={selecting} onOpen={onOpen} onToggle={toggle} onLongPress={longPress} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
