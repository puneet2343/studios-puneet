import { promises as fs } from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { MEDIA_DIR, diskSpace } from "@/lib/media";
import { formatSize } from "@/lib/format";
import { storageLevel } from "@/lib/storage-levels";
import { purgeRenditions } from "@/lib/renditions";

// Phone notifications when the studio PC's disk runs low. Phones subscribe from the
// app (More → Storage); the PC checks its disk every 10 minutes and notifies once per
// step down (low, then critical), and again only after space has been freed.
const STORE = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "push.json");
const CHECK_EVERY_MS = 10 * 60 * 1000;
const RANK = { ok: 0, low: 1, critical: 2 };

async function readStore() {
  try {
    return JSON.parse(await fs.readFile(STORE, "utf8"));
  } catch {
    return {};
  }
}

async function writeStore(data) {
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  const temp = `${STORE}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 1));
  await fs.rename(temp, STORE);
}

// The PC's push identity (VAPID keys), made once and kept with the library.
async function setup() {
  const store = await readStore();
  if (!store.vapid) {
    store.vapid = webpush.generateVAPIDKeys();
    store.subscriptions ??= [];
    await writeStore(store);
  }
  webpush.setVapidDetails("mailto:studio@puneet.studios", store.vapid.publicKey, store.vapid.privateKey);
  return store;
}

export async function publicKey() {
  return (await setup()).vapid.publicKey;
}

export async function isSubscribed(endpoint) {
  const store = await readStore();
  return Boolean(endpoint && store.subscriptions?.some((s) => s.endpoint === endpoint));
}

export async function subscribe(subscription) {
  if (!subscription?.endpoint?.startsWith("https://") || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error("Invalid subscription");
  }
  const store = await setup();
  store.subscriptions = [...store.subscriptions.filter((s) => s.endpoint !== subscription.endpoint), { ...subscription, added: Date.now() }];
  await writeStore(store);
}

export async function unsubscribe(endpoint) {
  const store = await setup();
  store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== endpoint);
  await writeStore(store);
}

// Sends to every subscribed phone; phones that uninstalled the app are forgotten.
export async function notifyAll(payload) {
  const store = await setup();
  const gone = new Set();
  let sent = 0;
  await Promise.all(
    store.subscriptions.map((s) =>
      webpush
        .sendNotification(s, JSON.stringify(payload), { TTL: 24 * 3600, urgency: "high" })
        .then(() => sent++)
        .catch((error) => {
          if (error.statusCode === 404 || error.statusCode === 410) gone.add(s.endpoint);
        })
    )
  );
  if (gone.size) {
    store.subscriptions = store.subscriptions.filter((s) => !gone.has(s.endpoint));
    await writeStore(store);
  }
  return sent;
}

export function alertText(level, disk) {
  const free = formatSize(disk.free);
  return level === "critical"
    ? { title: "Studio PC is almost full", body: `Only ${free} left. New uploads may fail — clear the Recycle Bin or remove duplicates.` }
    : { title: "Studio PC is running low on space", body: `${free} left of ${formatSize(disk.total)}. Time to tidy up or move old projects off.` };
}

export async function checkStorage() {
  // Playback copies can always be made again: drop old ones, or all of them when space is short.
  await purgeRenditions({ all: storageLevel(await diskSpace()) !== "ok" }).catch(() => {});
  const disk = await diskSpace();
  const level = storageLevel(disk);
  const store = await setup();
  const last = store.lastLevel ?? "ok";
  if (RANK[level] > RANK[last]) {
    await notifyAll({ ...alertText(level, disk), url: "/", tag: "storage" });
  }
  if (level !== last) {
    store.lastLevel = level;
    await writeStore(store);
  }
  return { ...disk, level };
}

// Started once per server by instrumentation.js.
export function startMonitor() {
  if (globalThis.__psStorageMonitor) return;
  globalThis.__psStorageMonitor = setInterval(() => checkStorage().catch(() => {}), CHECK_EVERY_MS);
  globalThis.__psStorageMonitor.unref?.();
  setTimeout(() => checkStorage().catch(() => {}), 15000).unref?.();
}
