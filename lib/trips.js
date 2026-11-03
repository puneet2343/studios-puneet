import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MEDIA_DIR, cleanName, forgetLibrarySize, freeName, kindOf, relPath, renameFile, resolveDir, resolveName } from "@/lib/media";
import { dateFromFile, dateFromName } from "@/lib/library";

// Trips: just a name and dates. Each trip is an album (a folder at the top of the library)
// that collects the photos and videos taken between those dates:
//  - when a trip is created or its dates change, matching photos still loose in the library
//    or in "Phone Sync" are moved in (photos you already put in other albums stay put);
//  - photos the phone app syncs later go straight into the trip whose dates they fall in.
const FILE = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "trips.json");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class TripError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function read() {
  try {
    const data = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Array.isArray(data.trips) ? data.trips : [];
  } catch {
    return [];
  }
}

async function write(trips) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ trips }));
  await fs.rename(temp, FILE);
}

// The PC's local calendar day for a moment in time, e.g. "2026-10-17".
export const dayOf = (t) => new Date(t).toLocaleDateString("en-CA");

export const listTrips = () => read();

export async function tripFor(taken) {
  if (!Number.isFinite(taken)) return null;
  const day = dayOf(taken);
  const trips = await read();
  return trips.find((t) => t.start <= day && day <= t.end) ?? null;
}

function checkFields({ name, start, end }) {
  const clean = cleanName(String(name ?? "").trim());
  if (!clean) throw new TripError("Give the trip a name (no symbols like / : * ?)");
  if (!DAY.test(start ?? "") || !DAY.test(end ?? "")) throw new TripError("Pick the start and end dates");
  if (end < start) throw new TripError("The trip ends before it starts");
  return { name: clean, start, end };
}

// Loose photos at the top of the library and everything under "Phone Sync" are fair game;
// other albums are the user's own sorting and are left alone.
async function candidates() {
  const out = [];
  async function walk(dir, deep) {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || e.name.endsWith(".uploading")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (deep || (dir === MEDIA_DIR && e.name === "Phone Sync")) await walk(full, true);
      } else if (e.isFile() && ["image", "video"].includes(kindOf(e.name))) out.push(full);
    }
  }
  await walk(path.resolve(/*turbopackIgnore: true*/ MEDIA_DIR), false);
  return out;
}

async function takenOf(full) {
  return dateFromName(path.basename(full)) ?? (await dateFromFile(full, kindOf(full))) ?? (await fs.stat(full)).mtimeMs;
}

// Moves matching photos into the trip's album. Returns how many moved.
async function collect(trip) {
  const folder = resolveDir(trip.folder);
  let moved = 0;
  for (const full of await candidates()) {
    try {
      const day = dayOf(await takenOf(full));
      if (day < trip.start || day > trip.end) continue;
      await renameFile(full, path.join(folder, await freeName(path.basename(full), folder)));
      moved++;
    } catch {
      // Open in another program, or vanished: leave it.
    }
  }
  if (moved) forgetLibrarySize();
  return moved;
}

export async function createTrip(fields) {
  const { name, start, end } = checkFields(fields);
  const trips = await read();
  if (trips.some((t) => t.folder.toLowerCase() === name.toLowerCase())) throw new TripError("There's already a trip with that name", 409);
  const folder = resolveName(name);
  const existing = await fs.stat(folder).catch(() => null);
  if (existing && !existing.isDirectory()) throw new TripError("A file with that name is in the way", 409);
  // An album with this name already? It simply becomes the trip's album.
  await fs.mkdir(folder, { recursive: true });
  const trip = { id: crypto.randomBytes(5).toString("hex"), name, start, end, folder: relPath(folder), created: Date.now() };
  await write([...trips, trip]);
  return { trip, moved: await collect(trip) };
}

export async function updateTrip(id, fields) {
  const trips = await read();
  const trip = trips.find((t) => t.id === id);
  if (!trip) throw new TripError("Trip not found", 404);
  const { name, start, end } = checkFields({ name: trip.name, start: trip.start, end: trip.end, ...fields });
  if (name !== trip.name) {
    const from = resolveDir(trip.folder);
    const to = resolveName(name);
    if (to.toLowerCase() !== from.toLowerCase() && (await fs.stat(to).catch(() => null))) throw new TripError("Something with that name already exists", 409);
    await renameFile(from, to).catch(async (error) => {
      if (error.code === "ENOENT") await fs.mkdir(to, { recursive: true });
      else throw new TripError("Couldn't rename the album; a file in it may be open on the PC", 423);
    });
    trip.folder = relPath(to);
    trip.name = name;
  }
  Object.assign(trip, { start, end });
  await write(trips);
  return { trip, moved: await collect(trip) };
}

// Forgets the trip. Its album and photos stay exactly where they are.
export async function deleteTrip(id) {
  const trips = await read();
  if (!trips.some((t) => t.id === id)) throw new TripError("Trip not found", 404);
  await write(trips.filter((t) => t.id !== id));
}

// After an album is renamed or deleted in the app, keep trips pointing at the right place.
export async function albumRenamed(from, to) {
  const trips = await read();
  let changed = false;
  for (const t of trips) {
    if (t.folder === from) {
      t.folder = to;
      t.name = path.basename(to);
      changed = true;
    }
  }
  if (changed) await write(trips);
}

export async function albumDeleted(folder) {
  const trips = await read();
  const left = trips.filter((t) => t.folder !== folder);
  if (left.length !== trips.length) await write(left);
}
