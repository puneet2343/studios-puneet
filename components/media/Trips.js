"use client";

import { useState } from "react";
import { CloseIcon, FolderPlusIcon, SparkIcon } from "@/components/icons";
import { thumbUrl } from "@/components/media/urls";

const DISMISSED_KEY = "ps.trips.dismissed";

export function readDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
export function dismissTrip(id) {
  try {
    const all = [...readDismissed(), id].slice(-200);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(all));
  } catch {}
}

// "Suggested trip folders": groups of loose media taken over consecutive days.
// Nothing moves until the user taps Create.
export function TripSuggestions({ trips, onCreate, onDismiss }) {
  if (!trips.length) return null;
  return (
    <section className="anim-fade mb-6 px-3 sm:px-0">
      <h2 className="mb-2.5 flex items-center gap-1.5 px-0.5 text-sm font-medium text-zinc-200 sm:px-0">
        <SparkIcon size={15} className="text-violet-300" />
        Suggested trip folders
      </h2>
      <div className="no-scrollbar -mx-3 flex snap-x gap-2.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} onCreate={() => onCreate(trip)} onDismiss={() => onDismiss(trip)} />
        ))}
      </div>
    </section>
  );
}

function TripCard({ trip, onCreate, onDismiss }) {
  const [loaded, setLoaded] = useState({});
  const covers = trip.covers.slice(0, 4);
  return (
    <div className="relative w-[260px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03]">
      <div className={`grid h-28 gap-px bg-white/[0.06] ${covers.length > 1 ? "grid-cols-2" : ""} ${covers.length > 2 ? "grid-rows-2" : ""}`}>
        {covers.map((c, i) => (
          <div key={c.path} className={`relative overflow-hidden bg-zinc-900 ${covers.length === 3 && i === 0 ? "row-span-2" : ""}`}>
            {!loaded[c.path] && <div className="skeleton absolute inset-0" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl(c)}
              alt=""
              loading="lazy"
              onLoad={() => setLoaded((l) => ({ ...l, [c.path]: true }))}
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Not now"
        className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-[#fff] backdrop-blur-sm"
      >
        <CloseIcon size={15} />
      </button>
      <div className="p-3">
        <p className="truncate text-sm font-semibold text-zinc-100">{trip.name}</p>
        <p className="mt-0.5 text-xs tabular-nums text-zinc-500">{trip.count} photos & videos</p>
        <button
          onClick={onCreate}
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-zinc-950 transition-transform active:scale-[0.98]"
        >
          <FolderPlusIcon size={16} />
          Create folder
        </button>
      </div>
    </div>
  );
}
