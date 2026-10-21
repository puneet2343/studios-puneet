// Phone walkthrough test (headless Edge at Galaxy S25 size): taps every main control
// and presses Back after each step, checking only the top thing closes.
// Creates and removes its own "zz-test" files in the library; needs the app running.
// Usage: node scripts/test-phone-walkthrough.js . http://localhost:3000/ <screenshot folder>
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const [projectDir, base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sharp = require(path.resolve(projectDir, "node_modules", "sharp"));
const env = Object.fromEntries(
  fs.readFileSync(path.join(projectDir, ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const token = crypto.createHmac("sha256", `${env.APP_USERNAME}\n${env.APP_PASSWORD}`).update("media-session-v2").digest("hex");
const MEDIA = path.join(process.env.USERPROFILE, "Desktop", "Phone Media");
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ps-e2e-"));
const port = 9341;
const proc = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const results = [];
function check(label, ok, extra = "") {
  const line = `${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`;
  console.log(line);
  results.push(line);
  if (!ok) failures++;
}

async function setup() {
  const colors = ["#22c55e", "#ef4444", "#3b82f6"];
  for (let i = 0; i < 3; i++) {
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: colors[i] } }).jpeg().toFile(path.join(MEDIA, `zz-test photo ${i + 1}.jpg`));
  }
  fs.copyFileSync(path.join(MEDIA, "20261015_181528 - IG Reel.mp4"), path.join(MEDIA, "zz-test video.mp4"));
  fs.mkdirSync(path.join(MEDIA, "zz-test Trip"), { recursive: true });
  await sharp({ create: { width: 600, height: 600, channels: 3, background: "#a855f7" } }).jpeg().toFile(path.join(MEDIA, "zz-test Trip", "zz-test inside.jpg"));
  const t = new Date(Date.now() + 3600e3); // newest, so they're at the top
  for (const f of fs.readdirSync(MEDIA).filter((n) => n.startsWith("zz-test"))) fs.utimesSync(path.join(MEDIA, f), t, t);
}

function cleanup() {
  for (const f of fs.readdirSync(MEDIA)) if (f.startsWith("zz-test")) fs.rmSync(path.join(MEDIA, f), { recursive: true, force: true });
  const trash = path.join(MEDIA, ".trash");
  for (const f of fs.readdirSync(trash).filter((n) => n.includes("zz-test"))) fs.rmSync(path.join(trash, f), { recursive: true, force: true });
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
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Network.enable");
  await send("Network.setCookie", { name: "media_session", value: token, url: base });
  const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const tapAt = async ([x, y]) => { await touch("touchStart", [[x, y]]); await touch("touchEnd", []); await sleep(350); };
  const tap = async (selectorJs, wait = 600) => {
    const pos = await js(`(() => { const el = ${selectorJs}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
    if (!pos) return false;
    await tapAt(pos);
    await sleep(wait);
    return true;
  };
  const back = async (wait = 700) => { await js("history.back()"); await sleep(wait); };
  const btn = (text) => `[...document.querySelectorAll("button, a")].find(b => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent)`;
  const btnStart = (text) => `[...document.querySelectorAll("button, a")].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}) && b.offsetParent)`;
  const label = (l) => `document.querySelector('[aria-label=${JSON.stringify(l)}]')`;
  const typeInto = (selector, text) => js(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const path_ = () => js("location.pathname");
  const has = (selectorJs) => js(`Boolean(${selectorJs})`);
  const dialogOpen = () => js(`Boolean(document.querySelector("[role=dialog]"))`);
  const viewerOpen = () => js(`Boolean(document.querySelector("div[data-theme=dark].fixed.inset-0"))`);
  const tile = (name) => `document.querySelector('[data-path=${JSON.stringify(name)}]')`;
  const toastText = () => js(`document.querySelector("[role=status]")?.textContent || ""`);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));

  await send("Page.navigate", { url: base });
  await sleep(4000);

  // ---------- Media page ----------
  check("Media loads with test items", await has(tile("zz-test photo 1.jpg")) && await has(tile("zz-test video.mp4")));

  await tap(btn("Videos"));
  const onlyVideos = await js(`[...document.querySelectorAll("main [data-path]")].every(t => /\\.mp4$/.test(t.dataset.path))`);
  check("Videos filter shows only videos", onlyVideos);
  await back();
  check("Back from Videos filter returns to All (stays in app)", (await path_()) === "/" && (await has(tile("zz-test photo 1.jpg"))));

  await typeInto("input[placeholder='Search all folders']", "zz-test inside");
  await sleep(1500);
  check("Search finds a file inside a folder", await has(tile("zz-test Trip/zz-test inside.jpg")));
  await back();
  check("Back clears the search", (await js(`document.querySelector("input[placeholder='Search all folders']").value`)) === "" && (await has(tile("zz-test photo 1.jpg"))));

  await tap(btn("Favourites"));
  check("Favourites view opens", (await js(`document.body.innerText.includes("favourite")`)));
  await back();
  check("Back from Favourites returns to All", await has(tile("zz-test video.mp4")));

  await js(`(() => { const s = document.querySelector("select[aria-label=Sort]"); s.value = "name"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await sleep(600);
  check("Sort by name works", (await js(`[...document.querySelectorAll("main [data-path]")].map(t => t.dataset.path).filter(p => p.startsWith("zz-test photo")).join(",")`)) === "zz-test photo 1.jpg,zz-test photo 2.jpg,zz-test photo 3.jpg");
  await js(`(() => { const s = document.querySelector("select[aria-label=Sort]"); s.value = "newest"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);

  // New folder dialog: Back closes only the dialog
  await tap(label("New folder"));
  check("New folder dialog opens", await dialogOpen());
  await back();
  check("Back closes the New folder dialog only", !(await dialogOpen()) && (await path_()) === "/");
  await tap(label("New folder"));
  await typeInto("#name-form input", "zz-test New");
  await tap(btn("Create"), 1500);
  check("Create folder works", await js(`[...document.querySelectorAll("[role=button]")].some(c => c.textContent.includes("zz-test New"))`));

  // Folder menu + rename + delete/undo
  await tap(label("Options for zz-test New"));
  check("Folder ⋯ menu opens", await dialogOpen());
  await back();
  check("Back closes the folder menu only", !(await dialogOpen()));
  await tap(label("Options for zz-test New"));
  await tap(btn("Rename"));
  await typeInto("#name-form input", "zz-test Renamed");
  await tap(btn("Save"), 1500);
  check("Rename folder works", await js(`[...document.querySelectorAll("[role=button]")].some(c => c.textContent.includes("zz-test Renamed"))`));
  await tap(label("Options for zz-test Renamed"));
  await tap(btn("Delete folder"));
  check("Delete asks for confirmation", (await js(`document.querySelector("[role=dialog]")?.textContent || ""`)).includes("Delete"));
  await back();
  check("Back cancels the delete confirmation", !(await dialogOpen()) && await js(`[...document.querySelectorAll("[role=button]")].some(c => c.textContent.includes("zz-test Renamed"))`));
  await tap(label("Options for zz-test Renamed"));
  await tap(btn("Delete folder"));
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Delete")`, 1500);
  check("Delete folder works", !(await js(`[...document.querySelectorAll("[role=button]")].some(c => c.textContent.includes("zz-test Renamed"))`)));
  await tap(btn("Undo"), 1500);
  check("Undo brings the folder back", await js(`[...document.querySelectorAll("[role=button]")].some(c => c.textContent.includes("zz-test Renamed"))`));

  // Open a folder: Back climbs out, not out of the app
  await tap(`[...document.querySelectorAll("[role=button]")].find(c => c.textContent.includes("zz-test Trip"))`, 1500);
  check("Open folder", await has(tile("zz-test Trip/zz-test inside.jpg")));
  await back(1200);
  check("Back from a folder returns to Media", (await has(tile("zz-test photo 1.jpg"))) && !(await has(tile("zz-test Trip/zz-test inside.jpg"))));

  // Long-press select; Back clears selection
  const p1 = await js(`(() => { const r = ${tile("zz-test photo 1.jpg")}.getBoundingClientRect(); return [Math.round(r.left + r.width/2), Math.round(r.top + r.height/2)]; })()`);
  await touch("touchStart", [p1]);
  await sleep(650);
  await touch("touchEnd", []);
  await sleep(500);
  check("Long-press starts selection", await has(label("Clear selection")));
  // Move dialog over selection: Back closes the dialog, selection stays
  await tap(label("Move"));
  check("Move dialog opens", await dialogOpen());
  await back();
  check("Back closes Move dialog, selection kept", !(await dialogOpen()) && (await has(label("Clear selection"))));
  await tap(label("Favourite"), 1200);
  check("Favourite from selection adds a star", await js(`Boolean(${tile("zz-test photo 1.jpg")}.querySelector("[title=Favourite]"))`));
  await touch("touchStart", [p1]);
  await sleep(650);
  await touch("touchEnd", []);
  await sleep(500);
  await back();
  check("Back clears the selection", !(await has(label("Clear selection"))) && (await path_()) === "/");

  // Delete + Undo for a file
  await touch("touchStart", [p1]);
  await sleep(650);
  await touch("touchEnd", []);
  await sleep(400);
  await tap(label("Delete"), 1500);
  check("Delete selected file", !(await has(tile("zz-test photo 1.jpg"))));
  await tap(btn("Undo"), 1500);
  check("Undo restores the file", await has(tile("zz-test photo 1.jpg")));

  // ---------- Viewer ----------
  await tap(tile("zz-test photo 2.jpg"), 1500);
  check("Tap opens the viewer", await viewerOpen());
  await back();
  check("Back closes the viewer only", !(await viewerOpen()) && (await path_()) === "/");

  await tap(tile("zz-test video.mp4"), 2500);
  check("Video opens in the viewer", await viewerOpen() && await has(`document.querySelector("video")`));
  // Like a person would: pause, so the player's controls (and the viewer's top bar) stay visible.
  await js(`document.querySelector("video").pause()`);
  await sleep(700);
  await tap(label("Add to favourites"), 800);
  check("Star in viewer", await has(label("Remove from favourites")));
  await tap(label("Remove from favourites"), 800);

  for (const [item, opened, name] of [
    ["Properties", `document.querySelector("[aria-label=Properties][role=dialog]")`, "Properties sheet"],
    ["Rotate / mirror", `[...document.querySelectorAll("p")].some(p => p.textContent.trim() === "Rotate")`, "Rotate screen"],
    ["Extract audio", `[...document.querySelectorAll("h2")].some(h => h.textContent === "Extract audio")`, "Extract audio sheet"],
    ["Rename", `document.querySelector("#rename-form")`, "Rename dialog"],
  ]) {
    // Coming back from a full-screen tool restarts the video; pause so its controls stay up.
    await js(`document.querySelector("video")?.pause()`);
    await sleep(500);
    await tap(label("More"), 500);
    const menuOpen = await has(btnStart(item));
    if (item === "Properties") {
      check("⋮ menu opens", menuOpen);
      await back();
      check("Back closes the ⋮ menu only", !(await has(btnStart("Properties"))) && await viewerOpen());
      await tap(label("More"), 500);
    }
    await tap(btnStart(item), 1800);
    const isOpen = await js(`Boolean(${opened})`);
    if (!isOpen) {
      await shot(`fail-${item.replace(/W+/g, "-")}`);
      console.log("   visible buttons:", await js(`[...document.querySelectorAll("button")].filter(b => b.offsetParent).map(b => b.textContent.trim() || b.getAttribute("aria-label")).join(" | ")`));
    }
    check(`${name} opens`, isOpen);
    await back(900);
    check(`Back closes the ${name} only (viewer stays)`, !(await js(`Boolean(${opened})`)) && await viewerOpen());
  }
  await js(`document.querySelector("video")?.pause()`);
  await sleep(500);
  await tap(label("Trim"), 2000);
  check("Trim screen opens", await js(`[...document.querySelectorAll("p")].some(p => p.textContent.trim() === "Trim")`));
  await back(900);
  check("Back closes Trim only", await viewerOpen() && !(await js(`[...document.querySelectorAll("p")].some(p => p.textContent.trim() === "Trim")`)));

  await sleep(1500);
  await js(`document.querySelector("video").pause()`);
  await sleep(600);
  await tap(label("Playback speed"), 500);
  check("Speed menu opens", await has(btn("1.5×")));
  await back();
  check("Back closes the speed menu only", !(await has(btn("1.5×"))) && await viewerOpen());
  await tap(label("Quality"), 900);
  check("Quality menu opens", await has(btnStart("Auto")));
  await back();
  check("Back closes the quality menu only", !(await has(btnStart("Auto"))) && await viewerOpen());
  await tap(label("Quality"), 900);
  await tapAt([180, 300]);
  await sleep(400);
  check("Tap on the picture closes the quality menu", !(await has(btnStart("Auto"))) && await viewerOpen());
  await tap(label("Forward 10 seconds"), 600);
  check("+10s button", (await js(`document.querySelector("video").currentTime`)) >= 9);
  await back();
  check("Back closes the video viewer", !(await viewerOpen()) && (await path_()) === "/");

  // ---------- More sheet + tools pages ----------
  await tap(`[...document.querySelectorAll("nav button")].find(b => /More/.test(b.textContent))`, 600);
  check("More sheet opens", await has(btnStart("Recycle Bin")));
  await back();
  check("Back closes the More sheet", !(await has(btnStart("Recycle Bin"))) && (await path_()) === "/");
  await tap(`[...document.querySelectorAll("nav button")].find(b => /More/.test(b.textContent))`, 600);
  await tap(btn("Dark"), 400);
  check("Dark theme", (await js("document.documentElement.dataset.theme")) === "dark");
  await tap(btn("Light"), 400);
  check("Light theme", (await js("document.documentElement.dataset.theme")) === "light");
  await tap(btn("Auto"), 400);
  await tap(btnStart("Recycle Bin"), 2000);
  check("More → Recycle Bin opens the page", (await path_()) === "/trash");
  await shot("recycle-bin");
  await back(1500);
  check("One Back from Recycle Bin returns to Media", (await path_()) === "/" && !(await has(btnStart("Duplicates"))));
  await tap(`[...document.querySelectorAll("nav button")].find(b => /More/.test(b.textContent))`, 600);
  await tap(btnStart("Duplicates"), 2500);
  check("More → Duplicates opens", (await path_()) === "/duplicates");
  await tap(label("Scan again"), 1500);
  check("Duplicates rescan", await js(`document.body.innerText.includes("No duplicates") || document.body.innerText.includes("can be freed")`));
  await back(1500);
  check("One Back from Duplicates returns to Media", (await path_()) === "/");

  // Recycle bin actions with a test file
  await touch("touchStart", [p1]); await sleep(650); await touch("touchEnd", []); await sleep(400);
  await tap(label("Delete"), 1500);
  await send("Page.navigate", { url: base + "trash" });
  await sleep(2500);
  check("Deleted file is in the Recycle Bin", await js(`[...document.querySelectorAll("li")].some(li => li.textContent.includes("zz-test photo 1.jpg"))`));
  await tap(`[...document.querySelectorAll("li")].find(li => li.textContent.includes("zz-test photo 1.jpg"))?.querySelector("[aria-label^='Delete']")`, 500);
  check("Delete forever asks first", await dialogOpen());
  await back();
  check("Back cancels Delete forever", !(await dialogOpen()) && await js(`[...document.querySelectorAll("li")].some(li => li.textContent.includes("zz-test photo 1.jpg"))`));
  await tap(`[...document.querySelectorAll("li")].find(li => li.textContent.includes("zz-test photo 1.jpg"))?.querySelector("button")`, 1500);
  check("Restore from the bin", !(await js(`[...document.querySelectorAll("li")].some(li => li.textContent.includes("zz-test photo 1.jpg"))`)) && fs.existsSync(path.join(MEDIA, "zz-test photo 1.jpg")));

  // Instagram page
  await tap(`[...document.querySelectorAll("nav a")].find(a => /Instagram/.test(a.textContent) && a.offsetParent)`, 2000);
  check("Instagram tab opens", (await path_()) === "/instagram");
  await tap(btnStart("My exports"), 1000);
  check("Instagram: My exports tab", await js(`document.body.innerText.includes("IG Reel") || document.body.innerText.toLowerCase().includes("export")`));
  await tap(btnStart("New export"), 600);

  // Exit guard on the first screen
  await send("Page.navigate", { url: base });
  await sleep(3000);
  await back(500);
  const t = await toastText();
  check("Back with nothing open shows 'Press back again to exit'", t.includes("Press back again"), t);
  check("…and the app is still open", (await path_()) === "/" && await has(tile("zz-test video.mp4")));

  // Upload
  const upload = path.join(outDir, "zz-test upload.jpg");
  await sharp({ create: { width: 400, height: 400, channels: 3, background: "#f97316" } }).jpeg().toFile(upload);
  const doc = await send("DOM.getDocument", { depth: -1 });
  const input = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
  await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [upload] });
  await sleep(4000);
  check("Upload a photo", fs.existsSync(path.join(MEDIA, "zz-test upload.jpg")) && await has(tile("zz-test upload.jpg")));

  check("No page errors during the walkthrough", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(failures ? `\n${failures} FAILED of ${results.length}` : `\nALL ${results.length} PASSED`);
  ws.close();
  proc.kill();
  cleanup();
  fs.rmSync(upload, { force: true });
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
})().catch((e) => { console.error(e); proc.kill(); cleanup(); process.exit(1); });
