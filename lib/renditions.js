import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FFMPEG, probe } from "@/lib/ffmpeg";
import { MEDIA_DIR, fileKey } from "@/lib/media";

// HDR (phone "HDR10+" / HLG video) to normal colours, so copies don't look grey.
export function toneMap(hdr) {
  const tin = hdr === "pq" ? "smpte2084" : "arib-std-b67";
  return [
    `zscale=tin=${tin}:min=bt2020nc:pin=bt2020:rin=tv:t=linear:npl=100`,
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
  ];
}

// Videos always play the original file. A lighter copy is only ever made if you pick a
// lower quality yourself in the player's quality menu. Copies are only for viewing
// (originals never change) and are removed after 14 days unwatched.
export const RENDITION_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".renditions");
const KEEP_MS = 14 * 24 * 3600 * 1000;

// Quality = the short side of the picture, so it means the same for vertical videos.
export const QUALITIES = {
  1080: { crf: 22, maxrate: "8M", audio: "192k" },
  720: { crf: 23, maxrate: "4M", audio: "160k" },
  480: { crf: 24, maxrate: "2M", audio: "128k" },
};

const jobs = new Map(); // file -> { progress, promise }
let queue = Promise.resolve();

export const renditionPath = (key, q) => path.join(/*turbopackIgnore: true*/ RENDITION_DIR, `${key}-${q}.mp4`);

async function exists(file) {
  return fs.access(file).then(
    () => true,
    () => false
  );
}

// Which lighter qualities make sense for this video, and which are ready.
export async function renditionStatus(full) {
  const stat = await fs.stat(full);
  const key = fileKey(stat);
  const info = await probe(full);
  const short = Math.min(info.video?.width || 0, info.video?.height || 0);
  const options = await Promise.all(
    Object.keys(QUALITIES)
      .map(Number)
      .filter((q) => q < short)
      .sort((a, b) => b - a)
      .map(async (q) => {
        const out = renditionPath(key, q);
        const job = jobs.get(out);
        return { q, ready: !job && (await exists(out)), progress: job ? job.progress : null };
      })
  );
  return { key, short, bitrate: info.bitrate, options };
}

// Starts (or joins) making one quality. Resolves with the finished file's path.
export async function ensureRendition(full, q) {
  if (!QUALITIES[q]) throw new Error("Unknown quality");
  const stat = await fs.stat(full);
  const out = renditionPath(fileKey(stat), q);
  if (jobs.has(out)) return jobs.get(out).promise;
  if (await exists(out)) {
    const now = new Date();
    await fs.utimes(out, now, now).catch(() => {}); // watched again: keep it longer
    return out;
  }
  const job = { progress: 0 };
  // One at a time; a failed job never blocks the ones queued after it.
  job.promise = queue = queue.catch(() => {}).then(() => encode(full, q, out, job));
  job.promise.finally(() => jobs.delete(out)).catch(() => {});
  jobs.set(out, job);
  return job.promise;
}

async function encode(full, q, out, job) {
  const info = await probe(full);
  const settings = QUALITIES[q];
  // Scale the short side to q (works for vertical and horizontal), then fix HDR colours so
  // the copy doesn't look grey on normal screens.
  const filters = [`scale='if(gt(iw,ih),-2,${q})':'if(gt(iw,ih),${q},-2)'`, ...(info.video?.hdr ? toneMap(info.video.hdr) : ["format=yuv420p"])];
  const audio = !info.audio ? ["-an"] : info.audio.codec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", settings.audio];
  await fs.mkdir(RENDITION_DIR, { recursive: true });
  const temp = `${out}.${process.pid}.part`;
  await new Promise((resolve, reject) => {
    const ff = spawn(
      FFMPEG,
      [
        "-v", "error", "-y", "-nostats", "-progress", "pipe:1",
        "-i", full,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", filters.join(","),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", String(settings.crf), "-threads", "4",
        "-maxrate", settings.maxrate, "-bufsize", settings.maxrate.replace("M", "") * 2 + "M",
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        ...audio,
        "-movflags", "+faststart",
        "-f", "mp4", temp,
      ],
      { windowsHide: true }
    );
    let err = "";
    ff.stdout.on("data", (d) => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m && info.duration) job.progress = Math.min(0.99, Number(m[1]) / 1e6 / info.duration);
    });
    ff.stderr.on("data", (d) => (err += d));
    ff.on("error", reject);
    ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg exited ${code}`))));
  }).catch(async (error) => {
    await fs.rm(temp, { force: true });
    throw error;
  });
  await fs.rename(temp, out);
  job.progress = 1;
  return out;
}

// Removes copies nobody has watched for 14 days, or all of them when space is short.
export async function purgeRenditions({ all = false } = {}) {
  const names = await fs.readdir(RENDITION_DIR).catch(() => []);
  let freed = 0;
  for (const name of names) {
    const file = path.join(RENDITION_DIR, name);
    if (jobs.has(file) || jobs.has(file.replace(/.d+.part$/, ""))) continue; // being made right now
    const stat = await fs.stat(file).catch(() => null);
    if (stat && (all || Date.now() - stat.mtimeMs > KEEP_MS || name.endsWith(".part"))) {
      await fs.rm(file, { force: true });
      freed += stat.size;
    }
  }
  return freed;
}

