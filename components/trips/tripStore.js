"use client";

// Trips live on the phone first, so the planner works with no signal at all (mountains,
// flights, roaming). Each trip is kept in localStorage as:
//   { trip, dirty, base }  — dirty: has changes the PC hasn't got yet;
//                            base: the last copy both sides agreed on (for merging).
// Receipts taken offline wait in IndexedDB. syncTrips() sends everything when the
// PC can be reached again; if the PC's copy changed meanwhile, both sides' changes are merged.

const cacheKey = (id) => `ps.trip.${id}`;
export const LIST_KEY = "ps.trips"; // the PC's trip list, as last seen
const PREFIX = "ps.trip.";

export function readCache(id) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(id)) || "null");
  } catch {
    return null;
  }
}
export function writeCache(id, trip, dirty, base) {
  try {
    const prev = base === undefined ? readCache(id) : null;
    localStorage.setItem(cacheKey(id), JSON.stringify({ trip, dirty, base: base === undefined ? prev?.base ?? null : base }));
  } catch {}
}
export function dropTripCache(id) {
  try {
    localStorage.removeItem(cacheKey(id));
  } catch {}
}
function cachedIds() {
  const ids = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && !k.startsWith("ps.trip.tab")) ids.push(k.slice(PREFIX.length));
    }
  } catch {}
  return ids;
}

// ----- Merging: the PC changed the trip while the phone was offline -----
const SCALARS = ["name", "destination", "startDate", "endDate", "currency", "budget", "travellers", "mediaFolder", "cover", "notes"];
const LISTS = ["items", "expenses", "checklist", "files"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeList(base = [], mine = [], theirs = []) {
  const baseById = new Map(base.map((x) => [x.id, x]));
  const mineById = new Map(mine.map((x) => [x.id, x]));
  const out = theirs.filter((x) => !(baseById.has(x.id) && !mineById.has(x.id))); // deleted on the phone
  const index = new Map(out.map((x, i) => [x.id, i]));
  for (const x of mine) {
    const was = baseById.get(x.id);
    if (was && same(was, x)) continue; // not touched on the phone
    if (index.has(x.id)) out[index.get(x.id)] = x; // edited on the phone
    else out.push(x); // added on the phone (or edited there after the PC removed it)
  }
  return out;
}

/** Phone changes (mine vs base) applied on top of the PC's newer copy (theirs). */
export function mergeTrip(base, mine, theirs) {
  const out = { ...theirs };
  for (const k of SCALARS) if (!base || !same(base[k], mine[k])) out[k] = mine[k];
  for (const k of LISTS) out[k] = mergeList(base?.[k], mine[k], theirs[k]);
  return out;
}

// A request on a dying signal can hang for minutes and hold up every later save; give up after 15 s.
function fetchWithin(url, options, ms = 15000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  return fetch(url, { ...options, signal: abort.signal }).finally(() => clearTimeout(timer));
}

// ----- Sending one trip -----
/**
 * Sends a trip's phone copy to the PC. Returns { ok, trip } with the trip as it now stands
 * (merged if needed), or { ok: false, offline } when the PC can't be reached.
 */
export async function pushTrip(id, local, base) {
  let mine = local;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { rev = 0, ...doc } = mine;
    const res = await fetchWithin(`/api/plans?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trip: doc, rev }),
    }).catch(() => null);
    if (!res) return { ok: false, offline: true };
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.trip) {
      mine = { ...mergeTrip(base, mine, data.trip), rev: data.trip.rev };
      base = data.trip;
      continue;
    }
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, trip: { ...mine, rev: data.trip.rev }, merged: attempt > 0 };
  }
  return { ok: false };
}

// Trips open on screen sync themselves (useTrip); the background sync leaves them alone.
export const openTrips = new Set();

let running = null;
/** Send every trip and receipt still waiting on this phone. Safe to call often. */
export function syncTrips() {
  if (!running) running = doSync().finally(() => (running = null));
  return running;
}

async function doSync() {
  let sent = 0;
  for (const id of cachedIds()) {
    if (openTrips.has(id)) continue;
    const c = readCache(id);
    if (!c?.dirty || !c.trip) continue;
    const r = await pushTrip(id, c.trip, c.base);
    if (r.offline) return sent;
    if (r.ok) {
      const now = readCache(id);
      // Edited again while sending? Keep those edits waiting.
      if (now && !same(now.trip, c.trip)) writeCache(id, { ...now.trip, rev: r.trip.rev }, true, r.trip);
      else writeCache(id, r.trip, false, r.trip);
      sent++;
    }
  }
  await uploadQueuedFiles();
  // Fresh copies of every trip, so all of them open with no signal later.
  const res = await fetch("/api/plans", { cache: "no-store" }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  if (data?.trips) {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(data.trips));
    } catch {}
    await keepTripsOnPhone(data.trips);
  }
  return sent;
}

/** Keep a full copy of every trip on the phone (refresh ones the PC changed). */
export async function keepTripsOnPhone(summaries) {
  for (const s of summaries) {
    const c = readCache(s.id);
    if (c?.dirty || (c?.trip && c.trip.rev >= s.rev)) continue;
    const res = await fetch(`/api/plans?id=${s.id}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json().catch(() => null);
    const again = readCache(s.id);
    if (data?.trip && !again?.dirty) writeCache(s.id, data.trip, false, data.trip);
  }
}

// What a trip card shows (same shape as the PC's list in lib/plans.js).
export function summarize(id, t) {
  return {
    id,
    rev: t.rev ?? 0,
    name: t.name,
    destination: t.destination,
    startDate: t.startDate,
    endDate: t.endDate,
    currency: t.currency,
    budget: t.budget,
    planned: t.items.filter((i) => i.status !== "cancelled" && i.cost).reduce((s, i) => s + i.cost, 0),
    spent: t.expenses.reduce((s, e) => s + (e.amount || 0), 0),
    cover: t.cover,
    travellers: t.travellers.length,
    items: t.items.length,
    toBook: t.items.filter((i) => i.status === "tobook" && (i.type === "transport" || i.type === "stay")).length,
    checklist: [t.checklist.filter((c) => c.done).length, t.checklist.length],
    updatedAt: t.updatedAt ?? Date.now(),
    waiting: true,
  };
}

/** The PC's list, with this phone's unsent trips and edits laid on top. */
export function withLocalTrips(list) {
  const out = [...(list ?? [])];
  for (const id of cachedIds()) {
    const c = readCache(id);
    if (!c?.trip || !c.dirty) continue;
    const s = summarize(id, c.trip);
    const i = out.findIndex((t) => t.id === id);
    if (i >= 0) out[i] = s;
    else out.unshift(s);
  }
  return out;
}

// ----- Receipts taken offline (IndexedDB, so photos survive the app being closed) -----
const DB = "ps-trips";
const STORE = "pending-files";
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "fileId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export const queueFile = (entry) => tx("readwrite", (s) => s.put(entry));
export const pendingFiles = () => tx("readonly", (s) => s.getAll()).catch(() => []);

export async function uploadQueuedFiles() {
  for (const f of await pendingFiles()) {
    const res = await fetchWithin(`/api/plans/files?trip=${f.tripId}&name=${encodeURIComponent(f.name)}&id=${f.fileId}`, {
      method: "PUT",
      headers: { "Content-Type": f.type || "application/octet-stream" },
      body: f.blob,
    }, 120000).catch(() => null);
    if (!res) return; // still offline
    if (res.ok) await tx("readwrite", (s) => s.delete(f.fileId)).catch(() => {});
    // 404: the trip itself hasn't reached the PC yet — try again next time.
  }
}
