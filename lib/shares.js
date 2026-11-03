import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MEDIA_DIR, cleanName, cleanPath, kindOf, resolveDir } from "@/lib/media";

// Shared albums: a private link (long random token) lets anyone who has it see one album and
// download its originals, without logging in. Stored in .meta/shares.json. A link can expire,
// and "Stop sharing" deletes it at once. Only the files directly in the album are shared.
const FILE = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "shares.json");

async function readAll() {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}
async function writeAll(all) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(all, null, 1));
  await fs.rename(temp, FILE);
}

const live = (s) => s && (!s.expires || s.expires > Date.now());

export async function listShares(album) {
  const all = await readAll();
  return Object.entries(all)
    .filter(([, s]) => live(s) && (album === undefined || s.album === album))
    .map(([token, s]) => ({ token, ...s }));
}

export async function createShare(album, days) {
  const clean = cleanPath(album);
  if (!clean) return { error: "Pick an album to share" };
  const all = await readAll();
  for (const [t, s] of Object.entries(all)) if (!live(s)) delete all[t]; // tidy expired links
  const token = crypto.randomBytes(18).toString("base64url");
  all[token] = { album: clean, created: Date.now(), expires: days ? Date.now() + days * 24 * 60 * 60 * 1000 : null };
  await writeAll(all);
  return { token, ...all[token] };
}

export async function deleteShare(token) {
  const all = await readAll();
  delete all[token];
  await writeAll(all);
}

// What a link gives access to: the album folder and its photos/videos (nothing else).
export async function openShare(token) {
  if (typeof token !== "string" || !/^[\w-]{20,40}$/.test(token)) return null;
  const s = (await readAll())[token];
  if (!live(s)) return null;
  const dir = resolveDir(s.album);
  if (!dir) return null;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith(".") || e.name.endsWith(".uploading")) continue;
    const kind = kindOf(e.name);
    if (kind !== "image" && kind !== "video") continue;
    const stat = await fs.stat(path.join(dir, e.name)).catch(() => null);
    if (stat) files.push({ name: e.name, kind, size: stat.size, modified: stat.mtimeMs, full: path.join(dir, e.name), stat });
  }
  files.sort((a, b) => b.modified - a.modified);
  return { ...s, title: s.album.split("/").at(-1), files, file: (name) => (cleanName(name) === name ? files.find((f) => f.name === name) : undefined) };
}
