import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { catalog } from "@/lib/catalog";
import { MEDIA_DIR } from "@/lib/media";

// Best-shot cleanup (research: reports/Photo backup alerts and best shot.md).
// Finds photos that are the same or nearly the same, and suggests which one to keep:
//  - "exact": the same file saved twice (identical SHA-256)
//  - "near":  the same picture re-saved/resized (CLIP similarity ≥ 0.985 and dHash ≤ 6, any time apart)
//  - "burst": a quick run of shots of the same scene (≤ 3 s apart, ≤ 30 s in all, CLIP ≥ 0.93
//             to the first, same number of faces)
// The keeper is the favourite if there is one, otherwise the sharpest, best-exposed photo.
// It only ever suggests: removing goes to the Recycle Bin (with Undo), favourites are never
// suggested for removal, and nothing is changed until you say so.
const META = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta");
const QUALITY = path.join(META, "quality.json");
const NEAR_CLIP = 0.985;
const NEAR_DHASH = 6;
const BURST_GAP_MS = 3000;
const BURST_SPAN_MS = 30000;
const BURST_CLIP = 0.93;

const G = (globalThis.__psBest ??= { running: false, progress: { done: 0, total: 0 } });

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
}

// ----- Per-photo quality, measured once -----
// Sharpness: variance of the Laplacian on a 512 px grey copy (higher = sharper). Compared
// only within a group, never against a fixed number. Exposure: share of pixels that are
// pure black or blown-out white. dHash: 64-bit "looks like" fingerprint (9×8 grey).
export async function measure(full) {
  const { data, info } = await sharp(full, { failOn: "none" }).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  let clipped = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = data[y * w + x];
      if (p <= 4 || p >= 251) clipped++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
      const lap = 4 * p - data[(y - 1) * w + x] - data[(y + 1) * w + x] - data[y * w + x - 1] - data[y * w + x + 1];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / (n || 1);
  const sharpness = sumSq / (n || 1) - mean * mean;
  const tiny = await sharp(full, { failOn: "none" }).rotate().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (tiny[y * 9 + x] > tiny[y * 9 + x + 1] ? 1n : 0n);
  return { sharpness: Math.round(sharpness * 10) / 10, clipped: Math.round((clipped / (w * h)) * 1000) / 1000, dhash: bits.toString(16).padStart(16, "0") };
}

export async function measureLibrary() {
  if (G.running) return;
  G.running = true;
  try {
    const q = await readJson(QUALITY, {});
    const { files } = await catalog();
    const images = files.filter((f) => f.kind === "image" && !/\.(heic|heif)$/i.test(f.name));
    const todo = images.filter((f) => !q[f.key]);
    G.progress = { done: images.length - todo.length, total: images.length };
    let since = Date.now();
    for (const f of todo) {
      try {
        q[f.key] = await measure(path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ...f.path.split("/")));
      } catch {
        q[f.key] = { error: true };
      }
      G.progress.done++;
      if (Date.now() - since > 5000) {
        await writeJson(QUALITY, q);
        since = Date.now();
      }
    }
    await writeJson(QUALITY, q);
  } finally {
    G.running = false;
  }
}

export function startBestShotWorker() {
  if (globalThis.__psBestWorker) return;
  globalThis.__psBestWorker = true;
  setTimeout(() => measureLibrary().catch(() => {}), 90 * 1000);
  setInterval(() => measureLibrary().catch(() => {}), 10 * 60 * 1000);
}

// ----- Grouping and picking the keeper -----
function vec(b64) {
  const b = Buffer.from(b64, "base64");
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}
function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na * nb) || 1);
}
function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
const isCopyName = (p) => /\(\d+\)(\.[^.]+)?$|[-_ ]copy(\.[^.]+)?$/i.test(p);

export async function findGroups() {
  const [{ files }, quality, ai, hashes] = await Promise.all([catalog(), readJson(QUALITY, {}), readJson(path.join(META, "ai-index.json"), {}), readJson(path.join(META, "hashes.json"), {})]);
  const items = files
    .filter((f) => f.kind === "image")
    .map((f) => ({ ...f, q: quality[f.key], clip: ai[f.key]?.clip ? vec(ai[f.key].clip) : null, faces: ai[f.key]?.faces?.length ?? 0, sha: hashes[f.key] }));

  // Union-find over "these belong together" links.
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const tierOf = new Map(); // root -> strongest tier seen
  const link = (a, b, tier) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
    const r = find(a);
    const rank = { exact: 3, near: 2, burst: 1 };
    const best = [tierOf.get(ra), tierOf.get(rb), tier].filter(Boolean).sort((x, y) => rank[y] - rank[x])[0];
    tierOf.set(r, best);
  };

  // 1. Exact copies: identical SHA-256.
  const bySha = new Map();
  items.forEach((it, i) => {
    if (!it.sha) return;
    if (bySha.has(it.sha)) link(bySha.get(it.sha), i, "exact");
    else bySha.set(it.sha, i);
  });

  // 2. Near-duplicates: look alike to both measures, taken at any time.
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!a.q?.dhash || !a.clip) continue;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (!b.q?.dhash || !b.clip || find(i) === find(j)) continue;
      if (hamming(a.q.dhash, b.q.dhash) <= NEAR_DHASH && cosine(a.clip, b.clip) >= NEAR_CLIP) link(i, j, "near");
    }
  }

  // 3. Bursts: a quick run of shots of the same scene with the same number of people.
  const byTime = items.map((it, i) => i).filter((i) => items[i].clip).sort((x, y) => items[x].taken - items[y].taken);
  let start = 0;
  for (let k = 1; k < byTime.length; k++) {
    const prev = items[byTime[k - 1]];
    const cur = items[byTime[k]];
    const first = items[byTime[start]];
    const chained =
      cur.taken - prev.taken <= BURST_GAP_MS &&
      cur.taken - first.taken <= BURST_SPAN_MS &&
      cur.faces === first.faces &&
      cosine(cur.clip, first.clip) >= BURST_CLIP;
    if (chained) link(byTime[start], byTime[k], "burst");
    else start = k;
  }

  // Collect groups of 2+ and choose a keeper.
  const groups = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });
  const out = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const tier = tierOf.get(root) ?? "burst";
    const sharp = members.map((m) => m.q?.sharpness ?? 0);
    const top = Math.max(...sharp) || 1;
    const score = (m) => {
      const s = (m.q?.sharpness ?? 0) / top; // 0..1 within the group
      const exposure = 1 - Math.min(1, (m.q?.clipped ?? 0) * 4); // clipped highlights/shadows cost a bit
      return s * 0.75 + exposure * 0.2 + (isCopyName(m.path) ? 0 : 0.03) + Math.min(m.faces, 3) * 0.005;
    };
    const ranked = [...members].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || (tier === "exact" ? Number(isCopyName(a.path)) - Number(isCopyName(b.path)) : 0) || score(b) - score(a));
    const keeper = ranked[0];
    const reasonKeep = keeper.favorite ? "Favourite" : tier === "exact" ? "Original" : "Sharpest";
    const groupItems = ranked.map((m) => ({
      path: m.path,
      name: m.name,
      key: m.key,
      size: m.size,
      taken: m.taken,
      favorite: Boolean(m.favorite),
      keep: m === keeper || m.favorite, // favourites are never suggested for removal
      reason: m === keeper ? reasonKeep : m.favorite ? "Favourite" : tier === "exact" ? "Same file" : (m.q?.sharpness ?? 0) < (keeper.q?.sharpness ?? 0) * 0.85 ? "Less sharp" : "Very similar",
    }));
    out.push({
      id: keeper.key,
      tier,
      items: groupItems,
      saveBytes: groupItems.filter((g) => !g.keep).reduce((s, g) => s + g.size, 0),
      taken: keeper.taken,
    });
  }
  const order = { exact: 0, near: 1, burst: 2 };
  out.sort((a, b) => order[a.tier] - order[b.tier] || b.taken - a.taken);
  return {
    groups: out,
    saveBytes: out.reduce((s, g) => s + g.saveBytes, 0),
    progress: { ...G.progress, working: G.running },
  };
}
