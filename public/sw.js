// Lets the installed app open even when the studio PC is off or unreachable.
// Pages: network first, falling back to the last copy. Build assets: cache first
// (their names change every build). API calls and media are never touched.
const PAGES = "ps-pages-v1";
const ASSETS = "ps-assets-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(page(request));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(asset(request));
  }
});

// Weak signal can leave a request hanging for a minute; after 4 s use the saved copy.
function fetchSoon(request, ms = 4000) {
  return Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function page(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetchSoon(request);
    // Tailscale answers 502 when the app isn't running; treat that as offline too.
    if (response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    const cached = (await cache.match(request)) || (await cache.match("/"));
    if (cached) return cached;
    throw error;
  }
}

async function asset(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// The app asks (after each load, with signal) to keep every main page ready for offline:
// the page itself plus the scripts and styles it needs — so even right after an update,
// a page you haven't visited yet opens with no signal.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "warm" || !Array.isArray(event.data.paths)) return;
  event.waitUntil(warm(event.data.paths));
});

async function warm(paths) {
  const pages = await caches.open(PAGES);
  const assets = await caches.open(ASSETS);
  const needed = new Set();
  let complete = true;
  for (const p of paths) {
    try {
      const res = await fetch(p, { credentials: "include" });
      if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) continue;
      await pages.put(p, res.clone());
      const html = await res.text();
      const urls = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
      for (const u of urls) if (!(await assets.match(u))) {
        const a = await fetch(u).catch(() => null);
        if (a?.ok) await assets.put(u, a);
      }
    } catch {
      complete = false;
    }
  }
  // Files from older versions of the app are no longer needed: remove them, so the cache
  // never grows (the PC rebuilds the app every time it changes).
  if (complete && needed.size) {
    for (const req of await assets.keys()) if (!needed.has(req.url)) await assets.delete(req);
  }
}

// Storage alerts from the studio PC (lib/storage-alerts.js).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Puneet Studios", {
      body: data.body || "",
      icon: "/icon-192.png?v=4",
      badge: "/icon-192.png?v=4",
      tag: data.tag || "puneet-studios",
      silent: Boolean(data.silent), // "working again" messages don't make a sound
      renotify: !data.silent,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    })
  );
});
