import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { FFMPEG, probe, run } from "@/lib/ffmpeg";
import { THUMB_DIR, fileKey, kindOf } from "@/lib/media";

const THUMB_SIZE = 480;
const MAX_PARALLEL = 2;

// Small semaphore so a grid full of new videos doesn't spawn dozens of ffmpeg processes.
let active = 0;
const waiting = [];
async function withSlot(task) {
  if (active >= MAX_PARALLEL) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const inFlight = new Map();
const failed = new Set();

async function probeVideo(full) {
  const info = await probe(full);
  return { duration: info.duration, width: info.video?.width, height: info.video?.height };
}

async function videoFrame(full, at) {
  const { stdout } = await run(
    FFMPEG,
    ["-v", "error", "-ss", String(at), "-i", full, "-frames:v", "1",
     "-vf", `scale=${THUMB_SIZE}:-2`, "-f", "image2pipe", "-c:v", "png", "pipe:1"],
    { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 }
  );
  if (!stdout.length) throw new Error("no frame");
  return stdout;
}

async function generate(full, key) {
  const out = path.join(/*turbopackIgnore: true*/ THUMB_DIR, `${key}.webp`);
  const kind = kindOf(full);
  let source;
  let meta = {};

  if (kind === "video") {
    meta = await probeVideo(full);
    const at = Math.min(1, meta.duration * 0.1);
    source = await videoFrame(full, at).catch(() => videoFrame(full, 0));
  } else {
    try {
      const info = await sharp(full, { failOn: "none" }).metadata();
      meta = { width: info.autoOrient?.width ?? info.width, height: info.autoOrient?.height ?? info.height };
      source = full;
    } catch {
      // sharp's prebuilt libvips can't decode HEIC; ffmpeg can.
      source = await videoFrame(full, 0);
    }
  }

  const temp = `${out}.${process.pid}.tmp`;
  await sharp(source, { failOn: "none" })
    .rotate()
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(temp);
  await fs.rename(temp, out);
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ THUMB_DIR, `${key}.json`), JSON.stringify(meta));
  return out;
}

// Returns the path of a cached WebP thumbnail, creating it on first request.
export async function getThumb(full, stat) {
  const key = fileKey(stat);
  const out = path.join(/*turbopackIgnore: true*/ THUMB_DIR, `${key}.webp`);
  try {
    await fs.access(out);
    return out;
  } catch {}
  if (failed.has(key)) return null;
  if (!inFlight.has(key)) {
    const job = (async () => {
      await fs.mkdir(THUMB_DIR, { recursive: true });
      return withSlot(() => generate(full, key));
    })()
      .catch(() => {
        failed.add(key);
        return null;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, job);
  }
  return inFlight.get(key);
}
