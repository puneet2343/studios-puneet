// Real offline test: the phone talks to the app through a switchable proxy (port 3100).
// "Signal off" = the proxy refuses every connection, like no network in the mountains.
// Usage: node scripts/test-trip-offline.js . <screenshot folder>   (needs the app running on port 3000)
const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const crypto = require("crypto");
const { spawn } = require("child_process");

const [projectDir, outDir] = process.argv.slice(2);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const env = Object.fromEntries(
  fs.readFileSync(path.join(projectDir, ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const token = crypto.createHmac("sha256", `${env.APP_USERNAME}\n${env.APP_PASSWORD}`).update("media-session-v2").digest("hex");
const API = "http://localhost:3000/";
const base = "http://localhost:3100/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Switchable proxy
let signal = true;
const sockets = new Set();
const proxy = net.createServer((client) => {
  if (!signal) return client.destroy();
  const up = net.connect(3000, "127.0.0.1");
  sockets.add(client); sockets.add(up);
  client.pipe(up); up.pipe(client);
  const end = () => { client.destroy(); up.destroy(); sockets.delete(client); sockets.delete(up); };
  client.on("error", end); up.on("error", end); client.on("close", end); up.on("close", end);
});
const setSignal = (on) => { signal = on; if (!on) for (const s of sockets) s.destroy(); };

const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ps-off-"));
const port = 9349;
let proc;
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const apiGet = async (p) => (await fetch(API + p, { headers: { cookie: `media_session=${token}` } })).json();

(async () => {
  await new Promise((r) => proxy.listen(3100, "127.0.0.1", r));
  // A trip made on the PC that this phone has never opened.
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const created = await (await fetch(API + "api/plans", { method: "POST", headers: { "content-type": "application/json", cookie: `media_session=${token}` }, body: JSON.stringify({ trip: { name: "zz-test Offline Ladakh", startDate: day(-1), endDate: day(3), travellers: [{ id: "a", name: "Me" }, { id: "b", name: "Rahul" }] } }) })).json();
  const tripId = created.trip.id;

  proc = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
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
  await send("Network.setCookie", { name: "media_session", value: token, url: base });
  const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const tap = async (sel, wait = 600) => {
    const pos = await js(`(() => { const el = ${sel}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
    if (!pos) { console.log("   ! could not find", sel.slice(0, 100)); return false; }
    await touch("touchStart", [pos]); await touch("touchEnd", []);
    await sleep(wait);
    return true;
  };
  const text = () => js("document.body.innerText");
  const shot = async (n) => fs.writeFileSync(path.join(outDir, n + ".png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const fill = (labelText, value) => js(`(() => {
      const l = [...document.querySelectorAll("[role=dialog] label")].find(l => l.querySelector("span")?.textContent.trim() === ${JSON.stringify(labelText)});
      const el = l?.querySelector("input, textarea");
      if (!el) return false;
      Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  const addExpense = async (amount, title) => {
    await tap(`document.querySelector("button[aria-label='Add expense']")`, 700);
    await fill("Amount", String(amount));
    await fill("What for", title);
    await tap(`[...document.querySelector("[role=dialog]").querySelectorAll("button")].find(b => b.textContent.trim() === "Add")`, 900);
  };
  const openTrip = () => tap(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("zz-test Offline Ladakh"))`, 2000);

  // 1. At home with signal: open the app once (home page only), as you would before leaving.
  // Only the home page is opened with signal (Trips never visited).
  await send("Page.navigate", { url: base });
  await sleep(12000);
  check("Online: trip stored on the phone in the background", await js(`!!localStorage.getItem("ps.trip.${tripId}")`));

  // 2. Signal gone. Fully close and reopen the app on the Trips page.
  setSignal(false);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  const t0 = Date.now();
  await send("Page.navigate", { url: base + "trips" });
  await sleep(6000);
  await shot("1-offline-reopen");
  const openedIn = Date.now() - t0;
  check("No signal: app opens on Trips", (await text()).includes("zz-test Offline Ladakh"), (await text()).slice(0, 120).replace(/\n/g, " | "));

  // 3. Open the trip that was never opened on this phone.
  await openTrip();
  await shot("2-offline-trip");
  const tripText = await text();
  check("No signal: never-opened trip opens", tripText.includes("Overview") && !/couldn.t|not found|error/i.test(tripText.slice(0, 400)), tripText.slice(0, 160).replace(/\n/g, " | "));

  // 4. Log expenses offline.
  await addExpense(320, "Maggi and chai at Pang");
  await addExpense(1500, "Petrol at Tandi");
  // Receipt photo with no signal
  const jpg = path.join(outDir, "receipt.jpg");
  fs.writeFileSync(jpg, Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
  await tap(`document.querySelector("button[aria-label='Add expense']")`, 700);
  await fill("Amount", "90");
  await fill("What for", "Toll receipt");
  const doc = await send("DOM.getDocument", {});
  const node = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "[role=dialog] input[type=file]" });
  await send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [jpg] });
  await sleep(1500);
  check("Offline receipt kept on the phone", /waiting to upload/i.test(await text()));
  await tap(`[...document.querySelector("[role=dialog]").querySelectorAll("button")].find(b => b.textContent.trim() === "Add")`, 900);
  // Meanwhile someone edits the same trip on the PC.
  const pcNow = (await apiGet(`api/plans?id=${tripId}`)).trip;
  await fetch(API + `api/plans?id=${tripId}`, { method: "PUT", headers: { "content-type": "application/json", cookie: `media_session=${token}` }, body: JSON.stringify({ rev: pcNow.rev, trip: { ...pcNow, expenses: [...pcNow.expenses, { id: "pcadd1", title: "Added on the PC", amount: 777, category: "other", date: day(0), paidBy: "a", splitWith: ["a", "b"], method: "cash" }] } }) });
  await shot("3-offline-expenses");
  const st = await text();
  check("Shows 'Offline · will sync'", /will sync/i.test(st));

  // 5. Phone kills the app; reopen, still no signal.
  await send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await send("Page.navigate", { url: base + "trips" });
  await sleep(6000);
  await openTrip();
  await tap(`[...document.querySelectorAll("header button")].find(b => b.textContent.trim() === "Money")`, 800);
  const kept = await text();
  check("After closing the app: both expenses still there", kept.includes("Maggi and chai") && kept.includes("Petrol at Tandi"));
  await shot("4-offline-after-restart");

  // 6. Create a brand-new trip offline.
  await send("Page.navigate", { url: base + "trips" });
  await sleep(5000);
  if (await tap(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "New trip")`, 800)) {
    await fill("Trip name", "zz-test Offline new trip");
    await tap(`[...document.querySelector("[role=dialog]").querySelectorAll("button")].find(b => b.textContent.trim() === "Create trip")`, 2500);
    await shot("5-offline-new-trip");
    const nt = await text();
    check("No signal: can create a new trip", nt.includes("zz-test Offline new trip") && !/couldn.t create/i.test(nt), nt.slice(0, 200).replace(/\n/g, " | "));
    if (nt.includes("Add expense") || (await js(`!!document.querySelector("button[aria-label='Add expense'], button[aria-label='Add to plan']")`))) {
      await tap(`[...document.querySelectorAll("header button")].find(b => b.textContent.trim() === "Money")`, 800);
      await addExpense(200, "Parking at Leh");
    }
  }

  // 7. Signal back: everything reaches the PC.
  setSignal(true);
  await js("window.dispatchEvent(new Event('online'))");
  await sleep(20000);
  const pc = (await apiGet(`api/plans?id=${tripId}`)).trip;
  const titles = (pc?.expenses ?? []).map((e) => e.title);
  check("Back online: offline expenses reached the PC", titles.includes("Maggi and chai at Pang") && titles.includes("Petrol at Tandi") && titles.includes("Toll receipt"), titles.join(", "));
  check("PC's own change kept too (merged, nothing lost)", titles.includes("Added on the PC"));
  const rec = pc?.expenses.find((e) => e.title === "Toll receipt")?.receipt;
  const fileRes = rec ? await fetch(`${API}api/plans/files?trip=${tripId}&file=${rec}`, { headers: { cookie: `media_session=${token}` } }) : null;
  check("Offline receipt photo uploaded to the PC", fileRes?.ok === true, String(fileRes?.status));
  const list = (await apiGet("api/plans")).trips.map((t) => t.name);
  check("Back online: offline-created trip reached the PC", list.includes("zz-test Offline new trip"), list.join(", "));
  await shot("6-back-online");
  check("No page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(`(offline reopen took ~${Math.round(openedIn / 1000)}s incl. wait)`);

  // Clean up test trips (and their trash copies).
  for (const t of (await apiGet("api/plans")).trips.filter((t) => t.name.startsWith("zz-test"))) {
    await fetch(`${API}api/plans?id=${t.id}`, { method: "DELETE", headers: { cookie: `media_session=${token}` } });
  }
  const del = path.join(os.homedir(), "Desktop", "Phone Media", ".trips", ".deleted");
  for (const f of fs.existsSync(del) ? fs.readdirSync(del) : []) {
    if (!f.endsWith(".json")) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(del, f)));
      if (((d.trip || d).name || "").startsWith("zz-test")) { fs.rmSync(path.join(del, f)); fs.rmSync(path.join(del, f.slice(0, -5)), { recursive: true, force: true }); }
    } catch {}
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  ws.close(); proc.kill(); proxy.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
})().catch((e) => { console.error(e); proc?.kill(); process.exit(1); });
