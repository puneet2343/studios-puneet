import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import exifReader from "exif-reader";
import { FFPROBE, run } from "@/lib/ffmpeg";
import { MEDIA_DIR, THUMB_DIR, diskSpace, fileKey, kindOf, librarySize, relPath } from "@/lib/media";
import { dateFromFile, dateFromName, readFavorites } from "@/lib/library";

// The whole library in one list, for the Photos timeline, Albums and the Map:
// every file with when it was taken and (if the camera saved it) where.
// Both are read from the files once and cached by content key in .meta/, so the list
// is quick after the first time. Anything not known yet is worked out in the background
// (`pending` tells the app to ask again shortly).
const META_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta");
const TAKEN = path.join(META_DIR, "taken.json");
const PLACES = path.join(META_DIR, "places.json");

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

// ----- Where was it taken? -----
const dms = (v, ref) => {
  if (!Array.isArray(v) || v.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  const deg = v[0] + v[1] / 60 + v[2] / 3600;
  return ref === "S" || ref === "W" ? -deg : deg;
};
const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

async function placeFromFile(full, kind) {
  try {
    if (kind === "image") {
      const { exif } = await sharp(full, { failOn: "none" }).metadata();
      if (!exif) return null;
      const g = exifReader(exif).GPSInfo;
      const lat = dms(g?.GPSLatitude, g?.GPSLatitudeRef);
      const lng = dms(g?.GPSLongitude, g?.GPSLongitudeRef);
      return valid(lat, lng) ? [Number(lat.toFixed(6)), Number(lng.toFixed(6))] : null;
    }
    if (kind === "video") {
      // Phones store it as ISO 6709 text, e.g. "+26.9124+075.7873/".
      const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format_tags", "-of", "json", full]);
      const tags = JSON.parse(stdout).format?.tags ?? {};
      const text = tags.location || tags["com.apple.quicktime.location.ISO6709"] || tags["location-eng"] || "";
      const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(text);
      const lat = m && Number(m[1]);
      const lng = m && Number(m[2]);
      return m && valid(lat, lng) ? [lat, lng] : null;
    }
  } catch {}
  return null;
}

// ----- Background work: fill in dates and places not known yet -----
let working = null;

function fillIn(items, taken, places) {
  if (working) return working;
  working = (async () => {
    let since = Date.now();
    for (const item of items) {
      if (taken[item.key] === undefined) taken[item.key] = dateFromName(item.name) ?? (await dateFromFile(item.full, item.kind)) ?? null;
      if (places[item.key] === undefined) places[item.key] = await placeFromFile(item.full, item.kind);
      // Save every few seconds, so a long first run shows progress.
      if (Date.now() - since > 3000) {
        await Promise.all([writeJson(TAKEN, taken), writeJson(PLACES, places)]);
        since = Date.now();
      }
    }
    await Promise.all([writeJson(TAKEN, taken), writeJson(PLACES, places)]);
  })().finally(() => {
    working = null;
  });
  return working;
}

async function walk(dir, files, folders) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith(".") || e.name.endsWith(".uploading")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      folders.push(full);
      await walk(full, files, folders);
    } else if (e.isFile()) {
      const stat = await fs.stat(full).catch(() => null);
      if (stat) files.push({ full, stat });
    }
  }
}

async function thumbMeta(key) {
  try {
    return JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ THUMB_DIR, `${key}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function catalog() {
  const found = [];
  const folderPaths = [];
  await walk(MEDIA_DIR, found, folderPaths);
  const [favorites, taken, places, disk, media] = await Promise.all([readFavorites(), readJson(TAKEN), readJson(PLACES), diskSpace(), librarySize()]);

  const items = found.map(({ full, stat }) => ({ full, stat, name: path.basename(full), kind: kindOf(full), key: fileKey(stat) }));
  const missing = items.filter((i) => (i.kind === "image" || i.kind === "video") && (taken[i.key] === undefined || places[i.key] === undefined));
  if (missing.length) fillIn(missing, taken, places).catch(() => {});

  const files = await Promise.all(
    items.map(async ({ full, stat, name, kind, key }) => {
      const meta = kind === "image" || kind === "video" ? await thumbMeta(key) : null;
      const place = places[key];
      return {
        name,
        path: relPath(full),
        size: stat.size,
        modified: stat.mtimeMs,
        taken: taken[key] ?? dateFromName(name) ?? stat.mtimeMs,
        kind,
        key,
        ...(favorites[key] && { favorite: true }),
        ...(place && { lat: place[0], lng: place[1] }),
        ...(meta && { duration: meta.duration, width: meta.width, height: meta.height }),
      };
    })
  );
  files.sort((a, b) => b.taken - a.taken);

  const folders = folderPaths.map((full) => ({ path: relPath(full), name: path.basename(full) }));
  return { files, folders, pending: missing.length, disk: { ...disk, media } };
}

// Is this file (same name and size) somewhere in the library? Used before the phone app
// deletes its own copy to free space, so nothing is removed that isn't safely on the PC.
export async function presentOnPc(list) {
  const found = [];
  await walk(MEDIA_DIR, found, []);
  const index = new Set(found.map(({ full, stat }) => `${path.basename(full).toLowerCase()}|${stat.size}`));
  return list.map((i) => index.has(`${String(i.name ?? "").toLowerCase()}|${Number(i.size)}`));
}
