import { promises as fs } from "node:fs";
import path from "node:path";
import { backupStatus } from "@/lib/backup";
import { MEDIA_DIR, diskSpace } from "@/lib/media";
import { notifyAll } from "@/lib/storage-alerts";
import { storageLevel } from "@/lib/storage-levels";

// Backup health (research: reports/Photo backup alerts and best shot.md).
// Two watchers: the phone app checks GET /api/health and tells you exactly what's wrong on
// the phone (Tailscale off, PC unreachable, app not running on the PC…). The PC watches
// for the things only it can see: a phone that has gone quiet (a "dead man's switch" on the
// phone's regular check-ins), and a backup drive that hasn't been updated. One alert per
// problem, a reminder later if it's still not fixed, and a quiet "working again".
const STATE = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "health.json");
const PHONES = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "phone-sync.json");
const H = 3600 * 1000;
export const LATE_MS = 6 * H; // shown as "late" in the app
export const DOWN_MS = 24 * H; // one alert
export const REMIND_MS = 72 * H; // one reminder, then quiet until fixed

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
  await fs.writeFile(temp, JSON.stringify(data));
  await fs.rename(temp, file);
}

const quietHours = (d = new Date()) => d.getHours() >= 22 || d.getHours() < 8;

/** What the phone app asks every few minutes. */
export async function healthSnapshot() {
  const disk = await diskSpace();
  const backup = await backupStatus().catch(() => null);
  return {
    ok: true,
    at: Date.now(),
    disk: { level: storageLevel(disk), free: disk.free },
    backup: backup ? { configured: backup.configured, connected: backup.connected, level: backup.level, lastSuccessAt: backup.lastSuccessAt } : null,
  };
}

// ----- PC-side watchdog -----
export async function checkHealth(now = Date.now()) {
  const state = await readJson(STATE, { phones: {}, backupLevel: "green" });
  const phones = await readJson(PHONES, {});
  const sends = [];

  for (const [name, p] of Object.entries(phones)) {
    const s = (state.phones[name] ??= { alertedAt: 0, remindedAt: 0 });
    const quietFor = now - (p.lastSeen || 0);
    if (quietFor < LATE_MS) {
      // Checked in again: if we had alerted, say it's fine now (once).
      if (s.alertedAt) sends.push({ title: `${name} is backing up again`, body: "Everything new will reach the PC as usual.", tag: `phone-${name}`, silent: true });
      s.alertedAt = 0;
      s.remindedAt = 0;
      continue;
    }
    if (quietHours(new Date(now))) continue;
    if (!s.alertedAt && quietFor >= DOWN_MS) {
      sends.push({ title: `${name} hasn't backed up for a day`, body: "Check that Tailscale is on and the Puneet Studios app is allowed to run in the background.", tag: `phone-${name}` });
      s.alertedAt = now;
    } else if (s.alertedAt && !s.remindedAt && quietFor >= REMIND_MS) {
      sends.push({ title: `${name} still isn't backing up`, body: "It's been 3 days. Open Puneet Studios on the phone to see what's wrong.", tag: `phone-${name}` });
      s.remindedAt = now;
    }
  }

  // Backup drive going stale (amber after 7 days, red after 14): one alert per step.
  const backup = await backupStatus().catch(() => null);
  const level = backup?.configured ? backup.level : "green";
  const rank = { green: 0, amber: 1, red: 2 };
  if (rank[level] > rank[state.backupLevel ?? "green"] && !quietHours(new Date(now))) {
    sends.push({
      title: level === "red" ? "Backup drive is 2 weeks out of date" : "Backup drive hasn't been updated for a week",
      body: "Plug the backup drive into the studio PC; it updates by itself.",
      tag: "backup-drive",
    });
    state.backupLevel = level;
  } else if (rank[level] < rank[state.backupLevel ?? "green"]) {
    state.backupLevel = level;
  }

  for (const msg of sends) await notifyAll({ ...msg, url: "/settings" }).catch(() => {});
  state.checkedAt = now;
  state.lastSent = sends.map((m) => m.title);
  await writeJson(STATE, state);
  return { sent: sends.map((m) => m.title) };
}

export function startHealthWatch() {
  if (globalThis.__psHealthWatch) return;
  globalThis.__psHealthWatch = true;
  setTimeout(() => checkHealth().catch(() => {}), 60 * 1000);
  setInterval(() => checkHealth().catch(() => {}), 15 * 60 * 1000);
}
