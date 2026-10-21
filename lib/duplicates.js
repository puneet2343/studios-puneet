import { createReadStream, promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { MEDIA_DIR, fileKey, kindOf, relPath } from "@/lib/media";
import { readFavorites } from "@/lib/library";

const HASHES = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "hashes.json");
const SAMPLE = 1024 * 1024;

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function walk(dir, out) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith(".") || e.name.endsWith(".uploading")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile()) {
      const stat = await fs.stat(full).catch(() => null);
      if (stat && stat.size > 0) out.push({ full, stat });
    }
  }
}

// Start + end of the file: cheap, and enough to rule out almost every non-match.
async function quickHash(full, size) {
  const handle = await fs.open(full, "r");
  try {
    const hash = crypto.createHash("sha1");
    const head = Buffer.alloc(Math.min(SAMPLE, size));
    await handle.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > SAMPLE * 2) {
      const tail = Buffer.alloc(SAMPLE);
      await handle.read(tail, 0, SAMPLE, size - SAMPLE);
      hash.update(tail);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

function fullHash(full) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    createReadStream(full)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

// Which copy to keep: a starred one, then one already sorted into a folder, then the oldest.
function keeperScore(file) {
  return (file.favorite ? 4 : 0) + (file.path.includes("/") ? 2 : 0);
}

/**
 * Finds files with identical contents anywhere in the library. Only files of the same
 * size are compared; those are checked by a quick sample hash and then confirmed by a
 * full-content hash, so different files are never reported as duplicates.
 * Hashes are cached by content key, so later scans are fast.
 */
export async function findDuplicates() {
  const files = [];
  await walk(MEDIA_DIR, files);

  const bySize = new Map();
  for (const f of files) {
    if (!bySize.has(f.stat.size)) bySize.set(f.stat.size, []);
    bySize.get(f.stat.size).push(f);
  }

  const cache = await readJson(HASHES);
  let changed = false;
  const hashOf = async (f, kind) => {
    const key = `${kind}:${fileKey(f.stat)}`;
    if (!cache[key]) {
      cache[key] = kind === "q" ? await quickHash(f.full, f.stat.size) : await fullHash(f.full);
      changed = true;
    }
    return cache[key];
  };

  const groups = [];
  for (const same of bySize.values()) {
    if (same.length < 2) continue;
    const byQuick = new Map();
    for (const f of same) {
      const q = await hashOf(f, "q").catch(() => null);
      if (!q) continue;
      if (!byQuick.has(q)) byQuick.set(q, []);
      byQuick.get(q).push(f);
    }
    for (const candidates of byQuick.values()) {
      if (candidates.length < 2) continue;
      const byFull = new Map();
      for (const f of candidates) {
        const h = await hashOf(f, "f").catch(() => null);
        if (!h) continue;
        if (!byFull.has(h)) byFull.set(h, []);
        byFull.get(h).push(f);
      }
      for (const [hash, copies] of byFull) if (copies.length > 1) groups.push({ hash, copies });
    }
  }

  if (changed) {
    await fs.mkdir(path.dirname(HASHES), { recursive: true });
    const temp = `${HASHES}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(cache));
    await fs.rename(temp, HASHES);
  }

  const favorites = await readFavorites();
  const result = groups.map(({ hash, copies }) => {
    const described = copies.map(({ full, stat }) => {
      const name = path.basename(full);
      const key = fileKey(stat);
      return { name, path: relPath(full), size: stat.size, modified: stat.mtimeMs, kind: kindOf(name), key, ...(favorites[key] && { favorite: true }) };
    });
    described.sort((a, b) => keeperScore(b) - keeperScore(a) || a.modified - b.modified);
    return { id: hash.slice(0, 16), size: described[0].size, keep: described[0].path, files: described };
  });
  result.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
  return {
    groups: result,
    scanned: files.length,
    wasted: result.reduce((sum, g) => sum + g.size * (g.files.length - 1), 0),
  };
}
