import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const MEDIA_DIR =
  process.env.MEDIA_DIR || path.join(os.homedir(), "Desktop", "Phone Media");

// Hidden folders inside MEDIA_DIR; dot-names are never listed or reachable by name.
export const THUMB_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".thumbs");
export const TRASH_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".trash");

const TEMP_SUFFIX = ".uploading";
export const TRASH_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

const MIME_TYPES = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".3gp": "video/3gpp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
  ".ac3": "audio/ac3",
  ".eac3": "audio/eac3",
  ".pdf": "application/pdf",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

export function mimeType(name) {
  return MIME_TYPES[path.extname(name).toLowerCase()] || "application/octet-stream";
}

export function kindOf(name) {
  return mimeType(name).split("/")[0];
}

// Identifies a file's content version. Survives renames (fs.rename keeps size and mtime),
// so thumbnails don't need regenerating when a file is renamed.
export function fileKey(stat) {
  return crypto
    .createHash("sha1")
    .update(`${stat.size}-${Math.floor(stat.mtimeMs)}`)
    .digest("hex")
    .slice(0, 20);
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

// Accepts a bare file name only; anything that could escape MEDIA_DIR is rejected.
export function cleanName(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (/[<>:"/\\|?*\x00-\x1f]/.test(trimmed)) return null;
  if (trimmed.startsWith(".") || /[. ]$/.test(trimmed)) return null;
  if (RESERVED.test(trimmed)) return null;
  return trimmed;
}

const MAX_DEPTH = 12;

// A path inside the library, like "Goa Trip/Beach/clip.mp4" ("" is the library itself).
// Every part must pass cleanName, so nothing can escape MEDIA_DIR or reach hidden folders.
export function cleanPath(rel) {
  if (rel === "" || rel === undefined || rel === null) return "";
  if (typeof rel !== "string") return null;
  const parts = rel.split("/").map(cleanName);
  if (parts.length > MAX_DEPTH || parts.some((p) => !p)) return null;
  return parts.join("/");
}

function fullPath(clean) {
  const root = path.resolve(/*turbopackIgnore: true*/ MEDIA_DIR);
  const full = path.join(/*turbopackIgnore: true*/ root, ...clean.split("/").filter(Boolean));
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

// A file or folder inside the library (never the library root itself).
export function resolveName(rel) {
  const clean = cleanPath(rel);
  return clean ? fullPath(clean) : null;
}

// A folder to list or upload into; "" is the library root.
export function resolveDir(rel) {
  const clean = cleanPath(rel ?? "");
  return clean === null ? null : fullPath(clean);
}

export function relPath(full) {
  return path.relative(/*turbopackIgnore: true*/ MEDIA_DIR, full).split(path.sep).join("/");
}

export async function ensureDir() {
  await fs.mkdir(/*turbopackIgnore: true*/ MEDIA_DIR, { recursive: true });
}

export async function exists(full) {
  try {
    await fs.access(full);
    return true;
  } catch {
    return false;
  }
}

// "clip.mp4" -> "clip (1).mp4", "clip (2).mp4", ... until the name is free in that folder.
export async function freeName(name, dir = MEDIA_DIR) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 1; await exists(path.join(/*turbopackIgnore: true*/ dir, candidate)); i++) {
    candidate = `${base} (${i})${ext}`;
  }
  return candidate;
}

export function tempPathFor(name, dir = MEDIA_DIR) {
  return path.join(/*turbopackIgnore: true*/ dir, `.${name}.${Date.now()}${TEMP_SUFFIX}`);
}

export async function diskSpace() {
  const stats = await fs.statfs(/*turbopackIgnore: true*/ MEDIA_DIR);
  return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
}

async function readMeta(key) {
  try {
    return JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ THUMB_DIR, `${key}.json`), "utf8"));
  } catch {
    return null;
  }
}

const visibleEntry = (e) => !e.name.startsWith(".") && !e.name.endsWith(TEMP_SUFFIX);

// Item count and a cover picture (the newest photo or video directly inside) for a folder card.
async function folderSummary(full) {
  const entries = (await fs.readdir(full, { withFileTypes: true }).catch(() => [])).filter(visibleEntry);
  let cover = null;
  for (const e of entries) {
    if (!e.isFile() || !["image", "video"].includes(kindOf(e.name))) continue;
    const stat = await fs.stat(path.join(full, e.name)).catch(() => null);
    if (stat && (!cover || stat.mtimeMs > cover.modified)) {
      cover = { path: relPath(path.join(full, e.name)), key: fileKey(stat), modified: stat.mtimeMs };
    }
  }
  return { count: entries.length, cover: cover && { path: cover.path, key: cover.key } };
}

// Whole-library size for the storage meter. Walking every folder is slow on big
// libraries, so the answer is reused for a minute.
let sizeCache = { at: 0, bytes: 0 };
export async function librarySize() {
  if (Date.now() - sizeCache.at < 60 * 1000) return sizeCache.bytes;
  async function walk(dir) {
    const entries = (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter(visibleEntry);
    let total = 0;
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) total += await walk(full);
      else if (e.isFile()) total += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
    }
    return total;
  }
  sizeCache = { at: Date.now(), bytes: await walk(MEDIA_DIR) };
  return sizeCache.bytes;
}

export function forgetLibrarySize() {
  sizeCache.at = 0;
}

// Lists one folder: its subfolders and its files. `dir` is a cleaned relative path.
export async function listMedia(dir = "") {
  await ensureDir();
  purgeTrash().catch(() => {});
  const full = fullPath(dir);
  const { readFavorites } = await import("@/lib/library");
  const favorites = await readFavorites();
  const entries = (await fs.readdir(full, { withFileTypes: true })).filter(visibleEntry);

  const folders = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const folderFull = path.join(full, e.name);
        const stat = await fs.stat(folderFull);
        return { name: e.name, path: relPath(folderFull), modified: stat.mtimeMs, ...(await folderSummary(folderFull)) };
      })
  );

  const files = await Promise.all(
    entries
      .filter((e) => e.isFile())
      .map(async (e) => {
        const fileFull = path.join(full, e.name);
        const stat = await fs.stat(fileFull);
        const key = fileKey(stat);
        const meta = await readMeta(key);
        return {
          name: e.name,
          path: relPath(fileFull),
          size: stat.size,
          modified: stat.mtimeMs,
          kind: kindOf(e.name),
          key,
          ...(favorites[key] && { favorite: true }),
          ...(meta && { duration: meta.duration, width: meta.width, height: meta.height }),
        };
      })
  );

  return {
    files: files.sort((a, b) => b.modified - a.modified),
    folders: folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  };
}

// Windows refuses to move a file another program has open (DaVinci, Photos, our own
// ffmpeg thumbnailer). Short locks clear within a second or two, so retry before giving up.
const LOCKED = new Set(["EBUSY", "EPERM", "EACCES"]);

export async function renameFile(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (error) {
      if (!LOCKED.has(error.code) || attempt >= 5) throw error;
      // Busy because the PC is making this video's streaming copies right now? Stop that
      // (it's made again later if the video is still there), then try again.
      if (attempt === 0) await import("@/lib/renditions").then((m) => m.stopWorkOn(from)).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}

// Turns a failed rename/delete into a response the phone can show as-is.
export function fileErrorResponse(error, action) {
  if (LOCKED.has(error.code)) {
    return Response.json(
      { error: `Can't ${action} — the file is open in another program on the PC (like DaVinci Resolve). Close it there and try again.` },
      { status: 423 }
    );
  }
  if (error.code === "ENOENT") return Response.json({ error: "File not found" }, { status: 404 });
  return Response.json({ error: `Couldn't ${action}: ${error.message}` }, { status: 500 });
}

// Deleted files and folders go to .trash so the UI can offer Undo; they're purged after
// a few days. The id carries the original location ("Goa Trip/clip.mp4", URL-encoded so
// it's a single file name), so Undo puts things back where they were.
export async function moveToTrash(full) {
  await fs.mkdir(TRASH_DIR, { recursive: true });
  let encoded = encodeURIComponent(relPath(full));
  if (encoded.length > 180) encoded = encodeURIComponent(path.basename(full)); // Windows name limit
  const id = `${Date.now()}__${encoded}`;
  await renameFile(full, path.join(/*turbopackIgnore: true*/ TRASH_DIR, id));
  forgetLibrarySize();
  return id;
}

export async function restoreFromTrash(id) {
  if (typeof id !== "string" || !/^\d+__/.test(id) || cleanName(id) !== id) return null;
  let original;
  try {
    original = decodeURIComponent(id.replace(/^\d+__/, ""));
  } catch {
    return null;
  }
  const target = resolveName(original);
  if (!target) return null;
  // The folder it came from may have been deleted meanwhile; recreate it.
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const name = await freeName(path.basename(target), dir);
  await renameFile(path.join(/*turbopackIgnore: true*/ TRASH_DIR, id), path.join(dir, name));
  forgetLibrarySize();
  return relPath(path.join(dir, name));
}

let lastPurge = 0;
async function purgeTrash() {
  if (Date.now() - lastPurge < 60 * 60 * 1000) return;
  lastPurge = Date.now();
  const ids = await fs.readdir(TRASH_DIR).catch(() => []);
  await Promise.all(
    ids
      .filter((id) => Date.now() - Number(id.split("__")[0]) > TRASH_MAX_AGE_MS)
      .map(async (id) => {
        const full = path.join(/*turbopackIgnore: true*/ TRASH_DIR, id);
        const stat = await fs.stat(full).catch(() => null);
        if (stat?.isFile()) {
          const key = fileKey(stat);
          for (const ext of [".webp", ".json"]) {
            await fs.rm(path.join(/*turbopackIgnore: true*/ THUMB_DIR, key + ext), { force: true });
          }
        }
        await fs.rm(full, { recursive: true, force: true });
      })
  );
}
