import { promises as fs } from "node:fs";
import path from "node:path";
import { MEDIA_DIR, cleanName, fileKey, freeName, kindOf, relPath, renameFile, resolveDir, resolveName } from "@/lib/media";
import { dateFromFile, dateFromName } from "@/lib/library";
import { openUpload } from "@/lib/uploads";
import { findSame, isHash, remember, sha256File } from "@/lib/hashes";
import { tripFor } from "@/lib/trips";

// Phone Sync: the Puneet Studios Android app (android/) uploads every new photo and
// video from the phone by itself, byte for byte. Files land in "Phone Sync/<phone>/<album>/",
// e.g. "Phone Sync/Galaxy S24/Camera/IMG_2026.jpg", or straight into a trip's album when
// they were taken during that trip. The pieces themselves go through the
// normal resumable upload (lib/uploads.js); this file only picks the place, skips
// what's already here, and remembers each phone's last report for the Phone Sync page.
export const SYNC_FOLDER = "Phone Sync";
const STATUS = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "phone-sync.json");
const HISTORY = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "sync-history.jsonl");
export const APK = path.join(/*turbopackIgnore: true*/ process.cwd(), "android", "dist", "PuneetStudios.apk");

// Phone and album names come from the phone, so make them safe folder names.
function safePart(value, fallback) {
  const text = String(value ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 60);
  return cleanName(text) ?? fallback;
}

export async function startSync({ id, device, folder, name, size, taken, sha256 }) {
  if (typeof id !== "string" || !/^[a-z0-9]{8,64}$/.test(id)) return { error: "Invalid upload id" };
  if (!Number.isSafeInteger(size) || size < 0) return { error: "Invalid size" };
  // Exactly this file already on the PC (anywhere, under any name)? Then nothing to send.
  if (isHash(sha256)) {
    const same = await findSame({ sha256, name, size });
    if (same) {
      await addHistory({ device: safePart(device, "Phone"), name, size, path: relPath(same), status: "already" });
      return { skip: true, path: relPath(same) };
    }
  }
  // When was it taken? The phone usually knows; otherwise the file name often says.
  const when = Number(taken) > 0 ? Number(taken) : dateFromName(String(name ?? ""));
  const trip = when ? await tripFor(when) : null;
  const dir = trip ? trip.folder : `${SYNC_FOLDER}/${safePart(device, "Phone")}/${safePart(folder, "Other")}`;
  const file = cleanName(name) ?? safePart(name, `file-${id}`);
  const rel = `${dir}/${file}`;
  const full = resolveName(rel);
  if (!full) return { error: "Invalid file name" };
  await fs.mkdir(resolveDir(dir), { recursive: true });
  // Without a fingerprint (older app): same name and size in the same place counts as there.
  const existing = await fs.stat(full).catch(() => null);
  if (!isHash(sha256) && existing?.isFile() && existing.size === size) return { skip: true, path: rel };
  const extra = { sync: true, sha256: isHash(sha256) ? sha256 : null, device: safePart(device, "Phone"), name: String(name ?? "") };
  return { ...(await openUpload({ id, name: rel, size, extra })), path: rel };
}

async function readStatus() {
  try {
    return JSON.parse(await fs.readFile(STATUS, "utf8"));
  } catch {
    return {};
  }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function saveReport(report) {
  const device = safePart(report.device, "Phone");
  const all = await readStatus();
  all[device] = {
    device,
    synced: num(report.synced),
    pending: num(report.pending),
    lastUpload: num(report.lastUpload) || all[device]?.lastUpload || 0,
    lastName: typeof report.lastName === "string" ? report.lastName.slice(0, 200) : all[device]?.lastName ?? "",
    error: typeof report.error === "string" ? report.error.slice(0, 300) : "",
    version: typeof report.version === "string" ? report.version.slice(0, 20) : "",
    wifiOnly: Boolean(report.wifiOnly),
    lastSeen: Date.now(),
  };
  await fs.mkdir(path.dirname(STATUS), { recursive: true });
  const temp = `${STATUS}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(all));
  await fs.rename(temp, STATUS);
  return all[device];
}

// Newest synced files, for the strip on the Phone Sync page.
async function recentFiles(limit = 24) {
  const found = [];
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) found.push({ full, stat });
      }
    }
  }
  await walk(path.join(/*turbopackIgnore: true*/ MEDIA_DIR, SYNC_FOLDER));
  return {
    count: found.length,
    files: found
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, limit)
      .map(({ full, stat }) => ({
        name: path.basename(full),
        path: relPath(full),
        size: stat.size,
        modified: stat.mtimeMs,
        kind: kindOf(full),
        key: fileKey(stat),
      })),
  };
}

export async function syncOverview() {
  const [status, recent, apk] = await Promise.all([readStatus(), recentFiles(), fs.stat(APK).catch(() => null)]);
  return {
    folder: SYNC_FOLDER,
    devices: Object.values(status).sort((a, b) => b.lastSeen - a.lastSeen),
    recent: recent.files,
    total: recent.count,
    app: apk ? { size: apk.size, built: apk.mtimeMs } : null,
  };
}

// ----- After a phone upload's last piece -----
// 1. Check it arrived byte for byte (same SHA-256 as on the phone). If not, it's removed
//    and the phone sends it again. 2. If the phone didn't know when it was taken, read the
//    date from the photo and move it into the trip it belongs to. 3. Note it in the history.
export async function finishPhoneUpload(result) {
  const { extra } = result;
  if (!extra?.sync) return result;
  let full = resolveName(result.path);
  const sha = await sha256File(full);
  if (extra.sha256 && sha !== extra.sha256) {
    await fs.rm(full, { force: true });
    await addHistory({ device: extra.device, name: extra.name, size: 0, path: result.path, status: "corrupt" });
    return { ...result, done: false, corrupt: true, offset: 0 };
  }
  await remember(full, sha).catch(() => {});
  if (result.path.startsWith(`${SYNC_FOLDER}/`)) {
    const when = await dateFromFile(full, kindOf(full)).catch(() => null);
    const trip = when ? await tripFor(when) : null;
    if (trip) {
      const dir = resolveDir(trip.folder);
      await fs.mkdir(dir, { recursive: true });
      const to = path.join(dir, await freeName(path.basename(full), dir));
      if (await renameFile(full, to).then(() => true, () => false)) full = to;
    }
  }
  const stat = await fs.stat(full);
  await addHistory({ device: extra.device, name: extra.name, size: stat.size, path: relPath(full), status: "uploaded", sha256: sha });
  return { ...result, path: relPath(full), verified: Boolean(extra.sha256) };
}

// ----- Backup history: one line per file the phones sent (or found already on the PC) -----
async function addHistory(entry) {
  await fs.mkdir(path.dirname(HISTORY), { recursive: true });
  await fs.appendFile(HISTORY, JSON.stringify({ at: Date.now(), ...entry }) + "\n");
}

export async function readHistory({ limit = 200, before = Infinity } = {}) {
  let text = "";
  try {
    text = await fs.readFile(HISTORY, "utf8");
  } catch {}
  const all = text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const totals = { uploaded: 0, already: 0, corrupt: 0, bytes: 0 };
  for (const e of all) {
    totals[e.status] = (totals[e.status] ?? 0) + 1;
    if (e.status === "uploaded") totals.bytes += e.size || 0;
  }
  const older = all.filter((e) => e.at < before);
  return { entries: older.reverse().slice(0, limit), totals, more: older.length > limit };
}
