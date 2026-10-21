import crypto from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MEDIA_DIR, cleanName } from "@/lib/media";

// Trip Planner storage: one JSON document per trip in .trips/<id>.json, plus attached
// tickets/receipts in .trips/<id>/files/. The phone edits a trip and saves the whole
// document; `rev` goes up on every save so two devices can't silently overwrite each other.
const ROOT = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".trips");
const DELETED = path.join(ROOT, ".deleted");
const MAX_FILE = 50 * 1024 * 1024;

export class PlanError extends Error {
  constructor(message, status, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const validId = (id) => typeof id === "string" && /^[a-z0-9]{6,40}$/.test(id);
const newId = () => crypto.randomBytes(6).toString("hex");
const docPath = (id) => path.join(ROOT, `${id}.json`);
const filesDir = (id) => path.join(ROOT, id, "files");

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data));
  await fs.rename(temp, file);
}

const str = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// Keeps only known fields with sane types, so a bad save can't corrupt a trip.
function clean(trip) {
  const t = trip ?? {};
  return {
    name: str(t.name, 120) || "Untitled trip",
    destination: str(t.destination, 160),
    startDate: date(t.startDate),
    endDate: date(t.endDate),
    currency: /^[A-Z]{3}$/.test(t.currency) ? t.currency : "INR",
    budget: num(t.budget),
    travellers: (Array.isArray(t.travellers) ? t.travellers : []).slice(0, 30).map((p) => ({ id: str(p.id, 40), name: str(p.name, 60) })),
    mediaFolder: typeof t.mediaFolder === "string" ? t.mediaFolder.slice(0, 400) : null,
    cover: t.cover && typeof t.cover.path === "string" ? { path: t.cover.path.slice(0, 400), key: str(t.cover.key, 40) } : null,
    notes: str(t.notes, 20000),
    items: (Array.isArray(t.items) ? t.items : []).slice(0, 2000).map((i) => ({
      id: str(i.id, 40),
      type: ["transport", "stay", "activity", "food", "note"].includes(i.type) ? i.type : "activity",
      mode: str(i.mode, 20),
      title: str(i.title, 200),
      day: date(i.day),
      time: /^\d{2}:\d{2}$/.test(i.time) ? i.time : null,
      endDay: date(i.endDay),
      endTime: /^\d{2}:\d{2}$/.test(i.endTime) ? i.endTime : null,
      from: str(i.from, 160),
      to: str(i.to, 160),
      location: str(i.location, 300),
      provider: str(i.provider, 120),
      ref: str(i.ref, 80),
      seat: str(i.seat, 60),
      cost: num(i.cost),
      status: ["idea", "tobook", "booked", "cancelled"].includes(i.status) ? i.status : "tobook",
      paid: Boolean(i.paid),
      done: Boolean(i.done),
      link: str(i.link, 500),
      notes: str(i.notes, 4000),
      files: (Array.isArray(i.files) ? i.files : []).slice(0, 30).map((f) => str(f, 40)),
    })),
    expenses: (Array.isArray(t.expenses) ? t.expenses : []).slice(0, 5000).map((e) => ({
      id: str(e.id, 40),
      title: str(e.title, 200),
      amount: num(e.amount) ?? 0,
      category: str(e.category, 30) || "other",
      date: date(e.date),
      paidBy: str(e.paidBy, 40),
      splitWith: (Array.isArray(e.splitWith) ? e.splitWith : []).slice(0, 30).map((x) => str(x, 40)),
      method: ["upi", "cash", "card", "other"].includes(e.method) ? e.method : "upi",
      itemId: str(e.itemId, 40) || null,
      notes: str(e.notes, 2000),
      receipt: str(e.receipt, 40) || null,
    })),
    checklist: (Array.isArray(t.checklist) ? t.checklist : []).slice(0, 1000).map((c) => ({
      id: str(c.id, 40),
      text: str(c.text, 200),
      group: str(c.group, 40) || "Packing",
      done: Boolean(c.done),
    })),
    files: (Array.isArray(t.files) ? t.files : []).slice(0, 500).map((f) => ({
      id: str(f.id, 40),
      name: str(f.name, 200),
      size: num(f.size) ?? 0,
      type: str(f.type, 100),
      addedAt: num(f.addedAt) ?? Date.now(),
    })),
  };
}

// Trip cards: just what the list needs.
function summary(id, t) {
  const planned = t.items.filter((i) => i.status !== "cancelled" && i.cost).reduce((s, i) => s + i.cost, 0);
  const spent = t.expenses.reduce((s, e) => s + e.amount, 0);
  return {
    id,
    rev: t.rev,
    name: t.name,
    destination: t.destination,
    startDate: t.startDate,
    endDate: t.endDate,
    currency: t.currency,
    budget: t.budget,
    planned,
    spent,
    cover: t.cover,
    travellers: t.travellers.length,
    items: t.items.length,
    toBook: t.items.filter((i) => i.status === "tobook" && (i.type === "transport" || i.type === "stay")).length,
    checklist: [t.checklist.filter((c) => c.done).length, t.checklist.length],
    updatedAt: t.updatedAt,
  };
}

export async function listPlans() {
  const names = await fs.readdir(ROOT).catch(() => []);
  const trips = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    const doc = await readJson(docPath(id));
    if (doc) trips.push(summary(id, doc));
  }
  return trips.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? "") || b.updatedAt - a.updatedAt);
}

export async function getPlan(id) {
  if (!validId(id)) throw new PlanError("Trip not found", 404);
  const doc = await readJson(docPath(id));
  if (!doc) throw new PlanError("Trip not found", 404);
  return { id, ...doc };
}

export async function createPlan(data) {
  const id = newId();
  const doc = { ...clean(data), rev: 1, createdAt: Date.now(), updatedAt: Date.now() };
  await writeJson(docPath(id), doc);
  return { id, ...doc };
}

// Saves a whole trip. `rev` must match the PC's copy; otherwise the newer copy is
// returned so the phone can take it instead of overwriting someone else's edits.
export async function savePlan(id, data, rev) {
  const current = await getPlan(id);
  if (rev !== current.rev) throw new PlanError("This trip was changed on another device", 409, { trip: current });
  const doc = { ...clean(data), rev: current.rev + 1, createdAt: current.createdAt, updatedAt: Date.now() };
  await writeJson(docPath(id), doc);
  return { id, ...doc };
}

// Deleted trips are kept for 3 days so Undo works.
export async function deletePlan(id) {
  await getPlan(id);
  await fs.mkdir(DELETED, { recursive: true });
  const stamp = Date.now();
  await fs.rename(docPath(id), path.join(DELETED, `${stamp}-${id}.json`));
  await fs.rename(path.join(ROOT, id), path.join(DELETED, `${stamp}-${id}`)).catch(() => {});
  return { undo: `${stamp}-${id}` };
}

export async function restorePlan(undo) {
  if (typeof undo !== "string" || !/^\d+-[a-z0-9]{6,40}$/.test(undo)) throw new PlanError("Nothing to restore", 400);
  const id = undo.split("-").slice(1).join("-");
  await fs.rename(path.join(DELETED, `${undo}.json`), docPath(id));
  await fs.rename(path.join(DELETED, undo), path.join(ROOT, id)).catch(() => {});
  return getPlan(id);
}

export async function purgeDeletedPlans() {
  for (const name of await fs.readdir(DELETED).catch(() => [])) {
    if (Date.now() - Number(name.split("-")[0]) > 3 * 24 * 3600 * 1000) await fs.rm(path.join(DELETED, name), { recursive: true, force: true });
  }
}

// ----- Attached tickets, booking PDFs, receipts -----
export async function addPlanFile(id, name, type, body, size) {
  await getPlan(id);
  const safe = cleanName(name) || "file";
  if (size > MAX_FILE) throw new PlanError("Attachments can be up to 50 MB", 413);
  const fileId = newId();
  const dir = filesDir(id);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${fileId}-${safe}`);
  await pipeline(Readable.fromWeb(body), createWriteStream(target));
  const stat = await fs.stat(target);
  if (stat.size > MAX_FILE) {
    await fs.rm(target, { force: true });
    throw new PlanError("Attachments can be up to 50 MB", 413);
  }
  return { id: fileId, name: safe, size: stat.size, type: str(type, 100) || "application/octet-stream", addedAt: Date.now() };
}

async function findFile(id, fileId) {
  if (!validId(id) || !validId(fileId)) return null;
  const names = await fs.readdir(filesDir(id)).catch(() => []);
  const name = names.find((n) => n.startsWith(`${fileId}-`));
  return name ? path.join(filesDir(id), name) : null;
}

export async function openPlanFile(id, fileId) {
  const full = await findFile(id, fileId);
  if (!full) throw new PlanError("File not found", 404);
  const stat = await fs.stat(full);
  return { full, size: stat.size, name: path.basename(full).replace(/^[a-z0-9]+-/, ""), stream: () => createReadStream(full) };
}

export async function removePlanFile(id, fileId) {
  const full = await findFile(id, fileId);
  if (full) await fs.rm(full, { force: true });
}
