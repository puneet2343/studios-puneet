"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// One trip, kept on the phone too (so it opens with no signal while travelling) and
// saved to the PC a moment after each change. Edits made offline are kept and sent
// when the connection comes back. If another device saved first, its version wins
// and the screen shows it (nothing is silently overwritten on the PC).
const cacheKey = (id) => `ps.trip.${id}`;

function readCache(id) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(id)) || "null");
  } catch {
    return null;
  }
}
function writeCache(id, trip, dirty) {
  try {
    localStorage.setItem(cacheKey(id), JSON.stringify({ trip, dirty }));
  } catch {}
}
export function dropTripCache(id) {
  try {
    localStorage.removeItem(cacheKey(id));
  } catch {}
}

export default function useTrip(id, { onConflict } = {}) {
  const [trip, setTrip] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | saved | saving | offline | error | missing
  const tripRef = useRef(null);
  const dirty = useRef(false);
  const edits = useRef(0);
  const timer = useRef(null);
  const saving = useRef(false);
  const conflictRef = useRef(onConflict);
  const saveRef = useRef(null);

  useEffect(() => {
    conflictRef.current = onConflict;
  }, [onConflict]);

  const save = useCallback(async () => {
    if (!dirty.current || saving.current || !tripRef.current) return;
    saving.current = true;
    const sentEdits = edits.current;
    setStatus("saving");
    const { rev, ...doc } = tripRef.current;
    const res = await fetch(`/api/plans?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trip: doc, rev }),
    }).catch(() => null);
    saving.current = false;
    if (!res) {
      setStatus("offline");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.trip) {
      // Another device saved first: take its version.
      dirty.current = false;
      tripRef.current = data.trip;
      setTrip(data.trip);
      writeCache(id, data.trip, false);
      setStatus("saved");
      conflictRef.current?.();
      return;
    }
    if (!res.ok) {
      setStatus("error");
      return;
    }
    // Keep any edits made while this save was on its way, on top of the new revision.
    tripRef.current = { ...tripRef.current, rev: data.trip.rev };
    if (edits.current === sentEdits) dirty.current = false;
    writeCache(id, tripRef.current, dirty.current);
    setTrip(tripRef.current);
    setStatus(dirty.current ? "saving" : "saved");
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
        dirty.current = Boolean(cached.dirty);
        setTrip(cached.trip);
        setStatus(cached.dirty ? "offline" : "saved");
      }
      if (dirty.current) return save();
      const res = await fetch(`/api/plans?id=${id}`, { cache: "no-store" }).catch(() => null);
      if (!live) return;
      if (!res) return setStatus(cached ? "offline" : "error");
      if (res.status === 404) return setStatus("missing");
      const data = await res.json().catch(() => null);
      if (data?.trip && !dirty.current) {
        tripRef.current = data.trip;
        setTrip(data.trip);
        writeCache(id, data.trip, false);
        setStatus("saved");
      }
    }, 0);
    return () => {
      live = false;
      clearTimeout(first);
    };
  }, [id, save]);

  // Offline edits go out as soon as the phone is back online (and every 15 s meanwhile).
  useEffect(() => {
    const retry = () => dirty.current && save();
    window.addEventListener("online", retry);
    const t = setInterval(retry, 15000);
    return () => {
      window.removeEventListener("online", retry);
      clearInterval(t);
    };
  }, [save]);

  // Flush on leaving the screen.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (dirty.current) save();
    },
    [save]
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
      writeCache(id, next, true);
      setStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => save(), 700);
    },
    [id, save]
  );

  return { trip, update, status };
}
