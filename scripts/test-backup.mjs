// Strict test of the external-drive backup (lib/backup.js) through the app's API, using a
// folder as a pretend drive (.backup-test-root). Checks: full first backup is byte-for-byte
// identical (SHA-256 of every file), new files are added, deleted files are kept in
// versions\ (not destroyed), the safety brake stops a mass removal until confirmed, and a
// damaged file on the drive is caught by the check and copied again.
// Usage: node scripts/test-backup.mjs http://localhost:4600/ <pretend drive folder>
import crypto from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

const [base, driveRoot] = process.argv.slice(2);
const MEDIA = path.join(process.env.USERPROFILE, "Desktop", "Phone Media");
const B = path.join(driveRoot, "PSBackup");
let fails = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
  if (!ok) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (f) =>
  new Promise((res, rej) => {
    const h = crypto.createHash("sha256");
    createReadStream(f).on("data", (d) => h.update(d)).on("error", rej).on("end", () => res(h.digest("hex")));
  });

// The login comes from .env.local (never written in the code).
const env = Object.fromEntries(
  (await fs.readFile(".env.local", "utf8")).split(/?
/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")])
);
const login = await fetch(base + "api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: env.APP_USERNAME, password: env.APP_PASSWORD }) });
const H = { Cookie: login.headers.get("set-cookie").split(";")[0], "Content-Type": "application/json" };
const api = (body) => fetch(base + "api/backup", { method: body ? "POST" : "GET", headers: H, body: body && JSON.stringify(body) }).then((r) => r.json());
async function runAndWait(action = "run") {
  await api({ action });
  await sleep(1500);
  for (let i = 0; i < 600; i++) {
    const s = await api();
    if (!s.running) return s;
    await sleep(1000);
  }
  throw new Error("backup never finished");
}
async function walk(dir, out = [], rel = "") {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(full, out, r);
    else out.push({ rel: r, full });
  }
  return out;
}
const old = new Date(Date.now() - 10 * 60 * 1000); // "settled" files (not still arriving)

// 1. The pretend drive shows up; set it up.
let s = await api();
const drive = s.drives.find((d) => d.type === "Test");
check("Pretend drive is listed (and the PC's C: drive is not)", Boolean(drive) && !s.drives.some((d) => /^C:\\$/i.test(d.root)));
const setup = await api({ action: "setup", root: drive.root });
check("Drive set up with an ID file and a README", Boolean(setup.id) && Boolean(await fs.stat(path.join(B, ".puneet-backup-id.json")).catch(() => null)) && Boolean(await fs.stat(path.join(B, "README.txt")).catch(() => null)));

// 2. First full backup: every library file, identical.
const t0 = Date.now();
s = await runAndWait();
console.log(`      first backup: ${s.lastRun?.copied} files, ${(s.lastRun?.bytes / 1048576).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s; errors: ${s.lastRun?.errors?.length}`);
const lib = (await walk(MEDIA)).filter((f) => !/^\.(thumbs|trash|uploads|renditions)\//.test(f.rel) && !f.rel.startsWith(".meta/faces/") && !/\.(tmp|uploading)$/.test(f.rel));
let mismatched = 0;
let missing = 0;
for (const f of lib) {
  const copy = path.join(B, "current", ...f.rel.split("/"));
  if (!(await fs.stat(copy).catch(() => null))) {
    missing++;
    continue;
  }
  if (f.rel.startsWith(".meta/")) continue; // these change while the app runs
  if ((await sha(f.full)) !== (await sha(copy))) mismatched++;
}
check(`Every library file is on the drive (${lib.length} files)`, missing === 0, `${missing} missing`);
check("Every photo and video on the drive is byte-for-byte identical (SHA-256)", mismatched === 0, `${mismatched} differ`);
const st1 = await fs.stat(path.join(MEDIA, lib.find((f) => !f.rel.startsWith(".")).rel));
const st2 = await fs.stat(path.join(B, "current", ...lib.find((f) => !f.rel.startsWith(".")).rel.split("/")));
check("Copies keep the original's modified time", Math.abs(st1.mtimeMs - st2.mtimeMs) < 2);
check("Status says 2 copies, all safe", s.level === "green" && s.connected);

// 3. A new photo is added on the next run; nothing else is copied again.
const newFile = path.join(MEDIA, "zz-test-backup-new.jpg");
await fs.writeFile(newFile, crypto.randomBytes(300000));
await fs.utimes(newFile, old, old);
s = await runAndWait();
check("Next run copies only the new photo", s.lastRun.copied >= 1 && s.lastRun.copied <= 5, `copied ${s.lastRun.copied}`);
check("New photo on the drive, identical", (await sha(newFile)) === (await sha(path.join(B, "current", "zz-test-backup-new.jpg")).catch(() => "")));

// 4. Deleted from the library -> kept in versions\, not destroyed.
await fs.rm(newFile);
s = await runAndWait();
const day = new Date().toLocaleDateString("en-CA");
check("Deleted photo is set aside in versions\\ (not destroyed)", Boolean(await fs.stat(path.join(B, "versions", day, "zz-test-backup-new.jpg")).catch(() => null)) && !(await fs.stat(path.join(B, "current", "zz-test-backup-new.jpg")).catch(() => null)));

// 5. Safety brake: 60 files vanish at once -> pause until confirmed.
const dir = path.join(MEDIA, "zz-test-backup-bulk");
await fs.mkdir(dir, { recursive: true });
for (let i = 0; i < 60; i++) {
  const f = path.join(dir, `zz-test-${i}.jpg`);
  await fs.writeFile(f, crypto.randomBytes(2000));
  await fs.utimes(f, old, old);
}
s = await runAndWait();
await fs.rm(dir, { recursive: true });
s = await runAndWait();
check("Mass removal pauses for confirmation (safety brake)", Boolean(s.pendingConfirm) && (await walk(path.join(B, "current", "zz-test-backup-bulk"))).length === 60);
s = await runAndWait("confirm");
check("After confirming, the 60 files are set aside in versions\\", (await walk(path.join(B, "versions", day, "zz-test-backup-bulk"))).length === 60 && !s.pendingConfirm);

// 6. A file gets damaged on the drive -> the check catches it and copies it again.
const victim = lib.find((f) => !f.rel.startsWith(".") && /\.jpe?g$/i.test(f.rel));
const victimCopy = path.join(B, "current", ...victim.rel.split("/"));
const good = await sha(victim.full);
const buf = await fs.readFile(victimCopy);
buf[Math.floor(buf.length / 2)] ^= 0xff; // flip one byte, like a failing drive
await fs.writeFile(victimCopy, buf);
const st = await fs.stat(victim.full);
await fs.utimes(victimCopy, st.atime, st.mtime); // same size and time: only a content check can notice
s = await runAndWait("verify"); // "Check every file now"
check("Full check detects the damaged copy on the drive", s.lastRun.damaged === 1, `damaged ${s.lastRun.damaged}`);
check("…and replaces it with a good copy straight away", (await sha(victimCopy)) === good && s.lastRun.repaired === 1);

console.log(`\n${fails ? `${fails} FAILED` : "ALL PASSED"}`);
process.exit(fails ? 1 : 0);
