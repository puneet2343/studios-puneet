import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { probe } from "@/lib/ffmpeg";
import {
  MEDIA_DIR,
  THUMB_DIR,
  fileKey,
  freeName,
  kindOf,
  relPath,
  renameFile,
} from "@/lib/media";

const META_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta");
const FAVORITES = path.join(/*turbopackIgnore: true*/ META_DIR, "favorites.json");
const TAKEN = path.join(/*turbopackIgnore: true*/ META_DIR, "taken.json");
const MAX_RESULTS = 500;

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function writeJson(file, data) {
  await fs.mkdir(META_DIR, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data));
  await fs.rename(temp, file);
}

// ----- Favourites -----
// Keyed by content key (size + mtime), which survives renames and moves, so the star
// follows the file wherever it goes.
export const readFavorites = () => readJson(FAVORITES);

export async function setFavorites(keys, on) {
  const favorites = await readFavorites();
  for (const key of keys) {
    if (typeof key !== "string" || !/^[0-9a-f]{20}$/.test(key)) continue;
    if (on) favorites[key] = Date.now();
    else delete favorites[key];
  }
  await writeJson(FAVORITES, favorites);
  return favorites;
}

// ----- Every file in the library -----
async function walk(dir, out, folders) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name.endsWith(".uploading")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      folders.push({ name: e.name, path: relPath(full) });
      await walk(full, out, folders);
    } else if (e.isFile()) {
      const stat = await fs.stat(full).catch(() => null);
      if (stat) out.push({ full, stat });
    }
  }
}

async function describe(full, stat, favorites) {
  const key = fileKey(stat);
  let meta = null;
  try {
    meta = JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ THUMB_DIR, `${key}.json`), "utf8"));
  } catch {}
  const name = path.basename(full);
  return {
    name,
    path: relPath(full),
    size: stat.size,
    modified: stat.mtimeMs,
    kind: kindOf(name),
    key,
    ...(favorites[key] && { favorite: true }),
    ...(meta && { duration: meta.duration, width: meta.width, height: meta.height }),
  };
}

// Library-wide search by name (files and folders), and/or every favourite.
export async function searchLibrary({ query = "", favoritesOnly = false } = {}) {
  const found = [];
  const allFolders = [];
  await walk(MEDIA_DIR, found, allFolders);
  const favorites = await readFavorites();
  const q = query.trim().toLowerCase();
  const matches = found.filter(({ full, stat }) => {
    if (favoritesOnly && !favorites[fileKey(stat)]) return false;
    return !q || relPath(full).toLowerCase().includes(q);
  });
  const files = await Promise.all(matches.slice(0, MAX_RESULTS).map(({ full, stat }) => describe(full, stat, favorites)));
  const folders = q && !favoritesOnly ? allFolders.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 50) : [];
  return {
    files: files.sort((a, b) => b.modified - a.modified),
    folders,
    truncated: matches.length > MAX_RESULTS,
  };
}

// ----- When was it taken? -----
// Upload time is useless for trips (everything uploads on the day you get home), so
// read the capture date: from the file name first (Samsung, Pixel, WhatsApp… all put
// it there), then the camera's own data. Answers are cached by content key.
const NAME_DATE = /(?:^|[^0-9])(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[-_ T.]?([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d))?/;

function dateFromName(name) {
  const m = NAME_DATE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h = "12", mi = "00", s = "00"] = m;
  const t = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
  return t > Date.UTC(2005, 0, 1) && t < Date.now() + 864e5 ? t : null;
}

async function dateFromFile(full, kind) {
  try {
    if (kind === "video") {
      const info = await probe(full);
      const tag = info.creationTime;
      const t = tag ? Date.parse(tag) : NaN;
      return Number.isFinite(t) && t > Date.UTC(2005, 0, 1) ? t : null;
    }
    if (kind === "image") {
      const { exif } = await sharp(full, { failOn: "none" }).metadata();
      // EXIF dates are plain text "YYYY:MM:DD HH:MM:SS"; the last one is usually DateTimeOriginal.
      const all = exif?.toString("latin1").match(/(20\d{2}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/g);
      if (all?.length) {
        const [d, t] = all.at(-1).split(" ");
        return new Date(`${d.replaceAll(":", "-")}T${t}`).getTime();
      }
    }
  } catch {}
  return null;
}

async function takenTimes(items) {
  const cache = await readJson(TAKEN);
  let changed = false;
  const out = [];
  for (const item of items) {
    let t = cache[item.key];
    if (t === undefined) {
      t = dateFromName(item.name) ?? (await dateFromFile(item.full, item.kind));
      cache[item.key] = t ?? null;
      changed = true;
    }
    out.push({ ...item, taken: t ?? item.modified });
  }
  if (changed) await writeJson(TAKEN, cache);
  return out;
}

// ----- Trip suggestions -----
// Looks at media still loose at the top level, sorts it by capture time and finds runs
// with no gap longer than a day and a half. A run spanning 2+ days with 6+ items (or one
// big day with 15+) becomes a suggestion like "Trip · 12–15 Oct".
const GAP_MS = 36 * 3600 * 1000;
const dayKey = (t) => new Date(t).toDateString();

function tripName(first, last) {
  const a = new Date(first);
  const b = new Date(last);
  const month = (d) => d.toLocaleDateString("en-IN", { month: "short" });
  if (dayKey(first) === dayKey(last)) return `Day out · ${a.getDate()} ${month(a)}`;
  if (a.getMonth() === b.getMonth()) return `Trip · ${a.getDate()}–${b.getDate()} ${month(b)}`;
  return `Trip · ${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`;
}

export async function tripSuggestions() {
  const entries = await fs.readdir(MEDIA_DIR, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith(".") || e.name.endsWith(".uploading")) continue;
    const kind = kindOf(e.name);
    if (kind !== "image" && kind !== "video") continue;
    const full = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, e.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat) items.push({ full, name: e.name, kind, key: fileKey(stat), modified: stat.mtimeMs });
  }
  const dated = (await takenTimes(items)).sort((a, b) => a.taken - b.taken);

  const runs = [];
  for (const item of dated) {
    const run = runs.at(-1);
    if (run && item.taken - run.at(-1).taken <= GAP_MS) run.push(item);
    else runs.push([item]);
  }

  return runs
    .filter((run) => {
      const days = new Set(run.map((i) => dayKey(i.taken))).size;
      return (days >= 2 && run.length >= 6) || run.length >= 15;
    })
    .map((run) => {
      const first = run[0].taken;
      const last = run.at(-1).taken;
      return {
        id: `${run[0].key}-${run.length}`,
        name: tripName(first, last),
        from: first,
        to: last,
        count: run.length,
        paths: run.map((i) => relPath(i.full)),
        // A few pictures for the suggestion card.
        covers: run
          .filter((_, i) => i % Math.max(1, Math.floor(run.length / 4)) === 0)
          .slice(0, 4)
          .map((i) => ({ path: relPath(i.full), key: i.key })),
      };
    })
    .reverse(); // newest trip first
}

// Creates the folder and moves the files in. Files that changed or moved since the
// suggestion was made are skipped rather than guessed at.
export async function createTripFolder(name, paths, resolveName) {
  const folder = resolveName(name);
  if (!folder || path.dirname(folder) !== path.resolve(/*turbopackIgnore: true*/ MEDIA_DIR)) return { error: "Invalid folder name" };
  await fs.mkdir(folder, { recursive: true });
  let moved = 0;
  const failed = [];
  for (const p of paths) {
    const full = resolveName(p);
    if (!full || path.dirname(full) !== path.resolve(/*turbopackIgnore: true*/ MEDIA_DIR)) continue;
    try {
      await renameFile(full, path.join(folder, await freeName(path.basename(full), folder)));
      moved++;
    } catch (error) {
      failed.push({ path: p, code: error.code });
    }
  }
  return { path: relPath(folder), moved, failed };
}
