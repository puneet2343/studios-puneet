"use client";

import { createElement } from "react";
import { useToast } from "@/components/Toaster";
import { BedIcon, ClipIcon, CopyIcon, PlaneIcon, PlusIcon } from "@/components/icons";
import { STATUSES, fmtDay, fmtTime, iconFor, itemTitle, mapsUrl, money } from "@/components/trips/tripUtils";
import { Pill, fileUrl } from "@/components/trips/ui";

function when(item) {
  if (item.type === "stay") {
    const nights = item.day && item.endDay ? Math.round((new Date(item.endDay) - new Date(item.day)) / 86400000) : null;
    return [item.day && `${fmtDay(item.day)} → ${item.endDay ? fmtDay(item.endDay) : "?"}`, nights ? `${nights} night${nights === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  }
  return [item.day && fmtDay(item.day), item.time && fmtTime(item.time), item.endTime && `→ ${fmtTime(item.endTime)}`].filter(Boolean).join(" ");
}

function BookingCard({ trip, item, onOpen, onMarkBooked }) {
  const toast = useToast();
  const files = item.files.map((id) => trip.files.find((f) => f.id === id)).filter(Boolean);
  return (
    <li className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5">
      <button onClick={() => onOpen(item)} className="flex w-full items-start gap-3 text-left">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.type === "stay" ? "bg-violet-500/10 text-violet-300" : "bg-sky-500/10 text-sky-300"}`}>
          {createElement(iconFor(item), { size: 18 })}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug text-zinc-100">{itemTitle(item)}</span>
          <span className="mt-0.5 block text-xs text-zinc-500">{when(item) || "Date not set"}</span>
          {item.provider && <span className="block text-xs text-zinc-500">{item.provider}</span>}
        </span>
        <span className="shrink-0 text-right">
          {item.cost > 0 && <span className="block text-sm font-medium tabular-nums text-zinc-200">{money(item.cost, trip.currency)}</span>}
          <Pill className={`mt-1 ${STATUSES[item.status].tone}`}>{item.paid ? "Paid" : STATUSES[item.status].label}</Pill>
        </span>
      </button>

      {(item.ref || item.seat) && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2">
          <span className="min-w-0 flex-1 text-xs text-zinc-400">
            {/* Label above the number, so a long number never splits across lines on small phones. */}
            {item.ref && (
              <>
                <span className="block">{item.type === "stay" ? "Confirmation" : item.mode === "train" || item.mode === "flight" ? "PNR" : "Booking"}</span>
                <span className="block break-all font-mono text-sm tracking-wide text-zinc-100">{item.ref}</span>
              </>
            )}
            {item.seat && <span className={`block ${item.ref ? "mt-1" : ""}`}>Seat {item.seat}</span>}
          </span>
          {item.ref && (
            <button
              onClick={() => navigator.clipboard?.writeText(item.ref).then(() => toast("Copied"), () => toast("Couldn't copy"))}
              aria-label="Copy booking number"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 active:bg-white/10"
            >
              <CopyIcon size={16} />
            </button>
          )}
        </div>
      )}

      {(files.length > 0 || item.location || item.status === "tobook") && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <a key={f.id} href={fileUrl(trip.id, f.id)} target="_blank" rel="noreferrer" className="flex h-9 max-w-[12rem] items-center gap-1 rounded-lg border border-white/10 px-2.5 text-xs text-zinc-200 active:bg-white/5">
              <ClipIcon size={12} className="shrink-0" />
              <span className="truncate">{f.name}</span>
            </a>
          ))}
          {item.location && (
            <a href={mapsUrl(item.location)} target="_blank" rel="noreferrer" className="flex h-9 items-center rounded-lg border border-white/10 px-3 text-xs text-zinc-200 active:bg-white/5">
              Map
            </a>
          )}
          {item.status === "tobook" && (
            <button onClick={() => onMarkBooked(item)} className="ml-auto flex h-9 items-center rounded-lg bg-emerald-500/15 px-3.5 text-xs font-medium text-emerald-300 active:bg-emerald-500/25">
              Mark booked
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Every ticket and hotel in one place: what's still to book, confirmation numbers, tickets. */
export default function BookingsTab({ trip, onOpen, onAdd, onMarkBooked }) {
  const bookings = trip.items
    .filter((i) => i.type === "transport" || i.type === "stay")
    .sort((a, b) => `${a.day ?? "9999"}${a.time ?? ""}`.localeCompare(`${b.day ?? "9999"}${b.time ?? ""}`));
  const groups = [
    ["tobook", "To book"],
    ["booked", "Booked"],
    ["cancelled", "Cancelled"],
  ].map(([status, title]) => [title, bookings.filter((b) => b.status === status || (status === "tobook" && b.status === "idea"))]);

  return (
    <div className="pb-6">
      <div className="mb-5 grid grid-cols-2 gap-2">
        <button onClick={() => onAdd({ type: "transport", status: "tobook" })} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 text-sm font-medium text-zinc-200 active:bg-white/5">
          <PlaneIcon size={17} className="text-sky-300" />
          <PlusIcon size={14} /> Transport
        </button>
        <button onClick={() => onAdd({ type: "stay", status: "tobook" })} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 text-sm font-medium text-zinc-200 active:bg-white/5">
          <BedIcon size={17} className="text-violet-300" />
          <PlusIcon size={14} /> Stay
        </button>
      </div>
      {!bookings.length && <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-600">Add flights, trains, buses and hotels to keep tickets and booking numbers in one place.</p>}
      {groups.map(
        ([title, list]) =>
          list.length > 0 && (
            <section key={title} className="mb-5">
              <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                {title} <span className="text-zinc-600">{list.length}</span>
              </h3>
              <ul className="space-y-2">
                {list.map((item) => (
                  <BookingCard key={item.id} trip={trip} item={item} onOpen={onOpen} onMarkBooked={onMarkBooked} />
                ))}
              </ul>
            </section>
          )
      )}
    </div>
  );
}
