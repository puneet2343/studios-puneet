// Trip Planner phone walkthrough (headless Edge, Galaxy S25 size): creates a "zz-test" trip,
// adds a flight, a 3-night stay, an idea, bookings, expenses, checklist, an offline edit, then deletes it.
// Usage: node scripts/test-trip-planner.js . http://localhost:3000/ <screenshot folder>
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
const token = crypto.createHmac("sha256", `${env.APP_USERNAME}\n${env.APP_PASSWORD}`).update("media-session-v2").digest("hex");
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ps-trips-"));
const port = 9343;
const proc = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let count = 0;
const check = (label, ok, extra = "") => { count++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

// Trip dates: starting tomorrow, 4 days.
const d0 = new Date(); d0.setDate(d0.getDate() + 1);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (n) => { const d = new Date(d0); d.setDate(d.getDate() + n); return iso(d); };

(async () => {
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
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Network.setCookie", { name: "media_session", value: token, url: base });
  const touch = (type, pts) => send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const tap = async (sel, wait = 600) => {
    const pos = await js(`(() => { const el = ${sel}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
    if (!pos) return false;
    await touch("touchStart", [pos]); await touch("touchEnd", []);
    await sleep(wait);
    return true;
  };
  const back = async (wait = 800) => { await js("history.back()"); await sleep(wait); };
  const btn = (text) => `[...document.querySelectorAll("button, a")].find(b => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent)`;
  const btnHas = (text) => `[...document.querySelectorAll("button, a")].find(b => b.textContent.includes(${JSON.stringify(text)}) && b.offsetParent)`;
  const label = (l) => `document.querySelector('[aria-label=${JSON.stringify(l)}]')`;
  const dialog = () => js(`document.querySelector("[role=dialog]")?.querySelector("h2")?.textContent || ""`);
  const text = () => js("document.body.innerText");
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  // Type into the n-th text field in the open sheet whose label matches.
  const fill = (labelText, value, tag = "input") => js(`(() => {
    const l = [...document.querySelectorAll("[role=dialog] label")].find(l => l.querySelector("span")?.textContent.trim() === ${JSON.stringify(labelText)});
    const el = l?.querySelector(${JSON.stringify(tag)});
    if (!el) return false;
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    return true;
  })()`);
  const tabTo = (name) => tap(`[...document.querySelectorAll("header button")].find(b => b.textContent.trim() === ${JSON.stringify(name)})`, 700);
  const serverTrip = async () => {
    const list = await (await fetch(`${base}api/plans`, { headers: { cookie: `media_session=${token}` } })).json();
    const t = list.trips.find((x) => x.name === "zz-test Goa trip");
    return t ? (await (await fetch(`${base}api/plans?id=${t.id}`, { headers: { cookie: `media_session=${token}` } })).json()).trip : null;
  };

  await send("Page.navigate", { url: base + "trips" });
  await sleep(3500);
  check("Trips page opens from the bottom tab", (await js("location.pathname")) === "/trips" && (await text()).includes("Trips"));
  await shot("01-trips-list");

  // ---- Create a trip ----
  await tap(btn("New trip"));
  check("New trip sheet opens", (await dialog()) === "New trip");
  await back();
  check("Back closes the New trip sheet only", (await dialog()) === "" && (await js("location.pathname")) === "/trips");
  await tap(btn("New trip"));
  await fill("Trip name", "zz-test Goa trip");
  await fill("Destination", "North Goa");
  await fill("Starts", day(0));
  await fill("Ends", day(3));
  await fill("Budget (optional)", "30000");
  await js(`(() => { const i = [...document.querySelectorAll("[role=dialog] input")].find(x => x.placeholder === "Friend's name"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Rahul"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await tap(label("Add person"), 300);
  await shot("02-new-trip-form");
  await tap(btn("Create trip"), 2500);
  check("Trip created and opened", (await text()).includes("zz-test Goa trip") && (await text()).includes("Overview"));
  check("Countdown shows 'Tomorrow'", (await text()).includes("Tomorrow"));
  await shot("03-overview-new");

  // ---- Plan: add a flight ----
  await tabTo("Plan");
  check("Plan tab shows 4 days", (await js(`[...document.querySelectorAll("section h3")].filter(h => /^Day \\d/.test(h.textContent)).length`)) === 4);
  await tap(label("Add to plan"), 700);
  check("Add sheet opens", (await dialog()).startsWith("Add"));
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Transport")`, 400);
  await fill("From", "Delhi");
  await fill("To", "Goa");
  await fill("Departs", day(0), "select");
  await fill("At", "07:10");
  await fill("Airline & flight no.", "IndiGo 6E 2134");
  await fill("PNR", "ABC123");
  await fill("Seat / berth", "14C");
  await fill("Cost", "6500");
  await shot("04-add-flight");
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Add")`, 900);
  check("Flight appears on Day 1", (await js(`document.getElementById("day-${day(0)}")?.innerText.includes("Delhi → Goa")`)) === true);

  // ---- Plan: add a 3-night stay ----
  await tap(label("Add to plan"), 700);
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Stay")`, 400);
  await fill("Hotel / stay", "Zostel Anjuna");
  await fill("Address", "Anjuna, Goa");
  await fill("Check-in", day(0), "select");
  await fill("Check-out", day(3), "select");
  await fill("Confirmation no.", "BKG-209344");
  await fill("Total cost", "9000");
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Add")`, 900);
  const stayDays = await js(`[${[0, 1, 2, 3].map((n) => `document.getElementById("day-${day(n)}")?.innerText.includes("Zostel")`).join(",")}]`);
  check("Stay shows on every night (check-in → staying → check-out)", stayDays.every(Boolean), JSON.stringify(stayDays));
  check("Check-out shown on the last day", (await js(`document.getElementById("day-${day(3)}")?.innerText.includes("Check-out")`)) === true);
  await shot("05-plan-days");

  // ---- Add an idea ----
  await tap(btnHas("Add idea"), 700);
  await fill("Place or activity", "Chapora Fort sunset shoot");
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Add")`, 900);
  check("Idea lands in the Ideas list", (await text()).includes("Chapora Fort sunset shoot"));

  // ---- Bookings ----
  await tabTo("Bookings");
  check("Bookings: both in 'To book'", (await js(`[...document.querySelectorAll("section")].find(s => s.querySelector("h3")?.textContent.startsWith("To book"))?.querySelectorAll("li").length`)) === 2);
  check("PNR shown with copy button", (await text()).includes("ABC123") && (await js(`Boolean(document.querySelector('[aria-label="Copy booking number"]'))`)));
  await tap(btn("Mark booked"), 800);
  check("Mark booked moves it to Booked", (await js(`[...document.querySelectorAll("section")].find(s => s.querySelector("h3")?.textContent.startsWith("Booked"))?.querySelectorAll("li").length`)) === 1);
  await shot("06-bookings");

  // Edit the stay: mark paid -> becomes an expense
  await tap(`[...document.querySelectorAll("li button")].find(b => b.textContent.includes("Zostel Anjuna"))`, 900);
  check("Tap a booking opens it for editing", (await dialog()) === "Stay");
  await back();
  check("Back closes the edit sheet only", (await dialog()) === "" && (await text()).includes("Bookings"));
  await tap(`[...document.querySelectorAll("li button")].find(b => b.textContent.includes("Zostel Anjuna"))`, 900);
  await js(`(() => { const c = [...document.querySelectorAll("[role=dialog] input[type=checkbox]")][0]; c.click(); })()`);
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Save")`, 900);

  // ---- Money ----
  await tabTo("Money");
  check("Paid stay became an expense", (await text()).includes("from plan") && (await text()).includes("9,000"));
  await tap(btn("Add expense"), 700);
  check("Add expense sheet", (await dialog()) === "Add expense");
  await fill("Amount", "1800");
  await fill("What for", "Dinner at Thalassa");
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Rahul")`, 300); // paid by Rahul
  await shot("07-add-expense");
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Add")`, 900);
  const money = await text();
  check("Total spent = 10,800", money.includes("10,800"));
  check("Category breakdown shows Stay and Food", /by category/i.test(money) && money.includes("Food & drinks"));
  // Puneet paid 9000 split 2 -> Rahul owes 4500; Rahul paid 1800 split 2 -> Puneet owes 900 => Rahul pays Puneet 3600
  check("Settle up: Rahul pays Puneet ₹3,600", /Rahul\s*pays\s*Me\s*₹3,600|Rahul pays Me₹3,600/.test(money.replace(/\n/g, " ")) || money.includes("3,600"), money.match(/Settle up[\s\S]{0,120}/)?.[0]?.replace(/\n/g, " | "));
  await shot("08-money");

  // ---- Checklist ----
  await tabTo("Checklist");
  await tap(`[...document.querySelectorAll("button")].filter(b => b.textContent.trim() === "Use starter list")[0]`, 700);
  const packed = await js(`document.querySelectorAll("main ul li").length`);
  check("Starter packing list added", packed >= 8, `${packed} items`);
  await tap(`document.querySelector("main ul li button")`, 500);
  check("Ticking an item updates progress", (await text()).includes(`1 of ${packed} done`));
  await shot("09-checklist");

  // ---- Offline edit, then sync ----
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await tap(`[...document.querySelectorAll("main ul li button")][2]`, 1800);
  check("Offline: shows 'will sync'", (await text()).includes("Offline · will sync") || (await text()).includes("Couldn't save"));
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await js(`window.dispatchEvent(new Event("online"))`);
  await sleep(3000);
  check("Back online: saved", (await text()).includes("Saved"));
  const st = await serverTrip();
  check("PC has the offline change", st && st.checklist.filter((c) => c.done).length === 2, st ? `${st.checklist.filter((c) => c.done).length} ticked on PC` : "no trip");
  check("PC has everything", st && st.items.length === 3 && st.expenses.length === 2 && st.travellers.length === 2);

  // ---- Overview & back to list ----
  await tabTo("Overview");
  await shot("10-overview-filled");
  check("Overview shows Next up", /next up/i.test(await text()));
  await back(1200);
  check("Back from the trip returns to the list", (await js(`Boolean(document.querySelector('[aria-label="Back to trips"]'))`)) === false && (await text()).includes("zz-test Goa trip"));
  await sleep(1200);
  const card = await js(`[...document.querySelectorAll("li")].find(li => li.textContent.includes("zz-test Goa trip"))?.innerText || ""`);
  check("After Back, the trip card shows the latest numbers", card.includes("10,800") && card.includes("3 in the plan"), card.split("\n").join(" | "));
  await shot("11-trips-list-filled");

  // ---- Delete + Undo ----
  await tap(btnHas("zz-test Goa trip"), 2000);
  await tap(label("Trip options"), 500);
  await tap(btnHas("Delete trip"), 600);
  check("Delete asks first", (await dialog()).startsWith("Delete"));
  await tap(`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Delete trip")`, 1800);
  check("Trip deleted, back on the list", !(await text()).includes("zz-test Goa trip") || (await text()).includes("Deleted"));
  await tap(btn("Undo"), 1800);
  check("Undo restores the trip", (await text()).includes("zz-test Goa trip"));

  check("No page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(failures ? `\n${failures} FAILED of ${count}` : `\nALL ${count} PASSED`);

  // clean up
  const left = await serverTrip();
  if (left) {
    const del = await (await fetch(`${base}api/plans?id=${left.id}`, { method: "DELETE", headers: { cookie: `media_session=${token}` } })).json();
    const dir = path.join(process.env.USERPROFILE, "Desktop", "Phone Media", ".trips", ".deleted");
    for (const n of fs.readdirSync(dir)) if (n.includes(left.id)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
  }
  ws.close();
  proc.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
