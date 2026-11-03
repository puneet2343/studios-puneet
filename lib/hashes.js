import crypto from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { MEDIA_DIR, fileKey } from "@/lib/media";

// SHA-256 fingerprints of the files in the library: two files with the same fingerprint
// are byte-for-byte the same. Used so the phone app never uploads a duplicate (even if the
// copy on the PC was renamed or moved into an album) and to prove every upload arrived
// exactly as it left the phone. Cached by content key in .meta/hashes.json; files nobody
// has fingerprinted yet are done in the background, one at a time.
const FILE = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "hashes.json");
export const isHash = (h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h);

let cache = null;
let saving = null;

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

async function save() {
  if (saving) return saving;
  saving = (async () => {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    const temp = `${FILE}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(cache));
    await fs.rename(temp, FILE);
  })().finally(() => (saving = null));
  return saving;
}

export function sha256File(full) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    createReadStream(full)
      .on("data", (d) => hash.update(d))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** Fingerprint of a library file (cached). */
export async function hashOf(full) {
  const stat = await fs.stat(full);
  const key = fileKey(stat);
  const c = await load();
  if (!c[key]) {
    c[key] = await sha256File(full);
    await save();
  }
  return c[key];
}

export async function remember(full, sha) {
  const stat = await fs.stat(full);
  const c = await load();
  c[fileKey(stat)] = sha;
  await save();
}

async function walk(dir, out) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith(".") || e.name.endsWith(".uploading")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/**
 * Where is a file with these exact bytes in the library? Looks at fingerprints already
 * known, and as a fallback at files with the same name and size that aren't fingerprinted
 * yet (those get fingerprinted now, so the answer is always exact).
 */
export async function findSame({ sha256, name, size }) {
  const c = await load();
  const files = await walk(path.resolve(/*turbopackIgnore: true*/ MEDIA_DIR), []);
  const lowerName = String(name ?? "").toLowerCase();
  for (const full of files) {
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    const known = c[fileKey(stat)];
    if (known) {
      if (known === sha256) return full;
    } else if (stat.size === size && (path.basename(full).toLowerCase() === lowerName || files.length < 5000)) {
      // Same size and not fingerprinted yet: check it properly.
      if ((await hashOf(full)) === sha256) return full;
    }
  }
  return null;
}

// Background: fingerprint everything (so duplicate checks stay fast as the library grows).
let working = false;
export async function hashLibrary() {
  if (working) return;
  working = true;
  try {
    for (const full of await walk(path.resolve(/*turbopackIgnore: true*/ MEDIA_DIR), [])) {
      await hashOf(full).catch(() => {});
    }
  } finally {
    working = false;
  }
}

export function startHashWorker() {
  if (globalThis.__psHashWorker) return;
  globalThis.__psHashWorker = true;
  setTimeout(() => hashLibrary().catch(() => {}), 60 * 1000);
  setInterval(() => hashLibrary().catch(() => {}), 15 * 60 * 1000);
}
