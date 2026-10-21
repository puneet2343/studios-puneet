"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AppShell";
import { useToast } from "@/components/Toaster";
import { PlaneIcon, PlusIcon, TicketIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { thumbUrl } from "@/components/media/urls";
import TripDetail from "@/components/trips/TripDetail";
import TripForm from "@/components/trips/TripForm";
import { fmtRange, money, today, tripStatus } from "@/components/trips/tripUtils";
import { haptic } from "@/lib/haptics";

const LIST_KEY = "ps.trips";
const TONES = {
  upcoming: "bg-sky-500/80 text-[#fff] border-white/25",
  live: "bg-emerald-500/85 text-[#fff] border-white/25",
  done: "bg-black/45 text-[#fff] border-white/20",
  muted: "bg-black/45 text-[#fff] border-white/20",
};

function readList() {
  try {
    return JSON.parse(localStorage.getItem(LIST_KEY) || "null");
  } catch {
    return null;
  }
}

function TripCard({ trip, onOpen }) {
  const st = tripStatus(trip);
  const [loaded, setLoaded] = useState(false);
  const pct = trip.budget ? Math.min(1, trip.spent / trip.budget) : null;
  return (
    <li>
      <button onClick={() => onOpen(trip.id)} className="group w-full overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.02] text-left transition-transform active:scale-[0.99]">
        <div className="relative h-32 overflow-hidden">
          {trip.cover ? (
            <>
              {!loaded && <div className="skeleton absolute inset-0" />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(trip.cover)} alt="" onLoad={() => setLoaded(true)} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
            </>
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-600 via-indigo-500 to-sky-500 text-[#fff]/35">
              <PlaneIcon size={40} strokeWidth={1.2} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          <span className={`absolute left-3 top-3 rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur ${TONES[st.tone]}`}>{st.label}</span>
          <div className="absolute inset-x-0 bottom-0 px-3.5 pb-2.5 text-[#fff]">
            <p className="truncate text-lg font-semibold leading-tight">{trip.name}</p>
            <p className="truncate text-xs text-[#fff]/75">{[trip.destination, fmtRange(trip.startDate, trip.endDate)].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="space-y-2 px-3.5 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">
              <span className="font-medium tabular-nums text-zinc-100">{money(trip.spent, trip.currency, { compact: true })}</span> spent
              {trip.budget ? ` of ${money(trip.budget, trip.currency, { compact: true })}` : ""}
            </span>
            {trip.toBook > 0 && (
              <span className="flex items-center gap-1 font-medium text-amber-200">
                <TicketIcon size={13} />
                {trip.toBook} to book
              </span>
            )}
          </div>
          {pct !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className={`h-full rounded-full ${trip.spent > trip.budget ? "bg-red-400" : pct > 0.8 ? "bg-amber-400" : "bg-gradient-to-r from-violet-400 to-sky-400"}`} style={{ width: `${pct * 100}%` }} />
            </div>
          )}
          <p className="text-xs text-zinc-500">
            {[trip.items ? `${trip.items} in the plan` : "Nothing planned yet", trip.checklist[1] ? `${trip.checklist[0]}/${trip.checklist[1]} checklist` : null, trip.travellers > 1 ? `${trip.travellers} people` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </button>
    </li>
  );
}

/** Trip Planner page: your trips, and one trip at a time in full. */
export default function TripPlanner() {
  const { loggedOut } = useAuth();
  const toast = useToast();
  const [trips, setTrips] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [offline, setOffline] = useState(false);
  useBackClose(Boolean(openId), () => setOpenId(null));
  const [listStale, setListStale] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/plans", { cache: "no-store" }).catch(() => null);
    if (res?.status === 401) return loggedOut();
    const data = res?.ok ? await res.json() : null;
    if (!data) return setOffline(true);
    setOffline(false);
    setTrips(data.trips);
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(data.trips));
    } catch {}
  }, [loggedOut]);

  // A trip was just closed (arrow or phone Back): its card needs the latest numbers.
  useEffect(() => {
    if (openId || !listStale) return;
    const t = setTimeout(() => {
      setListStale(false);
      load();
    }, 300);
    return () => clearTimeout(t);
  }, [openId, listStale, load]);

  useEffect(() => {
    const first = setTimeout(() => {
      const cached = readList();
      if (cached) setTrips(cached);
      load();
    }, 0);
    return () => clearTimeout(first);
  }, [load]);

  async function create(fields) {
    const res = await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trip: fields }) }).catch(() => null);
    const data = res?.ok ? await res.json() : null;
    if (!data) return "Couldn't create the trip. Check the connection.";
    setCreating(false);
    haptic("success");
    await load();
    setOpenId(data.trip.id);
    setListStale(true);
  }

  const openTrip = (tripId) => {
    setOpenId(tripId);
    setListStale(true);
  };

  const t = today();
  const upcoming = (trips ?? []).filter((x) => !x.startDate || (x.endDate || x.startDate) >= t).sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
  const past = (trips ?? []).filter((x) => x.startDate && (x.endDate || x.startDate) < t);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-4 sm:px-6 lg:pt-8">
      <header className="mb-5 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Trips</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Plans, bookings, expenses and checklists for every trip.</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-semibold text-zinc-950 transition-transform active:scale-[0.97]">
          <PlusIcon size={17} strokeWidth={2.4} />
          New trip
        </button>
      </header>

      {offline && <p className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-2.5 text-sm text-amber-200">Can&apos;t reach the studio PC — showing trips saved on this phone.</p>}

      {trips === null ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-52 rounded-3xl" />
          ))}
        </div>
      ) : !trips.length ? (
        <div className="anim-rise flex flex-col items-center px-6 py-16 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500/20 to-sky-500/20 text-violet-300">
            <PlaneIcon size={36} strokeWidth={1.5} />
          </div>
          <p className="text-lg font-medium text-zinc-100">Plan your first trip</p>
          <p className="mt-1.5 max-w-sm text-sm text-zinc-500">Day-by-day plan, flights, trains and hotels, every expense and who owes whom, and your packing list — all in one place.</p>
          <button onClick={() => setCreating(true)} className="mt-6 flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-zinc-950">
            <PlusIcon size={17} strokeWidth={2.4} />
            New trip
          </button>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2.5 text-sm font-medium text-zinc-200">Upcoming & ongoing</h2>
              <ul className="space-y-3">
                {upcoming.map((x) => (
                  <TripCard key={x.id} trip={x} onOpen={openTrip} />
                ))}
              </ul>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-sm font-medium text-zinc-200">Past trips</h2>
              <ul className="space-y-3">
                {past.map((x) => (
                  <TripCard key={x.id} trip={x} onOpen={openTrip} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {creating && <TripForm onClose={() => setCreating(false)} onSave={create} />}
      {openId && (
        <TripDetail
          key={openId}
          id={openId}
          onBack={() => setOpenId(null)}
          onDeleted={(name, undo) => {
            setOpenId(null);
            load();
            toast(`Deleted "${name}"`, {
              duration: 7000,
              action: {
                label: "Undo",
                onClick: async () => {
                  await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restore: undo }) }).catch(() => null);
                  load();
                  toast("Trip restored");
                },
              },
            });
          }}
        />
      )}
    </div>
  );
}
