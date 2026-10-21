// Runs the app and keeps it up to date: whenever code changes, it rebuilds in the
// background and switches over once the new build is ready. Phones pick the new
// version up automatically (see useAutoUpdate in components/AppShell.js).
//
// Two build folders take turns (.next and .next-b): the app keeps running from one
// while the next version builds in the other, so a broken change never takes it down.
//
// Clicking inside a Command Prompt window puts it in "select" mode, which freezes any
// program writing to it. So after the opening message nothing is printed to the window:
// live status goes to the window title (and scripts/serve.log), app output to scripts/app.log.
//
// Usage: node scripts/serve.js   (or double-click "Start Puneet Studios")
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || "3000";
const ROOT = path.resolve(__dirname, "..");
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const SLOTS = [".next", ".next-b"];
const WATCH_DIRS = ["app", "components", "lib", "public"];
const WATCH_FILES = ["next.config.mjs", "package.json", ".env.local"];
const LOG = path.join(__dirname, "serve.log");
const APP_LOG = path.join(__dirname, "app.log");

let server = null;
let stopping = false;
let active = null;
let building = false;
let pending = false;
let debounce = null;
let appLog = null;
let title = "Puneet Studios";

function log(message, status) {
  const time = new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  fs.appendFileSync(LOG, `[${time}] ${message}\n`);
  if (status) {
    title = `Puneet Studios — ${status} (${time})`;
    process.title = title;
  }
}

const buildIdTime = (slot) => {
  try {
    return fs.statSync(path.join(ROOT, slot, "BUILD_ID")).mtimeMs;
  } catch {
    return 0;
  }
};

function newestSource() {
  let newest = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  for (const d of WATCH_DIRS) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  for (const f of WATCH_FILES) if (fs.existsSync(path.join(ROOT, f))) newest = Math.max(newest, fs.statSync(path.join(ROOT, f)).mtimeMs);
  return newest;
}

function start(slot) {
  stopping = false;
  active = slot;
  server = spawn(process.execPath, [NEXT, "start", "-p", PORT], {
    cwd: ROOT,
    env: { ...process.env, PS_DIST_DIR: slot },
    stdio: ["ignore", appLog, appLog],
  });
  server.on("exit", (code) => {
    server = null;
    if (stopping) return;
    log(`App stopped unexpectedly (code ${code}). Restarting in 3 seconds…`, "restarting…");
    setTimeout(() => !server && start(active), 3000);
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    stopping = true;
    server.once("exit", () => resolve());
    // Windows: end the whole process tree, not just the top process.
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  });
}

function build(slot) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [NEXT, "build"], {
      cwd: ROOT,
      env: { ...process.env, PS_DIST_DIR: slot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("exit", (code) => {
      if (code !== 0) {
        const lines = output.split(/\r?\n/).filter((l) => /error|failed|×|⨯/i.test(l)).slice(0, 15);
        log(
          "Build FAILED — still running the previous version. Details:\n  " + (lines.join("\n  ") || output.slice(-1500)),
          "running ✓ · last change has an error (see scripts\\serve.log)"
        );
      }
      resolve(code === 0);
    });
  });
}

async function rebuild(reason) {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  const target = SLOTS.find((s) => s !== active);
  log(`${reason} — building the new version…`, "running ✓ · updating…");
  const started = Date.now();
  const ok = await build(target);
  if (ok) {
    await stop();
    start(target);
    log(`✓ Updated in ${Math.round((Date.now() - started) / 1000)}s. Phones refresh automatically.`, "running ✓ · updated");
  }
  building = false;
  if (pending) {
    pending = false;
    rebuild("More changes");
  }
}

function onChange(file) {
  if (!file || /(^|[\\/])\.|~$|\.tmp$|\.log$/.test(file)) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => rebuild(`Code changed (${file.replaceAll("\\", "/")})`), 2000);
}

async function main() {
  fs.writeFileSync(LOG, "");
  appLog = fs.openSync(APP_LOG, "w");
  console.log("");
  console.log("  Puneet Studios is starting.");
  console.log("");
  console.log("  - Keep this window open. Minimize it, don't close it.");
  console.log("  - Live status is shown in this window's title (hover it in the taskbar).");
  console.log("  - Code changes are picked up automatically; phones update by themselves.");
  console.log("  - Clicked inside this window by mistake? Press Esc.");
  console.log("");

  // Run whichever build is newest; build one first if there's none.
  active = SLOTS.filter(buildIdTime).sort((a, b) => buildIdTime(b) - buildIdTime(a))[0];
  if (!active) {
    log("No build yet — building (about a minute)…", "first-time build…");
    if (!(await build(SLOTS[0]))) process.exit(1);
    active = SLOTS[0];
  }
  start(active);
  log(`App running on port ${PORT}. Watching for code changes…`, "running ✓");
  // Next.js sets its own window title on start; keep ours on top.
  setInterval(() => (process.title = title), 3000);

  for (const d of WATCH_DIRS) {
    if (fs.existsSync(path.join(ROOT, d))) fs.watch(path.join(ROOT, d), { recursive: true }, (_, f) => onChange(f && `${d}/${f}`));
  }
  for (const f of WATCH_FILES) {
    if (fs.existsSync(path.join(ROOT, f))) fs.watch(path.join(ROOT, f), () => onChange(f));
  }

  // Code changed while the app was off (e.g. edited before a restart): catch up now.
  if (newestSource() > buildIdTime(active)) rebuild("Code is newer than the running version");
}

process.on("SIGINT", async () => {
  await stop();
  process.exit(0);
});

main();
