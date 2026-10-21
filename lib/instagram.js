import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FFMPEG, probe } from "@/lib/ffmpeg";
import { registerExport } from "@/lib/instagram-store";
import { MEDIA_DIR, freeName } from "@/lib/media";

// Instagram re-encodes every upload. This builds the cleanest master that stays inside
// Meta's published publishing spec (Instagram Graph API "Reels/Stories" video specs):
//   MP4, H.264 or HEVC, progressive, closed GOP, 4:2:0, 23–60 fps, ≤1920 px wide,
//   VBR ≤25 Mbps, AAC ≤48 kHz 1–2 ch, moov atom first, no edit lists,
//   Reels 3 s–15 min ≤300 MB, Stories 3–60 s ≤100 MB.

export const LIMITS = {
  reel: 180, // Reel length Instagram announced (Jan 2025); the API accepts up to 15 min
  reelMax: 900,
  story: 59.5, // a little under 60 s so a part never trips the limit
};
const SIZE_LIMIT = { reel: 300e6, story: 100e6 };
const W = 1080;
const H = 1920;
const AUDIO_KBPS = 192;
const EXPORT_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".export");

export const DEFAULT_OPTIONS = {
  format: "reel", // reel | story
  framing: "fill", // fill (crop to 9:16) | fit (whole frame on a blurred background)
  fps: "auto", // auto (≤30, same motion family) | smooth (keep up to 60)
  color: "sdr", // sdr | hdr (HDR sources only: 10-bit HEVC passthrough)
  denoise: false,
  loudness: true,
  trim: true, // Reels: cut to 3:00 (otherwise up to 15:00)
};

export function sanitizeOptions(input = {}) {
  const pick = (key, allowed) => (allowed.includes(input[key]) ? input[key] : DEFAULT_OPTIONS[key]);
  return {
    format: pick("format", ["reel", "story"]),
    framing: pick("framing", ["fill", "fit"]),
    fps: pick("fps", ["auto", "smooth"]),
    color: pick("color", ["sdr", "hdr"]),
    denoise: input.denoise === true,
    loudness: input.loudness !== false,
    trim: input.trim !== false,
  };
}

const isVertical = (v) => Math.abs(v.width / v.height - 9 / 16) < 0.01;

// Output frame rate, kept in the source's motion family so there's no judder:
// 59.94→29.97, 50→25, 48→24; "smooth" keeps 50/60. Instagram accepts 23–60 fps.
function targetRate(src, choice) {
  let r = Math.min(src || 30, 60);
  if (choice !== "smooth" && r > 30.5) r /= 2;
  if (r < 23) r = 24;
  const ntsc = [
    [23.976, "24000/1001"],
    [29.97, "30000/1001"],
    [59.94, "60000/1001"],
  ].find(([n]) => Math.abs(r - n) < 0.01);
  return { fps: r, expr: ntsc ? ntsc[1] : String(Math.round(r * 1000) / 1000) };
}

const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// Plain-language checks shown before exporting.
export function analyze(info) {
  const v = info.video;
  const checks = [];
  if (!v) return { info, checks: [{ level: "error", text: "This file has no video track." }] };

  checks.push(
    isVertical(v)
      ? { level: "ok", text: `Vertical 9:16 (${v.width}×${v.height}).` }
      : { level: "warn", text: `Not 9:16 (${v.width}×${v.height}). Choose below whether to crop it or show it all.` }
  );
  if (v.width < 1080 || v.height < 1920) {
    checks.push({ level: "warn", text: "Smaller than 1080×1920. Upscaling can't add detail, so it will look a little soft." });
  } else if (v.width > 1080) {
    checks.push({
      level: "ok",
      text: "Higher than 1080p. It's downscaled here with a high-quality filter, because Instagram's spec tops out at 1080×1920.",
    });
  }
  if (v.hdr) {
    const kind = v.hdr === "pq" ? "HDR10 / Dolby Vision" : "HLG";
    checks.push({ level: "info", text: `${kind} HDR. Exported as SDR by default (looks right everywhere). You can keep HDR below.` });
  } else if (v.tenBit) {
    checks.push({ level: "info", text: "10-bit video. Converted to 8-bit, the standard for SDR." });
  }
  if (v.fps > 30.5) {
    const half = Math.round(targetRate(v.fps, "auto").fps * 100) / 100;
    checks.push({ level: "info", text: `${Math.round(v.fps)} fps. Auto exports ${half} fps so each frame gets more detail. Choose Smooth to keep ${Math.round(v.fps)} fps.` });
  }
  if (v.vfr) checks.push({ level: "info", text: "Variable frame rate (common on phones). Converted to a steady frame rate to avoid stutter." });
  if (info.duration < 3) checks.push({ level: "warn", text: "Shorter than 3 seconds. Instagram needs at least 3 seconds." });
  if (info.duration > LIMITS.reel) {
    checks.push({
      level: "warn",
      text: `Longer than 3:00. As a Reel it's trimmed to 3:00 unless you turn that off (up to ${formatTime(LIMITS.reelMax)} allowed).`,
    });
  }
  if (info.duration > 60) {
    checks.push({ level: "info", text: `As a Story it becomes ${storyParts(info.duration).length} parts of up to 60 seconds.` });
  }
  if (!info.audio) checks.push({ level: "info", text: "No audio track." });
  return { info, checks };
}

// ---- ffmpeg command building ----

// HDR (PQ/HLG, BT.2020) -> SDR BT.709 with the Hable curve (the operator Meta uses for its own
// SDR versions). Runs after downscaling so it works on far fewer pixels.
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

// Filter order matters for speed: constant frame rate first, then scale/crop, and only then
// tone-map and denoise, so the expensive steps run on output-sized frames.
function buildGraph(v, opts, rate) {
  const keepHdr = opts.color === "hdr" && v.hdr;
  const pixFmt = keepHdr ? "yuv420p10le" : "yuv420p";
  const tags = keepHdr
    ? `setparams=color_primaries=bt2020:color_trc=${v.hdr === "pq" ? "smpte2084" : "arib-std-b67"}:colorspace=bt2020nc:range=tv`
    : "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";
  const finish = [...(v.hdr && !keepHdr ? toneMap(v.hdr) : []), ...(opts.denoise ? ["hqdn3d=1.5:1.5:6:6"] : [])];
  const chain = (steps) => steps.filter(Boolean).join(",");
  const head = [`fps=${rate.expr}`];

  if (opts.framing === "fit" && !isVertical(v)) {
    const bw = W / 4;
    const bh = H / 4;
    return (
      `[0:v]${chain([...head, "split"])}[a][b];` +
      `[b]${chain([`scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos`, ...finish])}[fg];` +
      // The background is built at quarter size (it's blurred anyway), then scaled up.
      `[a]${chain([
        `scale=${bw}:${bh}:force_original_aspect_ratio=increase:flags=fast_bilinear`,
        `crop=${bw}:${bh}`,
        ...(v.hdr && !keepHdr ? toneMap(v.hdr) : []),
        "gblur=sigma=12",
        `scale=${W}:${H}:flags=bicubic`,
        "eq=brightness=-0.08",
      ])}[bg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=${pixFmt},${tags}[vout]`
    );
  }
  return `[0:v]${chain([
    ...head,
    `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd+full_chroma_int`,
    `crop=${W}:${H}`,
    ...finish,
    "setsar=1",
    `format=${pixFmt}`,
    tags,
  ])}[vout]`;
}

function videoCodecArgs(v, opts, rate, { bitrate, pass, passlog }) {
  const keyint = Math.round(rate.fps * 2);
  const maxrate = rate.fps > 30.5 ? 24 : 20; // Mbps, under Instagram's 25 Mbps cap
  const rateArgs = bitrate ? ["-b:v", `${bitrate}k`] : ["-crf", opts.color === "hdr" && v.hdr ? "18" : "17"];

  if (opts.color === "hdr" && v.hdr) {
    const transfer = v.hdr === "pq" ? "smpte2084" : "arib-std-b67";
    const params = [
      `keyint=${keyint}`, `min-keyint=${keyint}`, "open-gop=0", "bframes=3",
      `vbv-maxrate=${maxrate * 1000}`, `vbv-bufsize=${maxrate * 2000}`,
      "hdr-opt=1", "repeat-headers=1", "colorprim=bt2020", `transfer=${transfer}`, "colormatrix=bt2020nc",
      "log-level=error",
      ...(pass ? [`pass=${pass}`, `stats=${passlog}.log`] : []),
    ];
    return [
      "-c:v", "libx265", "-preset", "medium", "-profile:v", "main10", ...rateArgs,
      "-x265-params", params.join(":"), "-tag:v", "hvc1",
      "-color_primaries", "bt2020", "-color_trc", transfer, "-colorspace", "bt2020nc", "-color_range", "tv",
    ];
  }
  return [
    "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-level:v", "4.2", ...rateArgs,
    "-maxrate", `${maxrate}M`, "-bufsize", `${maxrate * 2}M`,
    // Closed GOP is required by the spec; aq-mode 3 reduces banding in dark scenes.
    "-x264-params", `keyint=${keyint}:min-keyint=${keyint}:open-gop=0:bframes=3:aq-mode=3`,
    ...(pass ? ["-pass", String(pass), "-passlogfile", passlog] : []),
    "-tag:v", "avc1",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
  ];
}

function buildArgs(info, opts, { start, length, out, loudnorm, bitrate, pass, passlog }) {
  const v = info.video;
  const rate = targetRate(v.fps, opts.fps);
  const args = ["-hide_banner", "-v", "error", "-nostats", "-progress", "pipe:1", "-y"];
  if (start > 0) args.push("-ss", String(start));
  args.push("-i", info.path, "-t", String(length), "-filter_complex", buildGraph(v, opts, rate), "-map", "[vout]");

  const firstPass = pass === 1;
  if (info.audio && !firstPass) {
    args.push("-map", "0:a:0", "-c:a", "aac", "-profile:a", "aac_low", "-b:a", `${AUDIO_KBPS}k`, "-ac", "2");
    // loudnorm works at 192 kHz internally; resample back to 48 kHz (the spec maximum).
    if (loudnorm) args.push("-af", `${loudnorm},aresample=48000`);
    else args.push("-ar", "48000");
  }
  args.push("-fps_mode", "cfr", ...videoCodecArgs(v, opts, rate, { bitrate, pass, passlog }));
  if (firstPass) return [...args, "-an", "-f", "null", "-"];
  return [
    ...args,
    // Drop data/subtitle tracks and phone metadata; moov first; no edit lists (spec requirement).
    "-dn", "-sn", "-map_metadata", "-1", "-movflags", "+faststart", "-use_editlist", "0",
    out,
  ];
}

// ---- Planning: which pieces to export ----

function storyParts(duration) {
  const count = Math.max(1, Math.ceil(duration / LIMITS.story));
  const parts = Array.from({ length: count }, (_, i) => ({
    start: i * LIMITS.story,
    length: Math.min(LIMITS.story, duration - i * LIMITS.story),
  }));
  // Instagram needs at least 3 s per Story: share a short tail with the part before it.
  if (parts.length > 1 && parts.at(-1).length < 3) {
    const [a, b] = parts.slice(-2);
    const half = (a.length + b.length) / 2;
    a.length = half;
    b.start = a.start + half;
    b.length = half;
  }
  return parts;
}

function planParts(info, opts) {
  if (opts.format === "story") return storyParts(info.duration);
  return [{ start: 0, length: Math.min(info.duration, opts.trim ? LIMITS.reel : LIMITS.reelMax) }];
}

// ---- Running ffmpeg ----

function runFfmpeg(job, args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    job.process = proc;
    let stdout = "";
    let stderr = "";
    let buffer = "";
    proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20000)));
    proc.stdout.on("data", (d) => {
      stdout += d;
      buffer += d;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const [key, value] = line.trim().split("=");
        if (key === "out_time_us") onProgress?.(Number(value) / 1e6, null);
        else if (key === "speed" && parseFloat(value) > 0) onProgress?.(null, parseFloat(value));
      }
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      job.process = null;
      if (job.cancelled) reject(new Error("cancelled"));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim().split("\n").slice(-2).join(" ") || `ffmpeg exited with ${code}`));
    });
  });
}

// Two-pass loudness: measure first, then apply a single linear gain (no "pumping").
async function measureLoudness(job, info, start, length) {
  const args = ["-hide_banner", "-nostats", "-y"];
  if (start > 0) args.push("-ss", String(start));
  args.push("-i", info.path, "-t", String(length), "-vn", "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-");
  const { stderr } = await runFfmpeg(job, args);
  const json = stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1);
  const m = JSON.parse(json);
  if (!Number.isFinite(Number(m.input_i))) return null; // silent track
  return (
    `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
    `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  );
}

// ---- Job queue (one export at a time; state lives for the life of the server) ----

const store = (globalThis.__psInstagram ??= { jobs: [], running: null });

const publicJob = (j) => ({
  id: j.id,
  name: j.name,
  options: j.options,
  status: j.status,
  stage: j.stage,
  progress: j.progress,
  speed: j.speed,
  eta: j.eta,
  outputs: j.outputs,
  error: j.error,
  createdAt: j.createdAt,
  finishedAt: j.finishedAt,
});

export function listJobs() {
  return store.jobs.map(publicJob);
}

export async function createJob(full, name, rawOptions) {
  const options = sanitizeOptions(rawOptions);
  const info = { ...(await probe(full)), path: full };
  if (!info.video) throw new Error("This file has no video track");
  if (options.color === "hdr" && !info.video.hdr) options.color = "sdr";
  const job = {
    id: Math.random().toString(36).slice(2, 10),
    name,
    options,
    info,
    status: "queued",
    stage: "Waiting",
    progress: 0,
    speed: null,
    eta: null,
    outputs: [],
    error: null,
    createdAt: Date.now(),
  };
  store.jobs.unshift(job);
  store.jobs = store.jobs.slice(0, 30);
  pump();
  return publicJob(job);
}

export function cancelJob(id) {
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return false;
  if (job.status === "queued") {
    job.status = "cancelled";
  } else if (job.status === "running") {
    job.cancelled = true;
    job.process?.kill("SIGKILL");
  } else {
    store.jobs = store.jobs.filter((j) => j.id !== id); // dismiss a finished job
  }
  return true;
}

function pump() {
  if (store.running) return;
  const next = [...store.jobs].reverse().find((j) => j.status === "queued");
  if (!next) return;
  store.running = next;
  runJob(next).finally(() => {
    store.running = null;
    pump();
  });
}

async function runJob(job) {
  const dir = path.join(/*turbopackIgnore: true*/ EXPORT_DIR, job.id);
  await fs.mkdir(dir, { recursive: true });
  job.status = "running";
  const { info, options } = job;
  const parts = planParts(info, options);
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const sizeLimit = SIZE_LIMIT[options.format];

  try {
    let loudnorm = null;
    if (options.loudness && info.audio) {
      job.stage = "Measuring audio";
      // Measured over everything being exported, so Story parts share one consistent level.
      loudnorm = await measureLoudness(job, info, parts[0].start, total).catch(() => null);
    }

    let done = 0;
    for (const [i, part] of parts.entries()) {
      const label = parts.length > 1 ? ` part ${i + 1} of ${parts.length}` : "";
      const out = path.join(dir, `part-${String(i + 1).padStart(2, "0")}.mp4`);
      const track = (time, speed) => {
        if (time != null && total > 0) job.progress = Math.min(0.999, (done + time) / total);
        if (speed != null) job.speed = speed;
        if (job.speed) job.eta = ((1 - job.progress) * total) / job.speed;
      };

      job.stage = `Encoding${label}`;
      await runFfmpeg(job, buildArgs(info, options, { ...part, out, loudnorm }), track);

      // Size guard: if the high-quality encode is over Instagram's limit, re-encode in two
      // passes at the highest average bitrate that fits.
      const { size } = await fs.stat(out);
      if (size > sizeLimit * 0.98) {
        const audioKbps = info.audio ? AUDIO_KBPS : 0;
        const bitrate = Math.floor((sizeLimit * 0.95 * 8) / part.length / 1000 - audioKbps);
        const passlog = path.join(dir, `pass-${i + 1}`);
        job.stage = `Fitting under ${Math.round(sizeLimit / 1e6)} MB${label} · pass 1 of 2`;
        await runFfmpeg(job, buildArgs(info, options, { ...part, out, loudnorm, bitrate, pass: 1, passlog }), track);
        job.stage = `Fitting under ${Math.round(sizeLimit / 1e6)} MB${label} · pass 2 of 2`;
        await runFfmpeg(job, buildArgs(info, options, { ...part, out, loudnorm, bitrate, pass: 2, passlog }), track);
      }
      done += part.length;
    }

    // Move results into the library with clear names and record them as Instagram exports.
    job.stage = "Saving";
    const base = job.name.replace(/\.[^.]+$/, "");
    const label = options.format === "reel" ? "IG Reel" : "IG Story";
    const hdr = options.color === "hdr" ? " HDR" : "";
    const produced = (await fs.readdir(dir)).filter((f) => f.endsWith(".mp4")).sort();
    for (const [i, file] of produced.entries()) {
      const part = produced.length > 1 ? ` ${i + 1}` : "";
      const finalName = await freeName(`${base} - ${label}${hdr}${part}.mp4`);
      const finalPath = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, finalName);
      await fs.rename(path.join(dir, file), finalPath);
      await registerExport(finalPath, {
        source: job.name,
        format: options.format,
        color: options.color,
        part: produced.length > 1 ? i + 1 : null,
        parts: produced.length,
      });
      job.outputs.push(finalName);
    }
    job.status = "done";
    job.stage = "Done";
    job.progress = 1;
    job.eta = 0;
  } catch (error) {
    job.status = job.cancelled ? "cancelled" : "error";
    job.error = job.cancelled ? null : error.message;
  } finally {
    job.process = null;
    job.finishedAt = Date.now();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
