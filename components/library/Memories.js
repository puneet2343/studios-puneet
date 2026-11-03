"use client";

import { useMemo, useState } from "react";
import { thumbUrl } from "@/components/media/urls";

// "On this day": photos taken on today's date (± 1 day) in earlier years, and a month ago.
// Worked out on the phone from the dates the library already has; nothing extra is stored.
const DAY = 24 * 60 * 60 * 1000;

function sameDayIn(now, years, months) {
  const d = new Date(now.getFullYear() - years, now.getMonth() - months, now.getDate());
  return [d.getTime() - DAY, d.getTime() + 2 * DAY]; // the day before, the day, the day after
}

// The cover: a favourite, else a real camera photo (not a tall screenshot), the biggest one.
function pickCover(items) {
  const photo = (f) => f.kind === "image" && !/screenshot/i.test(f.name) && (!f.width || !f.height || Math.max(f.width, f.height) / Math.min(f.width, f.height) <= 1.8);
  return items.find((f) => f.favorite && f.kind === "image") ?? [...items].filter(photo).sort((a, b) => b.size - a.size)[0] ?? items.find((f) => f.kind === "image") ?? items[0];
}

export function useMemories(media) {
  const [now] = useState(() => new Date()); // fixed while the page is open
  return useMemo(() => {
    const out = [];
    const take = (id, label, [from, to]) => {
      const items = media.filter((f) => f.taken >= from && f.taken < to && (f.kind === "image" || f.kind === "video"));
      if (items.length) out.push({ id, label, items, cover: pickCover(items) });
    };
    for (let y = 1; y <= 20; y++) take(`y${y}`, y === 1 ? "1 year ago" : `${y} years ago`, sameDayIn(now, y, 0));
    take("m1", "1 month ago", sameDayIn(now, 0, 1));
    return out;
  }, [media, now]);
}

export default function Memories({ memories, onOpen }) {
  if (!memories.length) return null;
  return (
    <div className="anim-fade mb-3">
      <p className="px-4 pb-2 text-[13px] font-semibold text-zinc-300 sm:px-0">On this day</p>
      <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-4 sm:px-0">
        {memories.map((m) => (
          <button key={m.id} onClick={() => onOpen(m)} className="relative h-40 w-28 shrink-0 overflow-hidden rounded-2xl bg-surface-2 active:scale-[0.97] transition-transform">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(m.cover)} alt="" loading="lazy" className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2.5 pb-2 pt-8 text-left">
              <span className="block text-[13px] font-semibold leading-tight text-[#fff]">{m.label}</span>
              <span className="block text-[11px] text-[#fff]/80">
                {m.items.length} {m.items.length === 1 ? "item" : "items"}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
