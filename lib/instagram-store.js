import { promises as fs } from "node:fs";
import path from "node:path";
import { MEDIA_DIR, cleanName, fileKey } from "@/lib/media";

// Instagram Export keeps its own working area so uploads made there never appear in
// the Media library. Only finished exports are moved into the library.
const ROOT = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".instagram");
export const SOURCE_DIR = path.join(/*turbopackIgnore: true*/ ROOT, "sources");
const REGISTRY = path.join(/*turbopackIgnore: true*/ ROOT, "exports.json");
const SOURCE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

// Source ids look like "<timestamp>-<file name>"; anything else is rejected.
export function sourcePath(id) {
  if (typeof id !== "string" || !/^\d+-/.test(id) || cleanName(id) !== id) return null;
  return path.join(/*turbopackIgnore: true*/ SOURCE_DIR, id);
}

export function newSourceId(name) {
  const clean = cleanName(name);
  return clean ? `${Date.now()}-${clean}` : null;
}

export const sourceDisplayName = (id) => id.replace(/^\d+-/, "");

export async function purgeOldSources() {
  const ids = await fs.readdir(SOURCE_DIR).catch(() => []);
  await Promise.all(
    ids
      .filter((id) => Date.now() - Number(id.split("-")[0]) > SOURCE_MAX_AGE_MS)
      .map((id) => fs.rm(path.join(/*turbopackIgnore: true*/ SOURCE_DIR, id), { force: true }))
  );
}

// Registry of library files produced by Instagram Export, keyed by content key
// (size + mtime), which survives renames — so the pink badge follows the file.
export async function readRegistry() {
  try {
    return JSON.parse(await fs.readFile(REGISTRY, "utf8"));
  } catch {
    return {};
  }
}

export async function registerExport(fullPath, meta) {
  const stat = await fs.stat(fullPath);
  const registry = await readRegistry();
  registry[fileKey(stat)] = { ...meta, createdAt: Date.now() };
  await fs.mkdir(ROOT, { recursive: true });
  const temp = `${REGISTRY}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(registry, null, 1));
  await fs.rename(temp, REGISTRY);
}
