import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { MEDIA_DIR } from "@/lib/media";

// Second copy of the whole library on an external drive (research: reports/Photo backup
// alerts and best shot.md). Rules:
//  - Never a mirror: new files are copied; anything deleted or changed in the library is
//    moved into versions/YYYY-MM-DD/ on the drive and kept for 30 days (not destroyed).
//  - Every copied file is checked byte for byte (SHA-256 of the copy = SHA-256 of the
//    original) before it counts as backed up. About 1/30 of the backup is re-checked every
//    day, so the whole drive is verified monthly (catches a failing drive).
//  - A safety brake stops a run that would retire a large share of the backup (e.g. the
//    library folder went missing) until you confirm.
//  - The drive is recognised by an ID file on it, never by its drive letter.
//  - Originals are only read. Files still arriving (changed in the last minute) wait.
const run = promisify(execFile);
const CONFIG = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "backup.json");
const ROOT_DIR = "PSBackup";
const MARKER = ".puneet-backup-id.json";
const SKIP_DIRS = new Set([".thumbs", ".trash", ".uploads", ".renditions", ".ai-models"]);
const SKIP_META = new Set(["faces"]); // regenerable caches inside .meta
const STABLE_MS = 60 * 1000;
const DAY = 24 * 3600 * 1000;

const G = (globalThis.__psBackup ??= { running: false, progress: null, drives: [], drivesAt: 0, lastCheck: 0 });

// ----- Settings -----
async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 1));
  await fs.rename(temp, file);
}
const DEFAULTS = { driveId: null, retentionDays: 30, lastSuccessAt: 0, lastRun: null, pendingConfirm: null, warnings: [] };
export const readConfig = async () => ({ ...DEFAULTS, ...(await readJson(CONFIG, {})) });
const saveConfig = (c) => writeJson(CONFIG, c);

// ----- Drives -----
// Windows drives with a letter (USB sticks, external disks, other internal disks), plus a
// test folder when PS_BACKUP_TEST_ROOT is set (used by the automatic tests).
export async function listDrives({ fresh = false } = {}) {
  if (!fresh && Date.now() - G.drivesAt < 20000) return G.drives;
  let drives = [];
  try {
    const { stdout } = await run(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -ne 'CD-ROM' } | Select-Object DriveLetter,FileSystemLabel,FileSystem,DriveType,Size,SizeRemaining,UniqueId | ConvertTo-Json -Compress"],
      { windowsHide: true, timeout: 20000 }
    );
    const raw = JSON.parse(stdout || "[]");
    drives = (Array.isArray(raw) ? raw : [raw]).map((v) => ({
      root: `${v.DriveLetter}:\\`,
      letter: v.DriveLetter,
      label: v.FileSystemLabel || "",
      fs: v.FileSystem || "",
      type: v.DriveType,
      size: Number(v.Size) || 0,
      free: Number(v.SizeRemaining) || 0,
      volumeId: v.UniqueId || "",
    }));
  } catch {}
  // Automatic tests point a folder at a pretend drive via this file (removed after the test).
  const test = process.env.PS_BACKUP_TEST_ROOT || (await fs.readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), ".backup-test-root"), "utf8").catch(() => "")).trim();
  if (test) {
    await fs.mkdir(test, { recursive: true }).catch(() => {});
    const st = await fs.statfs(test).catch(() => null);
    drives.push({ root: test, letter: "T", label: "Test drive", fs: "NTFS", type: "Test", size: st ? st.blocks * st.bsize : 0, free: st ? st.bavail * st.bsize : 0, volumeId: "test" });
  }
  // Which of them is set up as a Puneet Studios backup (and which one is ours)?
  for (const d of drives) {
    const marker = await readJson(path.join(d.root, ROOT_DIR, MARKER), null);
    d.backupId = marker?.id ?? null;
  }
  G.drives = drives.filter((d) => d.type === "Test" || d.letter?.toUpperCase() !== "C"); // never onto the PC's own system disk
  G.drivesAt = Date.now();
  return G.drives;
}

async function ourDrive(config) {
  if (!config.driveId) return null;
  return (await listDrives({ fresh: true })).find((d) => d.backupId === config.driveId) ?? null;
}

/** Use this drive for backups: writes the ID file and a README. Nothing else on it is touched. */
export async function setupDrive(root) {
  const drive = (await listDrives({ fresh: true })).find((d) => d.root === root);
  if (!drive) throw new Error("That drive isn't connected");
  const base = path.join(drive.root, ROOT_DIR);
  await fs.mkdir(path.join(base, "current"), { recursive: true });
  const existing = await readJson(path.join(base, MARKER), null);
  const id = existing?.id ?? crypto.randomBytes(8).toString("hex");
  await writeJson(path.join(base, MARKER), { id, createdAt: existing?.createdAt ?? Date.now(), volumeId: drive.volumeId, app: "Puneet Studios" });
  await fs.writeFile(
    path.join(base, "README.txt"),
    [
      "Puneet Studios backup",
      "",
      "current\\   = an exact copy of your photo library (open it like any folder).",
      "versions\\  = files that were deleted or changed in the library, kept for a while by date.",
      ".backup\\   = the list of every file with its SHA-256 fingerprint.",
      "",
      "To restore: copy files from current\\ (or a dated versions\\ folder) back into",
      "Desktop\\Phone Media on the PC. Nothing here needs the app to be read.",
      "",
    ].join("\r\n")
  );
  const config = await readConfig();
  config.driveId = id;
  config.driveLabel = drive.label || drive.letter;
  config.warnings = [];
  await saveConfig(config);
  G.drivesAt = 0;
  return { id };
}

// ----- Library walk -----
async function libraryFiles() {
  const out = [];
  async function walk(dir, rel, inMeta) {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.endsWith(".uploading") || e.name.endsWith(".tmp")) continue;
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!rel && SKIP_DIRS.has(e.name)) continue;
        if (inMeta && SKIP_META.has(e.name)) continue;
        await walk(full, r, inMeta || (!rel && e.name === ".meta"));
      } else if (e.isFile()) {
        const st = await fs.stat(full).catch(() => null);
        if (st) out.push({ rel: r, full, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      }
    }
  }
  await walk(path.resolve(/*turbopackIgnore: true*/ MEDIA_DIR), "", false);
  // The library's own records (.meta) first, then the photos (as the research advises).
  return out.sort((a, b) => Number(b.rel.startsWith(".meta/")) - Number(a.rel.startsWith(".meta/")));
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

const today = () => new Date().toLocaleDateString("en-CA");
const toFs = (base, rel) => path.join(base, ...rel.split("/"));

// Move a backed-up file out of current\ into today's versions\ folder (kept, not deleted).
async function retire(base, rel) {
  const from = toFs(path.join(base, "current"), rel);
  const to = toFs(path.join(base, "versions", today()), rel);
  await fs.mkdir(path.dirname(to), { recursive: true });
  let target = to;
  for (let n = 1; await fs.stat(target).catch(() => null); n++) target = `${to}.${n}`;
  await fs.rename(from, target).catch(() => {});
}

// The copy pipeline for one file: temp file + hash, flush, re-read and compare, keep the
// original's modified time, set any older copy aside, then put it in place.
async function copyOne(base, file) {
  const target = toFs(path.join(base, "current"), file.rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomBytes(4).toString("hex")}.partial`);
  const hash = crypto.createHash("sha256");
  const out = await fs.open(partial, "w");
  try {
    for await (const chunk of createReadStream(file.full, { highWaterMark: 1024 * 1024 })) {
      hash.update(chunk);
      await out.write(chunk);
    }
    await out.sync();
  } finally {
    await out.close();
  }
  const sourceSha = hash.digest("hex");
  const copySha = await sha256(partial);
  if (copySha !== sourceSha) {
    await fs.rm(partial, { force: true });
    throw new Error(`Copy didn't match the original: ${file.rel}`);
  }
  const t = new Date(file.mtimeMs);
  await fs.utimes(partial, t, t);
  if (await fs.stat(target).catch(() => null)) await retire(base, file.rel);
  await fs.rename(partial, target);
  return sourceSha;
}

// ----- One backup run -----
// `fullCheck`: re-check every file on the drive now instead of the daily 1/30 slice.
export async function backupNow({ confirmLargeRemoval = false, fullCheck = false } = {}) {
  if (G.running) return { busy: true };
  G.running = true;
  const config = await readConfig();
  const result = { at: Date.now(), copied: 0, bytes: 0, retired: 0, changed: 0, verified: 0, errors: [], skippedArriving: 0 };
  try {
    const drive = await ourDrive(config);
    if (!drive) return { error: config.driveId ? "Backup drive not connected" : "No backup drive set up yet" };
    const base = path.join(drive.root, ROOT_DIR);
    const manifestFile = path.join(base, ".backup", "manifest.json");
    const manifest = await readJson(manifestFile, {});
    const files = await libraryFiles();

    // Safety brakes: the library looks missing, or this run would retire a lot of the backup.
    const known = Object.keys(manifest).length;
    const present = new Set(files.map((f) => f.rel));
    const gone = Object.keys(manifest).filter((rel) => !present.has(rel));
    const mediaFiles = files.filter((f) => !f.rel.startsWith(".")).length;
    if (known > 20 && mediaFiles === 0) {
      config.warnings = ["The photo library folder looks empty or missing, so nothing was changed on the backup."];
      await saveConfig(config);
      return { error: config.warnings[0] };
    }
    const limit = Math.max(50, Math.ceil(known * 0.05));
    if (gone.length > limit && !confirmLargeRemoval) {
      config.pendingConfirm = { count: gone.length, at: Date.now() };
      config.warnings = [`${gone.length} files are gone from the library since the last backup. Confirm before the backup sets them aside.`];
      await saveConfig(config);
      return { needsConfirm: gone.length };
    }

    // Space: refuse if the copy wouldn't fit with room to spare.
    const todo = files.filter((f) => {
      const m = manifest[f.rel];
      return !m || m.size !== f.size || m.mtimeMs !== f.mtimeMs;
    });
    const need = todo.reduce((s, f) => s + f.size, 0);
    if (need > drive.free - Math.min(10 * 1024 ** 3, drive.size * 0.05)) {
      config.warnings = [`Not enough space on the backup drive: ${Math.round(need / 1024 ** 2)} MB to copy.`];
      await saveConfig(config);
      return { error: config.warnings[0] };
    }

    G.progress = { done: 0, total: todo.length, bytes: 0, totalBytes: need, current: "" };
    let since = Date.now();
    for (const f of todo) {
      if (Date.now() - f.mtimeMs < STABLE_MS && !f.rel.startsWith(".meta/")) {
        result.skippedArriving++; // still arriving from the phone or an upload: next run
        continue;
      }
      G.progress.current = f.rel;
      try {
        if (manifest[f.rel]) result.changed++;
        const sha = await copyOne(base, f);
        manifest[f.rel] = { size: f.size, mtimeMs: f.mtimeMs, sha256: sha, backedUpAt: Date.now(), verifiedAt: Date.now() };
        result.copied++;
        result.bytes += f.size;
      } catch (error) {
        result.errors.push(String(error.message).slice(0, 200));
      }
      G.progress.done++;
      G.progress.bytes += f.size;
      if (Date.now() - since > 5000) {
        await writeJson(manifestFile, manifest);
        since = Date.now();
      }
    }

    // Files gone from the library: set aside in versions\, not deleted.
    for (const rel of gone) {
      await retire(base, rel);
      delete manifest[rel];
      result.retired++;
    }

    // Monthly check of the whole drive, a slice per run.
    const stateFile = path.join(base, ".backup", "state.json");
    const state = await readJson(stateFile, {});
    if (fullCheck || Date.now() - (state.scrubAt ?? 0) > DAY) {
      result.verified = await scrub(base, manifest, fullCheck);
      result.damaged = G.lastDamaged;
      state.scrubAt = Date.now();
      await writeJson(stateFile, state);
    }
    await purgeVersions(base, config.retentionDays);
    await writeJson(manifestFile, manifest);

    // Anything the check found damaged is copied again straight away.
    if (result.damaged) {
      for (const f of files) {
        if (manifest[f.rel]?.size !== -1) continue;
        try {
          manifest[f.rel] = { size: f.size, mtimeMs: f.mtimeMs, sha256: await copyOne(base, f), backedUpAt: Date.now(), verifiedAt: Date.now() };
          result.repaired = (result.repaired ?? 0) + 1;
        } catch (error) {
          result.errors.push(String(error.message).slice(0, 200));
        }
      }
    }
    config.lastRun = result;
    config.pendingConfirm = null;
    if (!result.errors.length) {
      config.lastSuccessAt = result.at;
      config.warnings = result.changed ? [`${result.changed} original file(s) changed since they were backed up; the earlier copies are kept in versions.`] : [];
    } else {
      config.warnings = [`${result.errors.length} file(s) couldn't be backed up this time: ${result.errors[0]}`];
    }
    config.totalFiles = Object.keys(manifest).length;
    config.totalBytes = Object.values(manifest).reduce((s, m) => s + m.size, 0);
    await saveConfig(config);
    return result;
  } finally {
    G.running = false;
    G.progress = null;
  }
}

// Re-hash the files checked longest ago, up to 1/30 of the backup's size per day.
async function scrub(base, manifest, everything = false) {
  const entries = Object.entries(manifest);
  const total = entries.reduce((s, [, m]) => s + m.size, 0);
  let budget = everything ? Infinity : Math.max(total / 30, 50 * 1024 ** 2);
  let checked = 0;
  let damaged = 0;
  for (const [rel, m] of entries.sort((a, b) => a[1].verifiedAt - b[1].verifiedAt)) {
    if (budget <= 0) break;
    const file = toFs(path.join(base, "current"), rel);
    const sha = await sha256(file).catch(() => null);
    budget -= m.size;
    if (sha === m.sha256) m.verifiedAt = Date.now();
    else {
      m.size = -1; // damaged or missing on the drive: copied again from the library next run
      damaged++;
    }
    checked++;
  }
  G.lastDamaged = damaged;
  return checked;
}

async function purgeVersions(base, days) {
  const dir = path.join(base, "versions");
  for (const name of await fs.readdir(dir).catch(() => [])) {
    const t = Date.parse(`${name}T00:00:00`);
    if (Number.isFinite(t) && Date.now() - t > days * DAY) await fs.rm(path.join(dir, name), { recursive: true, force: true });
  }
}

// ----- Status for the app -----
export async function backupStatus() {
  const config = await readConfig();
  const drives = await listDrives();
  const drive = config.driveId ? drives.find((d) => d.backupId === config.driveId) : null;
  const age = config.lastSuccessAt ? Date.now() - config.lastSuccessAt : Infinity;
  const level = !config.driveId ? "none" : age > 14 * DAY ? "red" : age > 7 * DAY ? "amber" : "green";
  return {
    configured: Boolean(config.driveId),
    connected: Boolean(drive),
    drive: drive ? { root: drive.root, label: drive.label, free: drive.free, size: drive.size, fs: drive.fs } : config.driveId ? { label: config.driveLabel } : null,
    lastSuccessAt: config.lastSuccessAt,
    lastRun: config.lastRun,
    totalFiles: config.totalFiles ?? 0,
    totalBytes: config.totalBytes ?? 0,
    retentionDays: config.retentionDays,
    warnings: config.warnings ?? [],
    pendingConfirm: config.pendingConfirm,
    level,
    running: G.running,
    progress: G.progress,
    drives: drives.map((d) => ({ root: d.root, label: d.label, fs: d.fs, size: d.size, free: d.free, type: d.type, isBackup: Boolean(d.backupId) })),
  };
}

export async function setRetention(days) {
  const config = await readConfig();
  if ([7, 30, 90, 365].includes(days)) config.retentionDays = days;
  await saveConfig(config);
}

// ----- Background: back up when the drive is plugged in, then every 10 minutes -----
export function startBackupWorker() {
  if (G.worker) return;
  G.worker = true;
  let wasConnected = false;
  setInterval(async () => {
    try {
      const config = await readConfig();
      if (!config.driveId || G.running) return;
      const drive = await ourDrive(config);
      const connected = Boolean(drive);
      const due = Date.now() - (config.lastRun?.at ?? 0) > 10 * 60 * 1000;
      if (connected && (!wasConnected || due) && !config.pendingConfirm) await backupNow();
      wasConnected = connected;
    } catch {}
  }, 30 * 1000);
}
