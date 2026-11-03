import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MEDIA_DIR, diskSpace, forgetLibrarySize, freeName, relPath, renameFile, resolveName } from "@/lib/media";
import { formatSize } from "@/lib/format";
import { UPLOAD_RESERVE } from "@/lib/storage-levels";

// Resumable uploads: the phone sends a file in pieces; what has arrived is kept in
// .uploads/<id>.part, so after a dropped connection (or picking the same file again
// later) the upload carries on from the last piece instead of starting over.
// The id is made by the phone from the file's folder, name, size and date, so the
// same file always gets the same id.
const DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".uploads");
const KEEP_MS = 3 * 24 * 3600 * 1000;
const validId = (id) => typeof id === "string" && /^[a-z0-9]{8,64}$/.test(id);
const partPath = (id) => path.join(DIR, `${id}.part`);
const metaPath = (id) => path.join(DIR, `${id}.json`);

export class UploadError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function readMeta(id) {
  try {
    return JSON.parse(await fs.readFile(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}

const received = async (id) => (await fs.stat(partPath(id)).catch(() => null))?.size ?? 0;

// Start or resume: returns how many bytes the PC already has.
// `extra` is kept with the upload and handed back when it finishes (phone backups keep
// the phone's fingerprint of the file there, to check it arrived byte for byte).
export async function openUpload({ id, name, size, extra = null }) {
  if (!validId(id)) throw new UploadError("Invalid upload id", 400);
  const target = resolveName(name);
  if (!target) throw new UploadError("Invalid file name", 400);
  if (!Number.isSafeInteger(size) || size < 0) throw new UploadError("Invalid size", 400);
  const folder = await fs.stat(path.dirname(target)).catch(() => null);
  if (!folder?.isDirectory()) throw new UploadError("That folder no longer exists", 404);

  await fs.mkdir(DIR, { recursive: true });
  let meta = await readMeta(id);
  if (!meta || meta.size !== size || meta.name !== name) {
    meta = { name, size, started: Date.now(), ...(extra && { extra }) };
    await fs.rm(partPath(id), { force: true });
    await fs.writeFile(metaPath(id), JSON.stringify(meta));
  }
  const offset = await received(id);
  const { free } = await diskSpace();
  if (size - offset > free - UPLOAD_RESERVE) {
    throw new UploadError(`Not enough space on the studio PC: ${formatSize(size - offset)} still to upload but only ${formatSize(Math.max(0, free - UPLOAD_RESERVE))} free.`, 507);
  }
  return { offset, size };
}

// Appends one piece. `offset` must match what the PC has (otherwise the phone is told
// the real position and continues from there). Finishes the file after the last piece.
export async function appendChunk(id, offset, body) {
  if (!validId(id)) throw new UploadError("Invalid upload id", 400);
  const meta = await readMeta(id);
  if (!meta) throw new UploadError("Upload not found — pick the file again", 404);
  const have = await received(id);
  if (offset !== have) return { offset: have, mismatch: true };
  await pipeline(Readable.fromWeb(body), createWriteStream(partPath(id), { flags: "a" }));
  let now = await received(id);
  if (now > meta.size) {
    // More than expected: drop the extra so the file is never corrupted.
    await fs.truncate(partPath(id), meta.size);
    now = meta.size;
  }
  if (now < meta.size) return { offset: now };

  const target = resolveName(meta.name);
  const dir = path.dirname(target);
  const finalName = await freeName(path.basename(target), dir);
  await renameFile(partPath(id), path.join(dir, finalName));
  await fs.rm(metaPath(id), { force: true });
  forgetLibrarySize();
  return { offset: now, done: true, name: finalName, path: relPath(path.join(dir, finalName)), extra: meta.extra ?? null };
}

export async function cancelUpload(id) {
  if (!validId(id)) return;
  await fs.rm(partPath(id), { force: true });
  await fs.rm(metaPath(id), { force: true });
}

// Unfinished uploads nobody came back to for 3 days.
export async function purgeUploads() {
  for (const name of await fs.readdir(DIR).catch(() => [])) {
    const file = path.join(DIR, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > KEEP_MS) await fs.rm(file, { force: true });
  }
}
