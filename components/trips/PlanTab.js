"use client";

import { createElement } from "react";
import { CheckIcon, ClipIcon, PlusIcon } from "@/components/icons";
import { ITEM_TYPES, STATUSES, fmtDay, fmtTime, iconFor, itemTitle, itemsForDay, money, today, tripDays } from "@/components/trips/tripUtils";
import { Pill } from "@/components/trips/ui";

function subtitle(item, role) {
  if (item.type === "transport") return [item.provider, item.time && item.endTime ? `${fmtTime(item.time)} → ${fmtTime(item.endTime)}` : null, item.seat ? `Seat ${item.seat}` : null].filter(Boolean).join(" · ");
  if (item.type === "stay") {
    if (role === "checkin") return `Check-in${item.time ? ` from ${fmtTime(item.time)}` : ""}`;
    if (role === "checkout") return `Check-out${item.endTime ? ` by ${fmtTime(item.endTime)}` : ""}`;
    if (role === "staying") return "Staying here";
    return item.location;
  }
  return item.location || item.notes?.split("\n")[0] || "";
}

export function ItemRow({ trip, item, role, onOpen, onToggleDone, compact = false }) {
  const type = ITEM_TYPES[item.type];
  const time = role === "checkout" ? item.endTime : role === "staying" ? null : item.time;
  const status = STATUSES[item.status];
  const showStatus = (item.type === "transport" || item.type === "stay") && role !== "staying" && role !== "checkout" ? item.status !== "booked" || compact : item.status === "cancelled";
  return (
    <li className={`flex items-stretch gap-3 ${role === "staying" ? "opacity-60" : ""}`}>
      <div className="hidden w-14 shrink-0 pt-3 text-right text-xs tabular-nums text-zinc-500 min-[400px]:block">{time ? fmtTime(time) : ""}</div>
      <div className="relative flex flex-col items-center">
        <span className={`z-10 mt-1.5 flex h-9 w-9 items-center justify-center rounded-xl ${type.tint}`}>
          {createElement(iconFor(item), { size: 17 })}
        </span>
        <span className="absolute bottom-0 top-0 w-px bg-white/[0.07]" />
      </div>
      <button onClick={() => onOpen(item)} className="mb-2 min-w-0 flex-1 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-left transition-colors active:bg-white/[0.05]">
        <div className="flex items-start gap-2">
          <p className={`min-w-0 flex-1 text-[15px] font-medium leading-snug text-zinc-100 ${item.done ? "text-zinc-500 line-through" : ""}`}>{itemTitle(item)}</p>
          {item.cost > 0 && role !== "staying" && role !== "checkout" && <span className="shrink-0 text-xs tabular-nums text-zinc-400">{money(item.cost, trip.currency)}</span>}
        </div>
        {(subtitle(item, role) || time) && (
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {time && (
              <span className="font-medium tabular-nums text-zinc-400 min-[400px]:hidden">
                {fmtTime(time)}
                {subtitle(item, role) ? " · " : ""}
              </span>
            )}
            {subtitle(item, role)}
          </p>
        )}
        {(showStatus || item.files.length > 0 || item.paid) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {showStatus && <Pill className={status.tone}>{status.label}</Pill>}
            {item.paid && <Pill className="border-emerald-400/30 text-emerald-300">Paid</Pill>}
            {item.files.length > 0 && (
              <Pill className="border-white/10 text-zinc-400">
                <ClipIcon size={11} />
                {item.files.length}
              </Pill>
            )}
          </div>
        )}
      </button>
      {onToggleDone && (item.type === "activity" || item.type === "food") && (
        <button
          onClick={() => onToggleDone(item)}
          aria-label={item.done ? "Mark as not done" : "Mark as done"}
          className={`mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${item.done ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-300" : "border-white/10 text-transparent"}`}
        >
          <CheckIcon size={15} strokeWidth={2.6} />
        </button>
      )}
    </li>
  );
}

/** Day-by-day plan, plus an Ideas list for things without a day yet. */
export default function PlanTab({ trip, onOpen, onAdd, onToggleDone }) {
  const days = tripDays(trip);
  const ideas = trip.items.filter((i) => !i.day || (days.length && !days.includes(i.day) && !(i.type === "stay" && i.endDay && i.endDay >= days[0])));
  const now = today();

  return (
    <div className="pb-6">
      {!days.length && (
        <p className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-200">Set the trip dates (⋯ → Trip details) to plan day by day.</p>
      )}
      {days.map((day, i) => {
        const entries = itemsForDay(trip, day);
        const isToday = day === now;
        return (
          <section key={day} id={`day-${day}`} className="mb-5 scroll-mt-28">
            <div className="mb-2 flex items-center gap-2">
              <h3 className={`text-sm font-semibold ${isToday ? "text-violet-300" : "text-zinc-100"}`}>
                Day {i + 1}
                <span className="ml-1.5 font-normal text-zinc-500">{fmtDay(day)}</span>
              </h3>
              {isToday && <Pill className="border-violet-400/40 bg-violet-500/15 text-violet-300">Today</Pill>}
              <button onClick={() => onAdd({ day })} className="ml-auto flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-violet-300 active:bg-white/5" aria-label={`Add to day ${i + 1}`}>
                <PlusIcon size={14} />
                Add
              </button>
            </div>
            {entries.length ? (
              <ul>
                {entries.map(({ item, role }) => (
                  <ItemRow key={`${item.id}-${role}`} trip={trip} item={item} role={role} onOpen={onOpen} onToggleDone={onToggleDone} />
                ))}
              </ul>
            ) : (
              <button onClick={() => onAdd({ day })} className="w-full rounded-2xl border border-dashed border-white/10 py-4 text-sm text-zinc-600 active:bg-white/[0.03]">
                Nothing planned yet · tap to add
              </button>
            )}
          </section>
        );
      })}

      <section className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">
            Ideas
            <span className="ml-1.5 font-normal text-zinc-500">not on a day yet</span>
          </h3>
          <button onClick={() => onAdd({ day: null, status: "idea" })} className="ml-auto flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-violet-300 active:bg-white/5">
            <PlusIcon size={14} />
            Add idea
          </button>
        </div>
        {ideas.length ? (
          <ul>
            {ideas.map((item) => (
              <ItemRow key={item.id} trip={trip} item={item} onOpen={onOpen} onToggleDone={onToggleDone} />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-white/10 py-4 text-center text-sm text-zinc-600">Places to see, cafés to try, shots to get…</p>
        )}
      </section>
    </div>
  );
}
