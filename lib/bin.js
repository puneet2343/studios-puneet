import { promises as fs } from "node:fs";
import path from "node:path";
import { TRASH_DIR, TRASH_MAX_AGE_MS, cleanName, fileKey, kindOf } from "@/lib/media";

// Recycle Bin: everything in .trash. Ids look like "<deleted at ms>__<URL-encoded original path>".
export function trashPath(id) {
  if (typeof id !== "string" || !/^\d+__/.test(id) || cleanName(id) !== id) return null;
  return path.join(/*turbopackIgnore: true*/ TRASH_DIR, id);
}

function originalPath(id) {
  try {
    return decodeURIComponent(id.replace(/^\d+__/, ""));
  } catch {
    return id.replace(/^\d+__/, "");
  }
}

async function folderSize(dir) {
  let size = 0;
  let count = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const inner = await folderSize(full);
      size += inner.size;
      count += inner.count;
    } else if (e.isFile()) {
      size += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
      count++;
    }
  }
  return { size, count };
}

export async function listBin() {
  const ids = await fs.readdir(TRASH_DIR).catch(() => []);
  const items = await Promise.all(
    ids.map(async (id) => {
      const full = trashPath(id);
      const stat = full && (await fs.stat(full).catch(() => null));
      if (!stat) return null;
      const deletedAt = Number(id.split("__")[0]);
      const from = originalPath(id);
      const name = from.split("/").at(-1);
      const base = {
        id,
        name,
        from: from.includes("/") ? from.split("/").slice(0, -1).join("/") : "",
        deletedAt,
        expiresAt: deletedAt + TRASH_MAX_AGE_MS,
      };
      if (stat.isDirectory()) return { ...base, kind: "folder", ...(await folderSize(full)) };
      return { ...base, kind: kindOf(name), size: stat.size, key: fileKey(stat) };
    })
  );
  return items.filter(Boolean).sort((a, b) => b.deletedAt - a.deletedAt);
}

// "Delete forever": removes items from the bin for good.
export async function purgeFromBin(ids) {
  let removed = 0;
  for (const id of ids) {
    const full = trashPath(id);
    if (!full) continue;
    await fs.rm(full, { recursive: true, force: true });
    removed++;
  }
  return removed;
}
