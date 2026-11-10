// End-to-end test of the YouTube-style video player (headless Edge, phone then computer).
// Picks real videos whose streaming pieces are ready, and checks: streams in pieces (not the
// whole file), Auto quality, picking a quality / Original keeps the position, speed, seek
// preview pictures, double-tap ±10 s, press-and-hold 2×, Stats for nerds, Back closes only
// the menu, keyboard keys, volume slider, Autoplay "Up next". Changes nothing on the PC.
// Usage: node scripts/test-video.js . http://localhost:4600/ <screenshot folder>
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const [projectDir, base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const env = Object.fromEntries(
  fs.readFileSync(path.join(projectDir, ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const MEDIA = path.join(process.env.USERPROFILE, "Desktop", "Phone Media");
const LADDERS = path.join(MEDIA, ".renditions");
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ps-video-"));
const port = 9344;
const proc = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra !== "" ? "  — " + extra : ""}`);
  if (!ok) failures++;
}

// Videos in the library whose ladder is ready, longest first.
function readyVideos() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(mp4|mov)$/i.test(e.name)) {
        const st = fs.statSync(full);
        const key = crypto.createHash("sha1").update(`${st.size}-${Math.floor(st.mtimeMs)}`).digest("hex").slice(0, 20);
        const info = path.join(LADDERS, key, "info.json");
        if (fs.existsSync(info)) {
          const m3u8 = fs.readFileSync(path.join(LADDERS, key, "v0", "index.m3u8"), "utf8");
          const dur = [...m3u8.matchAll(/#EXTINF:([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
          out.push({ rel: path.relative(MEDIA, full).split(path.sep).join("/"), key, size: st.size, dur, info: JSON.parse(fs.readFileSync(info, "utf8")) });
        }
      }
    }
  })(MEDIA);
  return out.sort((a, b) => b.dur - a.dur);
}

(async () => {
  const videos = readyVideos();
  console.log(`${videos.length} videos ready to stream`);
  if (!videos.length) {
    console.log("FAIL  No video is ready yet — wait for the PC to prepare some");
    process.exit(1);
  }
  const main = videos[0];
  console.log(`Testing with ${main.rel} (${main.dur.toFixed(0)} s, ${(main.size / 1e6).toFixed(0)} MB original)`);

  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { await sleep(250); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const requests = [];
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? msg.error); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === "Network.requestWillBeSent") requests.push(msg.params.request.url);
  };
  const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const pos = (sel) => js(`(() => { const el = ${sel}; if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const tapAt = async ([x, y], wait = 500) => { await touch("touchStart", [[x, y]]); await touch("touchEnd", []); await sleep(wait); };
  const tap = async (sel, wait = 600) => { const p = await pos(sel); if (!p) return false; await tapAt(p, wait); return true; };
  const btn = (t) => `[...document.querySelectorAll("button, a")].find(b => b.textContent.trim().startsWith(${JSON.stringify(t)}) && b.offsetParent)`;
  const label = (l) => `[...document.querySelectorAll('[aria-label^=${JSON.stringify(l)}]')].find(b => b.offsetParent)`;
  const typeInto = (selector, t) => js(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ${JSON.stringify(t)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const text = () => js("document.body.innerText");
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const V = (prop) => js(`document.querySelector("video")?.${prop}`);
  const showControls = async () => {
    if (!(await js(`Boolean([...document.querySelectorAll('[aria-label="Settings"]')].find(b => b.offsetParent && getComputedStyle(b.closest("[data-control]")).opacity === "1"))`))) {
      await tapAt([195, 300], 700);
    }
  };
  const key = (k, extra = {}) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k.length === 1 ? k : undefined, ...extra }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, ...extra }));

  // ---------- Sign in, open the video ----------
  await send("Page.navigate", { url: base });
  await sleep(3500);
  await typeInto("input[autocomplete=username]", env.APP_USERNAME);
  await typeInto("input[autocomplete=current-password]", env.APP_PASSWORD);
  await tap(btn("Sign in"), 4500);
  await js(`localStorage.removeItem("ps.quality"); localStorage.removeItem("ps.resume"); localStorage.setItem("ps.autoplay", "true")`);
  await send("Page.navigate", { url: base });
  await sleep(4000);
  const tileSel = `[...document.querySelectorAll("[data-path]")].find((e) => e.dataset.path === ${JSON.stringify(main.rel)})`;
  await js(`${tileSel}?.scrollIntoView({ block: "center" })`);
  await sleep(800);
  requests.length = 0;
  check("Video tile found in Photos", await tap(tileSel, 5000));

  // ---------- Streams in pieces with Auto quality ----------
  const src = await V("currentSrc");
  check("Plays by streaming (pieces), not the whole original", String(src).startsWith("blob:"), String(src).slice(0, 40));
  const t1 = await V("currentTime");
  await sleep(2000);
  const t2 = await V("currentTime");
  check("Video is playing", t2 > t1 && !(await V("paused")), `${t1.toFixed(1)} → ${t2.toFixed(1)} s`);
  const pieces = requests.filter((u) => u.includes("/api/hls/"));
  const original = requests.filter((u) => u.includes("/api/files"));
  check("Loads small pieces, never the original file", pieces.some((u) => u.endsWith(".m4s")) && original.length === 0, `${pieces.length} piece requests`);
  await shot("v01-phone-playing");

  // ---------- Controls ----------
  await showControls();
  check("Controls show time, settings, full screen", (await js(`Boolean(document.querySelector('[aria-label="Settings"]') && document.querySelector('[aria-label^="Full screen"]') && document.querySelector('[role=slider][aria-label=Seek]'))`)));
  check("Seek bar is red like YouTube", (await js(`[...document.querySelectorAll('[role=slider] div')].some(d => getComputedStyle(d).backgroundColor === "rgb(255, 0, 51)")`)));
  await shot("v02-phone-controls");

  // ---------- Settings: Quality ----------
  await tap(label("Settings"), 700);
  const menuText = await text();
  check("Settings sheet has Quality, Playback speed, Loop, Stats", ["Quality", "Playback speed", "Loop video", "Stats for nerds"].every((t) => menuText.includes(t)));
  check("Quality says Auto (with the playing resolution)", /Auto \(\d+p\)/.test(menuText), (menuText.match(/Auto[^\n]*/) || [""])[0]);
  await shot("v03-phone-settings");
  await tap(btn("Quality"), 600);
  const qText = await text();
  const rungs = main.info.ladder.map((r) => `${r.q}p`);
  check("Quality list shows every rung, Original and Auto", rungs.every((r) => qText.includes(r)) && qText.includes("Original") && qText.includes("Auto"), rungs.join(", "));
  await shot("v04-phone-quality");
  await js(`history.back()`);
  await sleep(600);
  const afterBack = await text();
  check("Phone Back closes only the menu", !afterBack.includes("Playback speed") && !afterBack.includes("360p") && (await js(`Boolean(document.querySelector("video"))`)), JSON.stringify(afterBack.slice(0, 160)));

  // Pick the lowest quality: keeps the position, picture becomes that size.
  const low = main.info.ladder.at(-1).q;
  await showControls();
  await tap(label("Settings"), 600);
  await tap(btn("Quality"), 600);
  const before = await V("currentTime");
  await tap(btn(`${low}p`), 3500);
  const short = await js(`Math.min(document.querySelector("video").videoWidth, document.querySelector("video").videoHeight)`);
  check(`Choosing ${low}p plays ${low}p`, short === low, `${short}p`);
  check("…and carries on from the same moment", (await V("currentTime")) >= before - 1);

  // Original: the exact file, from the same moment.
  await showControls();
  await tap(label("Settings"), 600);
  await tap(btn("Quality"), 600);
  const beforeOrig = await V("currentTime");
  await tap(btn("Original"), 4000);
  const osrc = await V("currentSrc");
  check("Original plays the untouched file", String(osrc).includes("/api/files"), String(osrc).slice(0, 60));
  check("…from the same moment", (await V("currentTime")) >= beforeOrig - 1, `${beforeOrig.toFixed(1)} → ${(await V("currentTime")).toFixed(1)} s`);
  await showControls();
  await tap(label("Settings"), 600);
  await tap(btn("Quality"), 600);
  await tap(btn("Auto"), 3500);
  check("Back to Auto streams again", String(await V("currentSrc")).startsWith("blob:"));

  // ---------- Speed ----------
  await showControls();
  await tap(label("Settings"), 600);
  await tap(btn("Playback speed"), 600);
  await tap(btn("1.5"), 600);
  check("Playback speed 1.5×", (await V("playbackRate")) === 1.5);
  await js(`history.back()`);
  await sleep(400);
  await js(`document.querySelector("video").playbackRate = 1`);

  // ---------- Double-tap to skip, press and hold for 2× ----------
  await js(`document.querySelector("video").currentTime = 5`);
  await sleep(800);
  const s0 = await V("currentTime");
  await tapAt([350, 300], 60);
  await tapAt([350, 300], 900);
  const s1 = await V("currentTime");
  check("Double-tap right skips 10 s", s1 - s0 >= 9 && s1 - s0 <= 13, `${s0.toFixed(1)} → ${s1.toFixed(1)}`);
  await js(`document.querySelector("video").play()`);
  await sleep(1200);
  await touch("touchStart", [[195, 300]]);
  await sleep(900);
  const heldRate = await V("playbackRate");
  const pill = (await text()).includes("2x");
  await shot("v05-phone-hold-2x");
  await touch("touchEnd", []);
  await sleep(500);
  check("Press and hold plays at 2× (with the 2x label)", heldRate === 2 && pill, `rate ${heldRate}`);
  check("…and lets go back to normal", (await V("playbackRate")) === 1);
  check("Holding doesn't close or change the video", (await js(`Boolean(document.querySelector("video"))`)), JSON.stringify((await text()).slice(0, 160)) + " " + (await js("location.href")));

  // ---------- Seek bar: drag shows the preview picture ----------
  await showControls();
  const bar = await js(`(() => { const r = document.querySelector('[role=slider][aria-label=Seek]').getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; })()`);
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bar[0] + 10, y: bar[1], id: 0 }] });
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: bar[0] + bar[2] * 0.6, y: bar[1], id: 0 }] });
  await sleep(700);
  const preview = await js(`[...document.querySelectorAll("div")].some(d => d.style.backgroundImage.includes("storyboard.jpg"))`);
  await shot("v06-phone-scrub-preview");
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(1200);
  check("Dragging the bar shows the picture at that moment", preview);
  const after = await V("currentTime");
  check("Letting go jumps there", Math.abs(after - main.dur * 0.6) < 4, `${after.toFixed(1)} s of ${main.dur.toFixed(0)}`);
  const sb = await fetch(`${base}api/hls/${main.key}/storyboard.jpg`, { headers: { cookie: `media_session=${(await send("Network.getCookies", { urls: [base] })).cookies.find((c) => c.name === "media_session").value}` } });
  check("Preview pictures are served", sb.ok && sb.headers.get("content-type") === "image/jpeg");

  // ---------- Stats for nerds ----------
  await showControls();
  await tap(label("Settings"), 600);
  await tap(btn("Stats for nerds"), 1200);
  const st = await text();
  check("Stats for nerds shows connection, buffer and resolution", st.includes("Connection") && st.includes("Buffer health") && st.includes("Current res"));
  await shot("v07-phone-stats");
  await tap(label("Close stats"), 400);

  // ---------- Autoplay: Up next at the end, if the next item is a video ----------
  const nextIsVideo = await js(`Boolean(document.querySelector('[aria-label="Next"]'))`);
  await js(`(() => { const v = document.querySelector("video"); v.currentTime = v.duration - 0.5; v.play(); })()`);
  await sleep(2500);
  const endText = await text();
  if (/up next/i.test(endText)) {
    check("At the end: Up next with a countdown, Cancel and Play now", endText.includes("Cancel") && endText.includes("Play now"));
    await shot("v08-phone-up-next");
    await tap(btn("Cancel"), 500);
    check("Cancel stays on this video", !(await text()).includes("Up next"));
  } else {
    check("At the end: Replay button (next item isn't a video)", await js(`Boolean(document.querySelector('[aria-label="Replay"]'))`), JSON.stringify({ ended: await V("ended"), t: await V("currentTime"), d: await V("duration"), btns: await js(`[...document.querySelectorAll("[data-player] button")].map(b => b.getAttribute("aria-label") || b.textContent).join(", ")`), spin: await js(`Boolean(document.querySelector("[aria-label=Loading]"))`) }));
  }

  // ---------- Computer size: keyboard, hover preview, volume ----------
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 820, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "fine" }] });
  await send("Page.reload");
  await sleep(4500);
  await js(`${tileSel}?.scrollIntoView({ block: "center" })`);
  await sleep(500);
  const p = await pos(tileSel);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p[0], y: p[1], button: "left", clickCount: 1 });
  await sleep(4500);
  await js(`document.querySelector("video").currentTime = 2`);
  await sleep(800);
  const title = await js(`document.querySelector("header p")?.textContent`);
  await key("k");
  await sleep(500);
  check("k pauses", await V("paused"));
  await key("k");
  await sleep(500);
  check("k plays again", !(await V("paused")));
  let a = await V("currentTime");
  await key("l");
  await sleep(400);
  check("l skips 10 s", (await V("currentTime")) - a >= 9);
  a = await V("currentTime");
  await key("ArrowLeft", { code: "ArrowLeft", windowsVirtualKeyCode: 37 });
  await sleep(400);
  check("← goes back 5 s (and stays on this video)", a - (await V("currentTime")) >= 4 && (await js(`document.querySelector("header p")?.textContent`)) === title);
  await key("m");
  await sleep(300);
  check("m mutes", await V("muted"));
  await key("m");
  await key(">");
  await sleep(300);
  check("> speeds up", (await V("playbackRate")) === 1.25);
  await key("<");
  await key("0");
  await sleep(500);
  check("0 jumps to the start", (await V("currentTime")) < 1.5);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 683, y: 400 });
  await sleep(300);
  check("Computer layout: play button, volume slider, time in the bar", await js(`Boolean(document.querySelector('[aria-label^="Pause (k)"], [aria-label^="Play (k)"]') && document.querySelector('input[aria-label=Volume]'))`), await js(`[...document.querySelectorAll("[data-player] button")].map(b => b.getAttribute("aria-label")).join(", ")`));
  const hb = await js(`(() => { const r = document.querySelector('[role=slider][aria-label=Seek]').getBoundingClientRect(); return [r.left + r.width * 0.4, r.top + r.height / 2]; })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hb[0], y: hb[1] });
  await sleep(500);
  check("Hovering the bar shows the preview picture", await js(`[...document.querySelectorAll("div")].some(d => d.style.backgroundImage.includes("storyboard.jpg"))`));
  await shot("v09-desktop-hover-preview");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 683, y: 300 });
  await tap(label("Settings"), 600);
  await shot("v10-desktop-settings");
  await key("Escape");
  if (await js(`Boolean(document.querySelector('[aria-label="Next"]'))`)) {
    await key("N", { shiftKey: true, modifiers: 8 });
    await sleep(1200);
    check("Shift+N goes to the next item", (await js(`document.querySelector("header p")?.textContent`)) !== title || (await js(`location.search`)) !== "");
  }

  check("No page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  ws.close();
  proc.kill();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  proc.kill();
  process.exit(1);
});
