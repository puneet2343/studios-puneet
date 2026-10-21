"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openTrips, pushTrip, readCache, syncTrips, writeCache } from "@/components/trips/tripStore";

export { dropTripCache } from "@/components/trips/tripStore";

// One trip, kept on the phone (so it works with no signal while travelling) and saved to
// the PC a moment after each change. Edits made offline wait on the phone and go out when
// the connection is back. If the PC's copy changed meanwhile, both sets of changes are merged.
export default function useTrip(id, { onConflict } = {}) {
  const [trip, setTrip] = useState(null);
  // loading | saved | saving | offline | error | missing | unavailable (not on this phone, no signal)
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0); // retry opening a trip that wasn't on the phone
  const tripRef = useRef(null);
  const baseRef = useRef(null);
  const dirty = useRef(false);
  const edits = useRef(0);
  const timer = useRef(null);
  const saving = useRef(false);
  const conflictRef = useRef(onConflict);
  const saveRef = useRef(null);

  useEffect(() => {
    conflictRef.current = onConflict;
  }, [onConflict]);

  useEffect(() => {
    openTrips.add(id);
    return () => openTrips.delete(id);
  }, [id]);

  const save = useCallback(async () => {
    if (!dirty.current || saving.current || !tripRef.current) return;
    saving.current = true;
    const sentEdits = edits.current;
    const sent = tripRef.current;
    setStatus("saving");
    const r = await pushTrip(id, sent, baseRef.current);
    saving.current = false;
    if (r.offline) return setStatus("offline");
    if (!r.ok) return setStatus("error");
    baseRef.current = r.trip;
    if (edits.current === sentEdits) {
      // Nothing new meanwhile: the PC now has exactly this (merged) trip.
      dirty.current = false;
      tripRef.current = r.trip;
    } else {
      // Keep the edits made while this save was on its way, on top of the new revision.
      tripRef.current = { ...tripRef.current, rev: r.trip.rev };
    }
    writeCache(id, tripRef.current, dirty.current, baseRef.current);
    setTrip(tripRef.current);
    setStatus(dirty.current ? "saving" : "saved");
    if (r.merged) conflictRef.current?.();
    if (dirty.current) timer.current = setTimeout(() => saveRef.current?.(), 300);
  }, [id]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Open: show the phone's copy at once, then the PC's (or send unsaved edits first).
  useEffect(() => {
    let live = true;
    const cached = readCache(id);
    const first = setTimeout(async () => {
      if (cached?.trip) {
        tripRef.current = cached.trip;
        baseRef.current = cached.base ?? null;
        dirty.current = Boolean(cached.dirty);
        setTrip(cached.trip);
        setStatus(cached.dirty ? "offline" : "saved");
      }
      if (dirty.current) return save();
      const res = await fetch(`/api/plans?id=${id}`, { cache: "no-store" }).catch(() => null);
      if (!live) return;
      if (!res) return setStatus(cached?.trip ? "saved" : "unavailable");
      if (res.status === 404) return setStatus("missing");
      const data = await res.json().catch(() => null);
      if (data?.trip && !dirty.current) {
        tripRef.current = data.trip;
        baseRef.current = data.trip;
        setTrip(data.trip);
        writeCache(id, data.trip, false, data.trip);
        setStatus("saved");
      }
    }, 0);
    return () => {
      live = false;
      clearTimeout(first);
    };
  }, [id, save, attempt]);

  // Offline edits go out as soon as the phone is back online (and every 15 s meanwhile).
  useEffect(() => {
    const retry = () => {
      if (dirty.current) save();
      if (!tripRef.current) setAttempt((a) => a + 1);
    };
    window.addEventListener("online", retry);
    const t = setInterval(retry, 15000);
    return () => {
      window.removeEventListener("online", retry);
      clearInterval(t);
    };
  }, [save]);

  // Leaving the screen: send what's left (and anything else waiting on the phone).
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      openTrips.delete(id);
      if (dirty.current) save().then(() => syncTrips());
    },
    [id, save]
  );

  // Change the trip: `fn` gets the current trip and returns the new one.
  const update = useCallback(
    (fn) => {
      if (!tripRef.current) return;
      const next = { ...fn(tripRef.current), rev: tripRef.current.rev };
      tripRef.current = next;
      dirty.current = true;
      edits.current++;
      setTrip(next);
      writeCache(id, next, true, baseRef.current);
      setStatus((s) => (s === "offline" ? "offline" : "saving"));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => save(), 700);
    },
    [id, save]
  );

  return { trip, update, status };
}
