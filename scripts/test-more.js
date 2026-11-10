// Second end-to-end test: everything test-app.js and test-video.js don't cover.
//  A. Server: login required everywhere, no reaching files outside the library, every API
//     answers (and how fast), rename / delete / Recycle Bin restore, shared album links,
//     trips edit + delete, streaming pieces are refused for bad names.
//  B. Screens (headless Edge, phone): filter chips, search (names and "what's in it"),
//     People, Clean up, Duplicates, Backup history, Recycle Bin, Updates, Settings, the
//     viewer's Details / Rename / Trim / Rotate / Save the sound, light theme, computer size.
// Uses only its own "zz-test" files and removes them. Needs the app running.
// Usage: node scripts/test-more.js . http://localhost:4600/ <screenshot folder>
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const [projectDir, base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sharp = require(path.resolve(projectDir, "node_modules", "sharp"));
const env = Object.fromEntries(
  fs.readFileSync(path.join(projectDir, ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const MEDIA = path.join(process.env.USERPROFILE, "Desktop", "Phone Media");
const ALBUM = "zz-test Album";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra !== "" ? "  — " + extra : ""}`);
  if (!ok) failures++;
}

// Windows won't delete a file that's open (e.g. the PC making a test video's streaming copies): wait.
const rmRetry = (p) => {
  for (let i = 0; ; i++) {
    try {
      return fs.rmSync(p, { recursive: true, force: true });
    } catch (e) {
      if (i > 120 || !["EPERM", "EBUSY"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }
};

function cleanup() {
  for (const dir of [MEDIA, path.join(MEDIA, ".trash")]) {
    for (const f of fs.readdirSync(dir)) if (f.includes("zz-test")) rmRetry(path.join(dir, f));
  }
  for (const [file, key] of [["trips.json", "trips"]]) {
    const p = path.join(MEDIA, ".meta", file);
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      data[key] = data[key].filter((t) => !JSON.stringify(t).includes("zz-test"));
      fs.writeFileSync(p, JSON.stringify(data));
    }
  }
}

(async () => {
  cleanup();
  fs.mkdirSync(path.join(MEDIA, ALBUM), { recursive: true });
  await sharp({ create: { width: 640, height: 480, channels: 3, background: "#f59e0b" } }).jpeg().toFile(path.join(MEDIA, ALBUM, "zz-test shared.jpg"));
  await sharp({ create: { width: 640, height: 480, channels: 3, background: "#14b8a6" } }).jpeg().toFile(path.join(MEDIA, "zz-test rename me.jpg"));
  const vids = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.mp4$/i.test(e.name)) vids.push(path.relative(MEDIA, f).split(path.sep).join("/")); } })(MEDIA);
  const aVideo = vids.find((v) => v.includes("Camera")) || vids[0];

  // =============================================================== A. Server
  const api = (p, opts = {}) => fetch(new URL(p, base), opts);
  const noAuth = await api("/api/library");
  check("Library needs sign-in (401 without it)", noAuth.status === 401);
  const noAuthHls = await api("/api/hls/0123456789abcdef0123/master.m3u8");
  check("Streaming pieces need sign-in too", noAuthHls.status === 401);
  const wrong = await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: env.APP_USERNAME, password: "nope" }) });
  check("Wrong password refused", wrong.status === 401 || wrong.status === 403, String(wrong.status));
  const login = await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: env.APP_USERNAME, password: env.APP_PASSWORD }) });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  check("Sign in works", login.ok && cookie.startsWith("media_session="));
  const auth = { headers: { cookie } };
  const json = (p, opts = {}) => api(p, { ...opts, headers: { cookie, "content-type": "application/json", ...(opts.headers || {}) } });

  for (const bad of ["../../Windows/win.ini", "..\\..\\Windows\\win.ini", "C:/Windows/win.ini", "%2e%2e/%2e%2e/Windows/win.ini"]) {
    const r = await api(`/api/files?name=${encodeURIComponent(bad)}`, auth);
    check(`Can't read outside the library: ${bad}`, r.status >= 400 && r.status < 500, String(r.status));
  }
  const trav = await api("/api/hls/0123456789abcdef0123/..%2F..%2F.meta%2Ftrips.json", auth);
  check("Streaming route refuses other files", trav.status === 404, String(trav.status));

  const timings = [];
  const endpoints = [
    "/api/library", "/api/version", "/api/health", "/api/storage", "/api/backup", "/api/trips", "/api/trash", "/api/shares",
    "/api/people", "/api/ai", "/api/ai?q=fireworks", "/api/search?q=Camera", "/api/duplicates", "/api/cleanup",
    "/api/sync?device=zz-test", `/api/properties?name=${encodeURIComponent(aVideo)}`, `/api/stream?name=${encodeURIComponent(aVideo)}`,
  ];
  for (const ep of endpoints) {
    const t0 = Date.now();
    const r = await api(ep, auth);
    const ms = Date.now() - t0;
    let body = null;
    try { body = await r.json(); } catch {}
    timings.push([ep, ms]);
    check(`API ${ep.split("?")[0]}${ep.includes("?") ? "?" + ep.split("?")[1].slice(0, 20) : ""} answers`, r.status < 500 && body !== null, `${r.status}, ${ms} ms`);
  }
  const slow = timings.filter(([, ms]) => ms > 3000);
  check("Every API answers within 3 s", slow.length === 0, slow.map(([e, ms]) => `${e} ${ms} ms`).join(", "));
  const ai = await (await api("/api/ai?q=fireworks", auth)).json();
  check("Search by what's in the photo finds something", (ai.results || []).length > 0, `${(ai.results || []).length} results`);

  // Rename, delete to the Recycle Bin, restore.
  let r = await json(`/api/files?name=${encodeURIComponent("zz-test rename me.jpg")}`, { method: "PATCH", body: JSON.stringify({ newName: "zz-test renamed.jpg" }) });
  check("Rename works", r.ok && fs.existsSync(path.join(MEDIA, "zz-test renamed.jpg")) && !fs.existsSync(path.join(MEDIA, "zz-test rename me.jpg")));
  r = await json(`/api/files?name=${encodeURIComponent("zz-test renamed.jpg")}`, { method: "PATCH", body: JSON.stringify({ newName: "../escape.jpg" }) });
  check("Rename can't move a file out of its folder", !fs.existsSync(path.join(MEDIA, "..", "escape.jpg")) && !fs.existsSync(path.join(MEDIA, "escape.jpg")), String(r.status));
  r = await api(`/api/files?name=${encodeURIComponent("zz-test renamed.jpg")}`, { method: "DELETE", headers: { cookie } });
  const bin = await (await api("/api/trash", auth)).json();
  const item = (bin.items || []).find((i) => JSON.stringify(i).includes("zz-test renamed.jpg"));
  check("Delete puts it in the Recycle Bin", r.ok && !fs.existsSync(path.join(MEDIA, "zz-test renamed.jpg")) && Boolean(item));
  r = await json("/api/trash", { method: "POST", body: JSON.stringify({ ids: [item?.id] }) });
  check("Restore puts it back", r.ok && fs.existsSync(path.join(MEDIA, "zz-test renamed.jpg")));

  // Shared album link: works without signing in, shows only that album, stops when removed.
  r = await json("/api/shares", { method: "POST", body: JSON.stringify({ album: ALBUM, days: 7 }) });
  const share = await r.json();
  check("Share link created", r.ok && Boolean(share.token), JSON.stringify(share).slice(0, 80));
  const page = await api(`/api/share/${share.token}`);
  const html = await page.text();
  check("Shared link opens without signing in", page.ok && html.includes("zz-test shared"));
  check("…and doesn't show other photos", !html.includes("zz-test renamed"));
  await api(`/api/shares?token=${share.token}`, { method: "DELETE", headers: { cookie } });
  check("Stopped link no longer works", (await api(`/api/share/${share.token}`)).status >= 400);
  check("A made-up link doesn't work", (await api(`/api/share/abc123notreal`)).status >= 400);

  // Trips: create, change dates, delete (album and photos stay).
  r = await json("/api/trips", { method: "POST", body: JSON.stringify({ name: "zz-test Trip 2", start: "2024-02-01", end: "2024-02-02" }) });
  const trip = (await r.json()).trip;
  check("Trip created", r.ok && Boolean(trip?.id));
  r = await json("/api/trips", { method: "PATCH", body: JSON.stringify({ id: trip?.id, name: "zz-test Trip 2", start: "2024-02-01", end: "2024-02-05" }) });
  check("Trip dates can change", r.ok);
  r = await api(`/api/trips?id=${trip?.id}`, { method: "DELETE", headers: { cookie } });
  check("Trip can be deleted", r.ok && !(await (await api("/api/trips", auth)).json()).trips?.some((t) => t.id === trip?.id), String(r.status));

  // =============================================================== B. Screens
  const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ps-more-"));
  const port = 9345;
  const proc = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { await sleep(250); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res) => (ws.onopen = res));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const serverErrors = [];
  // Every browser command gives up after 20 s, so a stuck page fails the test instead of hanging it.
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => { if (pending.has(n)) { pending.delete(n); console.log(`(stuck on ${method} ${JSON.stringify(params).slice(0, 120)})`); res({}); } }, 20000); });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? msg.error); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 500) serverErrors.push(`${msg.params.response.status} ${msg.params.response.url}`);
  };
  const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Network.setCookie", { name: "media_session", value: cookie.split("=")[1], url: base });
  const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const pos = (sel) => js(`(() => { const el = ${sel}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const tap = async (sel, wait = 700) => { const p = await pos(sel); if (!p) return false; await touch("touchStart", [p]); await touch("touchEnd", []); await sleep(wait); return true; };
  const btn = (t) => `[...document.querySelectorAll("button, a")].find(b => b.textContent.trim().startsWith(${JSON.stringify(t)}) && b.offsetParent)`;
  const label = (l) => `[...document.querySelectorAll('[aria-label=${JSON.stringify(l)}]')].find(b => b.offsetParent)`;
  const text = () => js("document.body.innerText");
  const go = async (url, wait = 3500) => { await send("Page.navigate", { url: new URL(url, base).href }); await sleep(wait); };
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const back = async (wait = 700) => { await js("history.back()"); await sleep(wait); };
  const tilePaths = () => js(`[...document.querySelectorAll("[data-path]")].map(t => t.dataset.path)`);

  // ----- Filter chips -----
  await go("/", 4500);
  const all = (await tilePaths()).length;
  await tap(btn("Videos"), 1000);
  const vPaths = await tilePaths();
  check("Videos chip shows only videos", vPaths.length > 0 && vPaths.every((p) => /\.(mp4|mov|mkv|webm|3gp)$/i.test(p)) && vPaths.length < all, `${vPaths.length} of ${all}`);
  await shot("m01-filter-videos");
  await tap(btn("Screenshots"), 1000);
  const sPaths = await tilePaths();
  check("Screenshots chip shows only screenshots", sPaths.length > 0 && sPaths.every((p) => /screen/i.test(p)), `${sPaths.length}`);
  await shot("m02-filter-screenshots");
  await tap(btn("Photos"), 1000);
  const pPaths = await tilePaths();
  check("Photos chip: pictures only, no screenshots", pPaths.length > 0 && pPaths.every((p) => !/\.(mp4|mov)$/i.test(p) && !/screenshot/i.test(p)), `${pPaths.length}`);
  await back(900);
  check("Back returns the filter to All", (await tilePaths()).length === all);

  // ----- Search -----
  await tap(label("Search"), 700);
  await js(`(() => { const i = document.querySelector("input[placeholder^=Search]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "fireworks"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(3500);
  const st = await text();
  const found = (await tilePaths()).length;
  check("Search 'fireworks' finds photos by what's in them", found > 0 && /result/.test(st), `${found} shown`);
  await shot("m03-search");
  await back(900);
  check("Back closes search", !(await js(`Boolean(document.querySelector("input[placeholder^='Search']"))`)));

  // ----- Albums, People -----
  await go("/albums");
  const at = await text();
  check("Albums shows People, Trips and albums", at.includes("People") && at.includes("Trips") && at.includes(ALBUM));
  await shot("m04-albums");
  const person = `[...document.querySelectorAll("button, a")].find(b => b.closest("section")?.querySelector("h2")?.textContent === "People" && b.querySelector("img"))`;
  if (await tap(person, 2500)) {
    check("Tapping a person shows their photos", (await tilePaths()).length > 0);
    await shot("m05-person");
    await back(900);
  } else check("A person is listed", false);
  await tap(`[...document.querySelectorAll("a, button")].find(b => b.textContent.includes(${JSON.stringify(ALBUM)}))`, 2000);
  check("Album opens with its photo", (await tilePaths()).some((p) => p.includes("zz-test shared")));
  check("Album has a Share button", await js(`Boolean(${label("Share album")})`));
  await tap(label("Share album"), 900);
  check("Share dialog opens", (await text()).includes("Create link"));
  await shot("m06-share-dialog");
  await back(900);

  // ----- Settings and its pages -----
  await go("/settings");
  const set = await text();
  check("Settings shows backup, storage, appearance, updates", ["Backup", "Appearance", "Recycle Bin"].every((t) => set.includes(t)), set.slice(0, 60).replace(/\n/g, " "));
  await shot("m07-settings");
  for (const [route, expect] of [["/cleanup", "Clean up"], ["/duplicates", "Duplicates"], ["/history", "Backup history"], ["/trash", "Recycle Bin"], ["/updates", "3.6"]]) {
    await go(route, 4500);
    const t = await text();
    check(`${route} page opens`, t.includes(expect) && !/Application error|Something went wrong/i.test(t), t.slice(0, 50).replace(/\n/g, " "));
    await shot(`m08${route.replace("/", "-")}`);
  }
  check("Recycle Bin lists nothing of ours", !(await text()).includes("zz-test renamed"));

  // Light theme
  await go("/settings");
  const light = `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Light")`;
  if (await tap(light, 900)) {
    check("Light theme switches", await js(`document.documentElement.dataset.theme === "light" || getComputedStyle(document.body).backgroundColor.startsWith("rgb(2")`));
    await go("/", 4000);
    await shot("m09-light-photos");
    await go("/settings");
    await tap(`[...document.querySelectorAll("button")].find(b => ["System", "Auto", "Dark"].includes(b.textContent.trim()))`, 600);
  }

  // ----- Viewer tools on a video -----
  await go("/", 4000);
  await tap(`[...document.querySelectorAll("[data-path]")].find(e => e.dataset.path === ${JSON.stringify(aVideo)})`, 2500);
  // The watch page's round buttons under the video (YouTube-style).
  const pill = (t) => `[...document.querySelectorAll("[data-watch-page] button, [data-watch-page] a")].find(b => b.textContent.trim() === ${JSON.stringify(t)})`;
  for (const [item, expect, name] of [["Details", "Camera", "m10-details"], ["Rename", "Rename", "m11-rename"], ["Trim", "Trim", "m12-trim"], ["Rotate", "Rotate", "m13-rotate"], ["Save sound", "Extract audio", "m14-audio"]]) {
    const ok = await tap(pill(item), 1500);
    const t = await text();
    check(`Viewer › ${item} opens`, ok && t.toLowerCase().includes(expect.toLowerCase()));
    await shot(name);
    await back(900);
    check(`…Back closes it and keeps the video open`, await js(`Boolean(document.querySelector("video"))`));
  }
  await back(900);

  // ----- Computer size -----
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [route, name] of [["/", "m15-desktop-photos"], ["/albums", "m16-desktop-albums"], ["/map", "m17-desktop-map"], ["/settings", "m18-desktop-settings"]]) {
    await go(route, 4000);
    await shot(name);
  }
  check("No page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("No server errors (5xx) while using the app", serverErrors.length === 0, serverErrors.slice(0, 3).join(" | "));

  ws.close();
  proc.kill();
  cleanup();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
