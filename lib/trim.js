import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { FFMPEG, FFPROBE, probe, run } from "@/lib/ffmpeg";
import {
  THUMB_DIR,
  fileKey,
  forgetLibrarySize,
  freeName,
  moveToTrash,
  renameFile,
  restoreFromTrash,
  tempPathFor,
} from "@/lib/media";

const STRIP_FRAMES = 10;
const STRIP_HEIGHT = 96;

// Keyframe times, read from the packet index (no decoding, so it's quick even for 4K).
// A lossless cut can only start on one of these.
export async function trimInfo(full) {
  const [{ stdout }, info] = await Promise.all([
    run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", full], {
      maxBuffer: 64 * 1024 * 1024,
    }),
    probe(full),
  ]);
  const keyframes = stdout
    .split(/\r?\n/)
    .filter((line) => line.includes("K"))
    .map((line) => Number(line.split(",")[0]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return { duration: info.duration, keyframes };
}

async function frameAt(full, at) {
  const { stdout } = await run(
    FFMPEG,
    ["-v", "error", "-ss", String(at), "-i", full, "-frames:v", "1", "-vf", `scale=-2:${STRIP_HEIGHT}`, "-f", "image2pipe", "-c:v", "png", "pipe:1"],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }
  );
  if (!stdout.length) throw new Error("no frame");
  return stdout;
}

const stripJobs = new Map();

// A row of small frames for the trim timeline, cached next to the thumbnails.
export async function filmstrip(full) {
  const stat = await fs.stat(full);
  const out = path.join(/*turbopackIgnore: true*/ THUMB_DIR, `${fileKey(stat)}-strip.webp`);
  try {
    await fs.access(out);
    return out;
  } catch {}
  if (!stripJobs.has(out)) {
    const job = (async () => {
      const { duration } = await probe(full);
      const times = Array.from({ length: STRIP_FRAMES }, (_, i) => (duration * (i + 0.5)) / STRIP_FRAMES);
      const frames = [];
      for (let i = 0; i < times.length; i += 3) {
        frames.push(...(await Promise.all(times.slice(i, i + 3).map((t) => frameAt(full, t).catch(() => null)))));
      }
      const good = frames.filter(Boolean);
      if (!good.length) throw new Error("no frames");
      const metas = await Promise.all(good.map((f) => sharp(f).metadata()));
      const width = metas[0].width;
      await fs.mkdir(THUMB_DIR, { recursive: true });
      const temp = `${out}.${process.pid}.tmp`;
      await sharp({ create: { width: width * good.length, height: STRIP_HEIGHT, channels: 3, background: "#000" } })
        .composite(good.map((input, i) => ({ input, left: i * width, top: 0 })))
        .webp({ quality: 60 })
        .toFile(temp);
      await fs.rename(temp, out);
      return out;
    })().finally(() => stripJobs.delete(out));
    stripJobs.set(out, job);
  }
  return stripJobs.get(out);
}

// Cuts [start, end] out of a video without re-encoding (stream copy), so quality is
// identical to the original. `replace` swaps the original for the cut (the original
// goes to the trash, so it can still be restored); otherwise a new file is added.
export async function trimVideo(full, start, end, { replace = false } = {}) {
  const dir = path.dirname(full);
  const ext = path.extname(full);
  const base = path.basename(full, ext);
  const temp = tempPathFor(`${base}-trim${ext}`, dir);
  try {
    await run(
      FFMPEG,
      [
        "-v", "error", "-y",
        "-ss", start.toFixed(3),
        "-i", full,
        "-t", (end - start).toFixed(3),
        "-map", "0:v:0", "-map", "0:a?",
        "-c", "copy",
        "-map_metadata", "0",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        // The temp name ends in ".uploading", so name the container explicitly.
        "-f", ext.toLowerCase() === ".mov" ? "mov" : ext.toLowerCase() === ".mkv" ? "matroska" : "mp4",
        temp,
      ],
      { maxBuffer: 8 * 1024 * 1024 }
    );
    if (!replace) {
      const target = path.join(dir, await freeName(`${base} (trimmed)${ext}`, dir));
      await renameFile(temp, target);
      forgetLibrarySize();
      return { full: target, trashId: null };
    }
    const trashId = await moveToTrash(full);
    try {
      await renameFile(temp, full);
    } catch (error) {
      // Couldn't put the cut in place: bring the original straight back.
      await restoreFromTrash(trashId).catch(() => {});
      throw error;
    }
    forgetLibrarySize();
    return { full, trashId };
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}
