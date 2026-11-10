import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
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

// ---------------------------------------------------------------------------------------
// Streaming, the way YouTube does it. Every video gets a "ladder" of lighter copies
// (1080p, 720p, 480p, 360p), each cut into 4-second pieces (HLS). The player measures the
// connection and picks the best rung piece by piece, so it starts fast, seeks instantly and
// never stalls on a weak signal. The original file is never touched, and "Original" in the
// player's quality menu (and every download) is still the exact original.
//
// .renditions/<key>/master.m3u8, v0/index.m3u8 + pieces, storyboard.jpg, info.json
// The folder is made as <key>.<pid>.part (one per server run, so a job left running by a
// restarted server can't collide) and renamed when complete, so a half-made ladder is
// never served.
// ---------------------------------------------------------------------------------------
export const RENDITION_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".renditions");

// Quality = the short side of the picture, so it means the same for vertical videos.
const RUNGS = [
  { q: 1080, crf: 23, maxrate: 5000, audio: 128 },
  { q: 720, crf: 23, maxrate: 2800, audio: 128 },
  { q: 480, crf: 24, maxrate: 1200, audio: 96 },
  { q: 360, crf: 25, maxrate: 700, audio: 96 },
];
const SEGMENT_S = 4;
const SPRITE_COLS = 10;
const SPRITE_W = 160; // width of one preview picture (landscape); height for portrait

export const ladderDir = (key) => path.join(/*turbopackIgnore: true*/ RENDITION_DIR, key);
const workDir = (key) => `${ladderDir(key)}.${process.pid}.part`;

const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false
  );
const readJson = (p) =>
  fs
    .readFile(p, "utf8")
    .then(JSON.parse)
    .catch(() => null);

// ----- The queue: one video at a time, low priority; a video someone is watching jumps ahead.
const jobs = new Map(); // key -> { full, progress, stage, promise, resolve, reject, started }
const waiting = []; // keys, front = next
let running = false;

function enqueue(full, key, urgent) {
  let job = jobs.get(key);
  if (!job) {
    job = { full, progress: 0, stage: "waiting" };
    job.promise = new Promise((res, rej) => ((job.resolve = res), (job.reject = rej)));
    job.promise.catch(() => {});
    jobs.set(key, job);
    waiting.push(key);
  }
  if (urgent && !job.started) {
    waiting.splice(waiting.indexOf(key), 1);
    waiting.unshift(key);
  }
  pump();
  return job;
}

async function pump() {
  if (running) return;
  const key = waiting.shift();
  if (!key) return;
  running = true;
  const job = jobs.get(key);
  job.started = true;
  try {
    await build(job.full, key, job);
    job.resolve();
  } catch (error) {
    job.reject(error);
    await fs.rm(workDir(key), { recursive: true, force: true }).catch(() => {});
    if (!job.stopped) failed.set(key, String(error.message || error).slice(0, 300));
    console.error(`[stream] ${path.basename(job.full)}: ${failed.get(key)}`);
  } finally {
    jobs.delete(key);
    running = false;
    pump();
  }
}
const failed = new Map(); // key -> why (not retried until the server restarts)
let working = null; // { full, proc }: the ffmpeg reading a video right now

// The video is being deleted, renamed or edited: stop reading it (Windows won't move a file
// that's open) and drop it from the queue. Its copies are made again later if it's still there.
export async function stopWorkOn(full) {
  for (const [key, job] of jobs) {
    if (job.full !== full) continue;
    job.stopped = true; // not a failure: it can be made again later
    const i = waiting.indexOf(key);
    if (i !== -1) {
      waiting.splice(i, 1);
      jobs.delete(key);
      job.reject(new Error("Stopped"));
    }
  }
  if (working?.full === full && working.proc.exitCode === null) {
    const proc = working.proc;
    await new Promise((resolve) => {
      proc.once("exit", resolve);
      proc.kill();
      setTimeout(resolve, 3000);
    });
  }
}

function ffmpeg(args, onProgress, duration, cwd, full) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ["-v", "error", "-y", "-nostats", "-progress", "pipe:1", ...args], { windowsHide: true, ...(cwd && { cwd }) });
    if (full) working = { full, proc: ff };
    // Below normal priority: the PC stays responsive for editing while copies are made.
    try {
      os.setPriority(ff.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    let err = "";
    ff.stdout.on("data", (d) => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m && duration && onProgress) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / duration));
    });
    ff.stderr.on("data", (d) => (err += d));
    ff.on("error", reject);
    ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg exited ${code}`))));
  });
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

async function build(full, key, job) {
  const info = await probe(full);
  const v = info.video;
  if (!v?.width || !v?.height) throw new Error("No picture in this file");
  const short = Math.min(v.width, v.height);
  const landscape = v.width >= v.height;
  // Rungs no bigger than the video itself; a small video gets one rung at its own size.
  let rungs = RUNGS.filter((r) => r.q <= short);
  if (!rungs.length) rungs = [{ ...RUNGS.at(-1), q: even(short) }];
  const size = (q) => {
    const long = even((q * Math.max(v.width, v.height)) / short);
    return landscape ? { width: long, height: q } : { width: q, height: long };
  };

  const work = workDir(key);
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });

  // 1. Storyboard: small pictures across the video for the seek-bar preview. Uses key frames
  //    only, so it takes a second or two even for 4K.
  job.stage = "preview";
  const count = Math.max(1, Math.min(100, Math.ceil(info.duration)));
  const rows = Math.ceil(count / SPRITE_COLS);
  const tileW = landscape ? SPRITE_W : even((SPRITE_W * v.width) / v.height);
  const tileH = landscape ? even((SPRITE_W * v.height) / v.width) : SPRITE_W;
  const sbFilters = [`fps=${count}/${Math.max(info.duration, 0.1)}`, `scale=${tileW}:${tileH}`, ...(v.hdr ? toneMap(v.hdr) : []), `tile=${SPRITE_COLS}x${rows}`];
  let storyboard = null;
  try {
    await ffmpeg(["-skip_frame", "nokey", "-i", full, "-an", "-vf", sbFilters.join(","), "-frames:v", "1", "-q:v", "5", path.join(work, "storyboard.jpg")], null, 0, undefined, full);
    storyboard = { count, cols: SPRITE_COLS, rows, w: tileW, h: tileH, interval: info.duration / count };
  } catch (error) {
    console.error(`[stream] preview pictures failed for ${path.basename(full)}: ${error.message}`);
  }

  // 2. The ladder: decode once, fix HDR colours once (at the top rung's size), then split.
  job.stage = "ladder";
  const top = size(rungs[0].q);
  const head = [`scale=${top.width}:${top.height}`, ...(v.hdr ? toneMap(v.hdr) : ["format=yuv420p"])];
  const split = rungs.map((_, i) => `[s${i}]`).join("");
  const graph = [`[0:v:0]${head.join(",")},split=${rungs.length}${split}`];
  rungs.forEach((r, i) => {
    const s = size(r.q);
    graph.push(i === 0 ? `[s0]null[v0]` : `[s${i}]scale=${s.width}:${s.height}[v${i}]`);
  });
  const hasAudio = Boolean(info.audio);
  const maps = [];
  const codecs = [];
  rungs.forEach((r, i) => {
    maps.push("-map", `[v${i}]`);
    codecs.push(`-crf:v:${i}`, String(r.crf), `-maxrate:v:${i}`, `${r.maxrate}k`, `-bufsize:v:${i}`, `${r.maxrate * 2}k`, `-b:v:${i}`, `${Math.round(r.maxrate * 0.7)}k`);
    if (hasAudio) {
      maps.push("-map", "0:a:0");
      codecs.push(`-b:a:${i}`, `${r.audio}k`);
    }
  });
  const streamMap = rungs.map((_, i) => (hasAudio ? `v:${i},a:${i},name:${i}` : `v:${i},name:${i}`)).join(" ");
  const fps = Math.min(60, v.fps || 30);
  await ffmpeg(
    [
      "-i", full,
      "-filter_complex", graph.join(";"),
      ...maps,
      "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p", "-threads", "4",
      ...codecs,
      // Key frames every 2 s on every rung, at the same moments, so the player can change
      // quality at any piece boundary without a glitch.
      "-fps_mode", "cfr", "-r", String(Math.round(fps)),
      "-force_key_frames", "expr:gte(t,n_forced*2)", "-sc_threshold", "0",
      ...(hasAudio ? ["-c:a", "aac", "-ac", "2", "-ar", "48000"] : []),
      "-f", "hls",
      "-hls_time", String(SEGMENT_S),
      "-hls_playlist_type", "vod",
      "-hls_segment_type", "fmp4",
      "-hls_flags", "independent_segments",
      "-hls_fmp4_init_filename", "init.mp4",
      // Runs inside the folder with "/" paths: playlists must say v0/index.m3u8 (not Windows
      // backslashes), and the start-up piece (init_N.mp4) lands next to its playlist.
      "-hls_segment_filename", "v%v/seg%03d.m4s",
      "-master_pl_name", "master.m3u8",
      "-var_stream_map", streamMap,
      "v%v/index.m3u8",
    ],
    (p) => (job.progress = p),
    info.duration,
    work,
    full
  );
  if (!(await exists(path.join(work, "master.m3u8")))) throw new Error("No playlist was made");

  await fs.writeFile(
    path.join(work, "info.json"),
    JSON.stringify({
      ladder: rungs.map((r, i) => ({ q: r.q, ...size(r.q), bandwidth: r.maxrate * 1000, dir: `v${i}` })),
      storyboard,
      made: Date.now(),
    })
  );
  await fs.rm(ladderDir(key), { recursive: true, force: true });
  await fs.rename(work, ladderDir(key));
  job.progress = 1;
}

// Everything the player needs: is the ladder ready (or how far along), the preview
// pictures, and facts about the original for the quality menu and "Stats for nerds".
const probeCache = new Map();
async function probeCached(full, key) {
  if (!probeCache.has(key)) {
    probeCache.set(key, probe(full).catch(() => null));
    if (probeCache.size > 500) probeCache.delete(probeCache.keys().next().value);
  }
  return probeCache.get(key);
}

export async function streamStatus(full, { start = false } = {}) {
  const stat = await fs.stat(full);
  const key = fileKey(stat);
  const [info, ready] = await Promise.all([probeCached(full, key), readJson(path.join(ladderDir(key), "info.json"))]);
  const v = info?.video;
  const source = info && {
    codec: v?.codec,
    width: v?.width,
    height: v?.height,
    fps: v?.fps ? Math.round(v.fps * 100) / 100 : null,
    hdr: v?.hdr,
    bitrate: info.bitrate,
    audio: info.audio?.codec ?? null,
    duration: info.duration,
  };
  if (ready) return { key, ready: true, ladder: ready.ladder, storyboard: ready.storyboard, source };
  // Someone wants to watch it now: move it to the front of the queue.
  let job = jobs.get(key);
  if (!job && start && !failed.has(key)) job = enqueue(full, key, true);
  else if (job && start) enqueue(full, key, true);
  return { key, ready: false, progress: job ? job.progress : null, stage: job?.stage ?? null, failed: failed.get(key) ?? null, source };
}

// Pieces are served by content key; only names the ladder itself made are allowed.
export function ladderFile(key, rel) {
  if (!/^[0-9a-f]{20}$/.test(key)) return null;
  if (!/^(master\.m3u8|storyboard\.jpg|v\d\/(index\.m3u8|init(_\d)?\.mp4|seg\d{3,5}\.m4s))$/.test(rel)) return null;
  return path.join(ladderDir(key), ...rel.split("/"));
}

// ----- Background: prepare every video, so it streams smoothly the first time it's opened.
async function prepareLibrary() {
  const { catalog } = await import("@/lib/catalog");
  const { files } = await catalog();
  const videos = files.filter((f) => f.kind === "video");
  const keep = new Set(videos.map((f) => f.key));
  await purgeRenditions({ keep });
  for (const f of videos) {
    if (jobs.has(f.key) || failed.has(f.key)) continue;
    if (await exists(path.join(ladderDir(f.key), "info.json"))) continue;
    enqueue(path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ...f.path.split("/")), f.key, false);
  }
}

export function startStreamWorker() {
  if (globalThis.__psStreamWorker) return;
  globalThis.__psStreamWorker = true;
  setTimeout(() => prepareLibrary().catch((e) => console.error("[stream]", e.message)), 45 * 1000);
  setInterval(() => prepareLibrary().catch((e) => console.error("[stream]", e.message)), 10 * 60 * 1000);
}

// Removes ladders whose video is gone (deleted, or changed by trim/rotate), half-made ones,
// and old-style single copies. `all` (PC short of space) removes every ladder; they're
// remade later, and videos play the original meanwhile.
export async function purgeRenditions({ all = false, keep = null } = {}) {
  const names = await fs.readdir(RENDITION_DIR).catch(() => []);
  let freed = 0;
  for (const name of names) {
    const key = name.split(".")[0];
    if (jobs.get(key)?.started) continue; // being made right now
    const stale = all || name.endsWith(".part") || !/^[0-9a-f]{20}$/.test(name) || (keep && !keep.has(key));
    if (!stale) continue;
    const full = path.join(RENDITION_DIR, name);
    const size = await sizeOf(full);
    // Still open by a job a restarted server left running: try again next time.
    if (await fs.rm(full, { recursive: true, force: true }).then(() => true, () => false)) freed += size;
  }
  return freed;
}

async function sizeOf(p) {
  const stat = await fs.stat(p).catch(() => null);
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const name of await fs.readdir(p).catch(() => [])) total += await sizeOf(path.join(p, name));
  return total;
}
