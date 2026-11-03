// End-to-end test of the app (headless Edge at phone size, then computer size).
// Signs in through the real login screen, walks Photos / viewer / selection / Albums /
// trips / Map / Settings, checks phone Back closes only the top thing, and checks
// uploads and downloads are byte-for-byte identical to the original files.
// Creates and removes its own "zz-test" files; needs the app running.
// Usage: node scripts/test-app.js . http://localhost:4600/ <screenshot folder>
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");

const [projectDir, base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sharp = require(path.resolve(projectDir, "node_modules", "sharp"));
const env = Object.fromEntries(
  fs.readFileSync(path.join(projectDir, ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const MEDIA = path.join(process.env.USERPROFILE, "Desktop", "Phone Media");
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ps-app-"));
const port = 9343;
const proc = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
  if (!ok) failures++;
}

const DATED = ["zz-test 20250105_101500.jpg", "zz-test 20250105_113000.jpg", "zz-test 20250106_090000.jpg"];
async function setup() {
  const colors = ["#22c55e", "#ef4444", "#3b82f6"];
  for (let i = 0; i < 3; i++) {
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: colors[i] } }).jpeg().toFile(path.join(MEDIA, `zz-test photo ${i + 1}.jpg`));
    await sharp({ create: { width: 800, height: 600, channels: 3, background: colors[2 - i] } }).jpeg().toFile(path.join(MEDIA, DATED[i]));
  }
  fs.copyFileSync(path.join(MEDIA, "20261015_181528.mp4"), path.join(MEDIA, "zz-test video.mp4"));
  const t = new Date(Date.now() + 3600e3); // newest, so they're at the top of Photos
  for (const f of ["zz-test photo 1.jpg", "zz-test photo 2.jpg", "zz-test photo 3.jpg", "zz-test video.mp4"]) fs.utimesSync(path.join(MEDIA, f), t, t);
}

function cleanup() {
  const rm = (dir) => { for (const f of fs.readdirSync(dir)) if (f.includes("zz-test")) fs.rmSync(path.join(dir, f), { recursive: true, force: true }); };
  rm(MEDIA);
  rm(path.join(MEDIA, ".trash"));
  const trips = path.join(MEDIA, ".meta", "trips.json");
  if (fs.existsSync(trips)) {
    const data = JSON.parse(fs.readFileSync(trips, "utf8"));
    data.trips = data.trips.filter((t) => !t.name.includes("zz-test"));
    fs.writeFileSync(trips, JSON.stringify(data));
  }
}

(async () => {
  cleanup();
  await setup();
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { await sleep(250); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? msg.error); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  };
  const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("DOM.enable");
  const phone = () => send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await phone();
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const pos = (sel) => js(`(() => { const el = ${sel}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const tap = async (sel, wait = 700) => { const p = await pos(sel); if (!p) return false; await touch("touchStart", [p]); await touch("touchEnd", []); await sleep(wait); return true; };
  const longPress = async (sel) => { const p = await pos(sel); if (!p) return false; await touch("touchStart", [p]); await sleep(700); await touch("touchEnd", []); await sleep(500); return true; };
  const back = async (wait = 700) => { await js("history.back()"); await sleep(wait); };
  const btn = (text) => `[...document.querySelectorAll("button, a")].find(b => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent)`;
  const label = (l) => `[...document.querySelectorAll('[aria-label=${JSON.stringify(l)}]')].find(b => b.offsetParent)`;
  const tile = (p) => `document.querySelector('[data-path=${JSON.stringify(p)}]')`;
  const typeInto = (selector, text) => js(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const has = (sel) => js(`Boolean(${sel})`);
  const text = () => js("document.body.innerText");
  const viewerOpen = () => js(`Boolean(document.querySelector("div[data-theme=dark].fixed.inset-0"))`);
  const dialogOpen = () => js(`Boolean(document.querySelector("[role=dialog]"))`);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const cookie = async () => (await send("Network.getCookies", { urls: [base] })).cookies?.find((c) => c.name === "media_session")?.value;
  await send("Network.enable");

  // ---------- Login ----------
  await send("Page.navigate", { url: base });
  await sleep(3500);
  check("Login screen shows (with artwork, no letters logo)", (await has(`document.querySelector("input[autocomplete=username]")`)) && (await has(`document.querySelector("svg[viewBox='0 0 320 230']")`)));
  await shot("01-login");
  await typeInto("input[autocomplete=username]", "wrong");
  await typeInto("input[autocomplete=current-password]", "nope");
  await tap(btn("Sign in"), 1500);
  check("Wrong password is refused with a message", (await text()).includes("isn't right"));
  await typeInto("input[autocomplete=username]", env.APP_USERNAME);
  await typeInto("input[autocomplete=current-password]", env.APP_PASSWORD);
  await tap(btn("Sign in"), 4500);
  check("Signing in opens Photos", (await has(tile("zz-test photo 1.jpg"))) && (await text()).includes("Photos"));
  await sleep(2500);
  await shot("02-photos");

  // ---------- Viewer: arrows on phone, next/previous, Back ----------
  await tap(tile("zz-test photo 1.jpg"), 1200);
  check("Tapping a photo opens the viewer", await viewerOpen());
  check("Viewer shows a Next arrow on the phone", await has(label("Next")));
  await shot("03-viewer-photo");
  const first = await js(`document.querySelector("header p")?.textContent`);
  await tap(label("Next"), 900);
  check("Next arrow moves to another item", (await has(label("Previous"))) && (await viewerOpen()));
  await tap(label("Previous"), 900);
  check("Previous arrow goes back", (await js(`document.querySelector("header p")?.textContent`)) === first);
  await back();
  check("Back closes only the viewer", !(await viewerOpen()) && (await js("location.pathname")) === "/");

  // ---------- Video: opens on the light copy (if ready), no source switch ----------
  await tap(tile("zz-test video.mp4"), 600);
  const srcSoon = await js(`document.querySelector("video")?.getAttribute("src")`);
  await sleep(2500);
  const srcLater = await js(`document.querySelector("video")?.getAttribute("src")`);
  check("Video opens and keeps one source (no mid-load switch)", Boolean(srcLater) && (!srcSoon || srcSoon === srcLater), String(srcLater).slice(0, 60));
  check("Video viewer has arrows too", await has(label("Next")));
  await shot("04-viewer-video");
  await back();

  // ---------- Selection ----------
  await longPress(tile("zz-test photo 2.jpg"));
  check("Long-press selects", (await text()).includes("1 selected"));
  await tap(tile("zz-test photo 3.jpg"), 400);
  check("Tap adds to selection", (await text()).includes("2 selected"));
  await shot("05-selection");
  await tap(label("Add to favourites"), 1200);
  check("Favourite from selection", (await js(`[...document.querySelectorAll("[data-path^='zz-test photo']")].filter(t => t.querySelector("svg path[fill=currentColor]")).length`)) >= 2);
  await longPress(tile("zz-test photo 1.jpg"));
  await back();
  check("Back clears the selection", !(await text()).includes("selected"));

  // ---------- Albums + trip ----------
  await tap(`[...document.querySelectorAll("nav a[href='/albums']")].find(a => a.offsetParent)`, 1800);
  check("Albums tab opens", (await text()).includes("Your albums") && (await text()).includes("Trips"));
  await shot("06-albums");
  await tap(btn("New trip"), 700);
  check("New trip dialog opens", await dialogOpen());
  await typeInto("#trip-form input:not([type=date])", "zz-test Trip");
  await js(`(() => { const [a, b] = document.querySelectorAll("#trip-form input[type=date]"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(a, "2025-01-05"); a.dispatchEvent(new Event("input", { bubbles: true })); set.call(b, "2025-01-06"); b.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await shot("07-trip-dialog");
  await tap(btn("Create trip"), 3500);
  const inTrip = fs.existsSync(path.join(MEDIA, "zz-test Trip")) ? fs.readdirSync(path.join(MEDIA, "zz-test Trip")) : [];
  check("Trip gathers the photos taken on its dates", DATED.every((n) => inTrip.includes(n)), inTrip.join(", "));
  check("Trip album opens with its photos", (await has(tile(`zz-test Trip/${DATED[0]}`))));
  await shot("08-trip");
  await back(1200);
  check("Back from the trip returns to Albums", (await text()).includes("Your albums"));
  await tap(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Favourites") && b.textContent.includes("item"))`, 1000);
  check("Favourites collection shows favourited photos", await has(tile("zz-test photo 2.jpg")));
  await back(900);

  // ---------- Map ----------
  // Give one test photo a location, as if the camera had saved one (once the PC has
  // finished reading the new test files, so it doesn't overwrite it).
  for (let i = 0; i < 60; i++) {
    const lib = await (await fetch(`${base}api/library`, { headers: { Cookie: `media_session=${await cookie()}` } })).json();
    if (!lib.pending) break;
    await sleep(1000);
  }
  const places = path.join(MEDIA, ".meta", "places.json");
  const stat = fs.statSync(path.join(MEDIA, "zz-test photo 1.jpg"));
  const key = crypto.createHash("sha1").update(`${stat.size}-${Math.floor(stat.mtimeMs)}`).digest("hex").slice(0, 20);
  const placesData = JSON.parse(fs.readFileSync(places, "utf8"));
  placesData[key] = [26.9124, 75.7873];
  fs.writeFileSync(places, JSON.stringify(placesData));
  await send("Page.navigate", { url: `${base}map` });
  await sleep(5000);
  check("Map shows a photo pin", await has(`document.querySelector(".ps-pin")`));
  await shot("09-map");
  await js(`document.querySelector(".ps-pin").click()`);
  await sleep(900);
  check("Tapping a pin shows its photos", await has(tile("zz-test photo 1.jpg")));
  await back(800);
  check("Back closes the pin's sheet only", (await js("location.pathname")) === "/map" && !(await has(tile("zz-test photo 1.jpg"))));
  delete placesData[key];
  fs.writeFileSync(places, JSON.stringify(placesData));

  // ---------- Settings ----------
  await tap(`[...document.querySelectorAll("nav a[href='/settings']")].find(a => a.offsetParent)`, 1800);
  { const t = await text(); check("Settings shows phone backup, storage and theme", ["Back up your phone automatically", "Recycle Bin", "Appearance", "Sign out"].every((s) => t.includes(s))); }
  await shot("10-settings");
  await tap(btn("Light"), 800);
  await tap(`[...document.querySelectorAll("nav a[href='/']")].find(a => a.offsetParent)`, 1800);
  await shot("11-photos-light");
  await tap(`[...document.querySelectorAll("nav a[href='/albums']")].find(a => a.offsetParent)`, 1500);
  await shot("12-albums-light");
  await tap(`[...document.querySelectorAll("nav a[href='/settings']")].find(a => a.offsetParent)`, 1200);
  await tap(btn("Dark"), 600);

  // ---------- Originals: byte-for-byte ----------
  const c = await cookie();
  const H = { Cookie: `media_session=${c}` };
  // Upload through the app's own upload button.
  const original = path.join(os.tmpdir(), "zz-test upload original.jpg");
  const exif = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#8844cc" } }).jpeg({ quality: 97 }).withMetadata({ exif: { IFD0: { Make: "zz-test", Model: "strict" } } }).toBuffer();
  fs.writeFileSync(original, Buffer.concat([exif, crypto.randomBytes(1024 * 1024 * 3)])); // 3 MB extra: pieces + odd bytes
  await tap(`[...document.querySelectorAll("nav a[href='/']")].find(a => a.offsetParent)`, 1500);
  const { root } = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
  await send("DOM.setFileInputFiles", { nodeId, files: [original] });
  let uploaded = null;
  for (let i = 0; i < 60 && !uploaded; i++) {
    await sleep(500);
    const p = path.join(MEDIA, path.basename(original));
    if (fs.existsSync(p)) uploaded = p;
  }
  check("Upload arrives on the PC", Boolean(uploaded));
  const want = md5(fs.readFileSync(original));
  check("Upload is byte-for-byte identical (MD5)", uploaded && md5(fs.readFileSync(uploaded)) === want, want);
  const dl = Buffer.from(await (await fetch(`${base}api/files?name=${encodeURIComponent(path.basename(original))}&download=1`, { headers: H })).arrayBuffer());
  check("Download gives the exact original (MD5)", md5(dl) === want);
  const view = Buffer.from(await (await fetch(`${base}api/files?name=${encodeURIComponent(path.basename(original))}`, { headers: H })).arrayBuffer());
  check("Viewer loads the exact original photo, not a compressed copy", md5(view) === want);
  const vid = fs.readFileSync(path.join(MEDIA, "zz-test video.mp4"));
  const vdl = Buffer.from(await (await fetch(`${base}api/files?name=${encodeURIComponent("zz-test video.mp4")}&download=1`, { headers: H })).arrayBuffer());
  check("Video download is the exact original (MD5)", md5(vdl) === md5(vid), `${(vid.length / 1048576).toFixed(1)} MB`);
  const zipRes = await fetch(`${base}api/zip?p=${encodeURIComponent(path.basename(original))}&p=${encodeURIComponent("zz-test video.mp4")}`, { headers: H });
  const zipFile = path.join(os.tmpdir(), "zz-test.zip");
  fs.writeFileSync(zipFile, Buffer.from(await zipRes.arrayBuffer()));
  const unz = fs.mkdtempSync(path.join(os.tmpdir(), "zz-unzip-"));
  execFileSync("C:/Windows/System32/tar.exe", ["-xf", zipFile, "-C", unz]);
  check("Several-file download (ZIP) holds exact originals", md5(fs.readFileSync(path.join(unz, path.basename(original)))) === want && md5(fs.readFileSync(path.join(unz, "zz-test video.mp4"))) === md5(vid));

  // ---------- Computer size ----------
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 820, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: base });
  await sleep(3500);
  await shot("13-desktop-photos");
  await send("Page.navigate", { url: `${base}albums` });
  await sleep(2500);
  await shot("14-desktop-albums");

  check("No page errors during the test", errors.length === 0, errors.slice(0, 3).join(" | "));

  ws.close();
  proc.kill();
  cleanup();
  fs.rmSync(original, { force: true });
  console.log(`\n${failures ? `${failures} FAILED` : "ALL PASSED"}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  proc.kill();
  cleanup();
  process.exit(1);
});
