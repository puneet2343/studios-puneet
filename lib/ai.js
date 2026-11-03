import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { MEDIA_DIR, fileKey, kindOf, relPath } from "@/lib/media";
import { getThumb } from "@/lib/thumbs";

// Photo search ("beach", "cake", "baby"…) and People, worked out on this PC only.
// A separate low-priority helper (scripts/ai-worker.mjs) looks at each photo once and
// returns what it shows (a CLIP "meaning" vector) and the faces in it. Results are kept
// in .meta/ai-index.json by content key (so they survive renames and moves); people in
// .meta/people.json. Files are only ever read.
const META = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta");
const INDEX = path.join(META, "ai-index.json");
const PEOPLE = path.join(META, "people.json");
const WORKER = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "ai-worker.mjs");
const SAME_PERSON = 0.64; // cosine similarity to a person's average face (measured on real photos)

// ----- Helper process -----
// Shared by every copy of this module in the server (background job and screens alike).
const G = (globalThis.__psAi ??= { worker: null, nextId: 1, waiting: new Map(), cache: {} });
const waiting = G.waiting;

function startWorker() {
  if (G.worker) return G.worker;
  const child = spawn(process.execPath, [WORKER], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  try {
    os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {}
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(msg.error));
    else w.resolve(msg);
  });
  child.stderr.on("data", () => {}); // model download chatter
  child.on("exit", () => {
    G.worker = null;
    for (const w of waiting.values()) w.reject(new Error("AI helper stopped"));
    waiting.clear();
  });
  G.worker = child;
  return child;
}

function ask(cmd, extra, timeoutMs = 10 * 60 * 1000) {
  const child = startWorker();
  const id = G.nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("AI helper took too long"));
    }, timeoutMs);
    waiting.set(id, {
      resolve: (v) => (clearTimeout(timer), resolve(v)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    });
    child.stdin.write(JSON.stringify({ id, cmd, ...extra }) + "\n");
  });
}

// ----- Stored results (kept in memory, re-read when the file on disk is newer) -----

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(file, data) {
  await fs.mkdir(META, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data));
  await fs.rename(temp, file);
  G.cache[file] = { mtime: (await fs.stat(file)).mtimeMs, data };
}
async function cached(file, fallback) {
  const mtime = (await fs.stat(file).catch(() => null))?.mtimeMs ?? 0;
  if (!mtime) {
    G.cache[file] = { mtime: 0, data: fallback };
    return fallback;
  }
  const c = G.cache[file];
  if (c && c.mtime >= mtime) return c.data;
  const data = await readJson(file, fallback);
  G.cache[file] = { mtime, data };
  return data;
}
const loadIndex = () => cached(INDEX, {});
const loadPeople = () => cached(PEOPLE, { people: [] });

// Copy out just this vector's bytes (small Buffers share one big memory block).
function vec(b64) {
  const b = Buffer.from(b64, "base64");
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}
const toB64 = (v) => Buffer.from(new Float32Array(v).buffer).toString("base64");
function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na * nb) || 1);
}

// ----- Library walk -----
async function mediaFiles() {
  const out = [];
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || e.name.endsWith(".uploading")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && ["image", "video"].includes(kindOf(e.name))) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) out.push({ full, stat, key: fileKey(stat) });
      }
    }
  }
  await walk(path.resolve(/*turbopackIgnore: true*/ MEDIA_DIR));
  return out;
}

// ----- People: each new face joins the closest person, or starts a new one -----
function assignFaces(key, faces, list) {
  faces.forEach((face, i) => {
    const e = vec(face.emb);
    let best = null;
    let bestSim = SAME_PERSON;
    for (const p of list.people) {
      if (p.merged) continue;
      const s = cosine(e, vec(p.centroid));
      if (s >= bestSim) {
        bestSim = s;
        best = p;
      }
    }
    if (best) {
      // Running average keeps the person's "typical face" up to date.
      const c = vec(best.centroid);
      const n = best.faces.length;
      for (let k = 0; k < c.length; k++) c[k] = (c[k] * n + e[k]) / (n + 1);
      best.centroid = toB64(c);
      best.faces.push([key, i]);
    } else {
      list.people.push({ id: crypto.randomBytes(5).toString("hex"), name: "", centroid: face.emb, faces: [[key, i]] });
    }
  });
}

// ----- Background: analyse every photo/video once -----
G.progress ??= { done: 0, total: 0, working: false };

export async function analyseLibrary() {
  if (G.running) return;
  G.running = true;
  try {
    const idx = await loadIndex();
    const list = await loadPeople();
    const files = await mediaFiles();
    // New files, plus ones that failed more than 6 hours ago (e.g. still being copied then).
    const todo = files.filter((f) => !idx[f.key] || (idx[f.key].error && Date.now() - idx[f.key].at > 6 * 3600 * 1000));
    G.progress = { done: files.length - todo.length, total: files.length, working: todo.length > 0 };
    let since = Date.now();
    for (const f of todo) {
      try {
        // Videos (and anything sharp can't read) are looked at through their thumbnail.
        let source = f.full;
        if (kindOf(f.full) === "video" || /\.(heic|heif)$/i.test(f.full)) source = await getThumb(f.full, f.stat);
        if (!source) throw new Error("no picture");
        const r = await ask("analyse", { file: source });
        idx[f.key] = { clip: r.clip, faces: r.faces, at: Date.now() };
        assignFaces(f.key, r.faces, list);
      } catch (error) {
        idx[f.key] = { error: String(error.message).slice(0, 120), at: Date.now() };
      }
      G.progress.done++;
      if (Date.now() - since > 5000) {
        await Promise.all([writeJson(INDEX, idx), writeJson(PEOPLE, list)]);
        since = Date.now();
      }
    }
    await Promise.all([writeJson(INDEX, idx), writeJson(PEOPLE, list)]);
  } finally {
    G.progress.working = false;
    G.running = false;
  }
}

export function startAiWorker() {
  if (globalThis.__psAiWorker) return;
  globalThis.__psAiWorker = true;
  setTimeout(() => analyseLibrary().catch(() => {}), 45 * 1000);
  setInterval(() => analyseLibrary().catch(() => {}), 3 * 60 * 1000);
}

export const aiProgress = () => ({ ...G.progress });

// ----- Search by meaning -----
/** Paths of photos/videos that look like `q`, best first. */
export async function searchByMeaning(q, limit = 120) {
  const idx = await loadIndex();
  const { clip } = await ask("text", { q }, 60 * 1000);
  const t = vec(clip);
  const files = await mediaFiles();
  const scored = [];
  for (const f of files) {
    const e = idx[f.key];
    if (e?.clip) scored.push({ path: relPath(f.full), score: cosine(t, vec(e.clip)) });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  // CLIP scores are close together; keep the clear leaders only.
  const best = scored[0].score;
  return scored.filter((s) => s.score >= Math.max(0.21, best - 0.03)).slice(0, limit);
}

// ----- People for the app -----
export async function listPeople() {
  const list = await loadPeople();
  const files = await mediaFiles();
  const byKey = new Map(files.map((f) => [f.key, relPath(f.full)]));
  return list.people
    .filter((p) => !p.merged && !p.hidden)
    .map((p) => {
      const paths = [...new Set(p.faces.map(([k]) => byKey.get(k)).filter(Boolean))];
      const cover = p.faces.find(([k]) => byKey.has(k));
      return { id: p.id, name: p.name, count: paths.length, paths, cover: cover ? { key: cover[0], i: cover[1] } : null };
    })
    .filter((p) => p.count >= 2)
    .sort((a, b) => Number(Boolean(b.name)) - Number(Boolean(a.name)) || b.count - a.count);
}

export async function updatePerson(id, { name, hidden, mergeInto }) {
  const list = await loadPeople();
  const p = list.people.find((x) => x.id === id);
  if (!p) return null;
  if (typeof name === "string") p.name = name.trim().slice(0, 60);
  if (typeof hidden === "boolean") p.hidden = hidden;
  if (mergeInto) {
    const target = list.people.find((x) => x.id === mergeInto && !x.merged);
    if (target && target !== p) {
      const a = vec(target.centroid);
      const b = vec(p.centroid);
      const na = target.faces.length;
      const nb = p.faces.length;
      for (let k = 0; k < a.length; k++) a[k] = (a[k] * na + b[k] * nb) / (na + nb);
      target.centroid = toB64(a);
      target.faces.push(...p.faces);
      if (!target.name && p.name) target.name = p.name;
      p.faces = [];
      p.merged = target.id;
    }
  }
  await writeJson(PEOPLE, list);
  return p;
}

/** Where a face is in a photo (fractions of width/height), for the round face pictures. */
export async function faceBox(key, i) {
  const idx = await loadIndex();
  return idx[key]?.faces?.[i]?.box ?? null;
}

export async function findByKey(key) {
  return (await mediaFiles()).find((f) => f.key === key) ?? null;
}
