// Saves a Claude Code session transcript (.jsonl) into ONE shared history file.
// Every session gets its own section; re-running only refreshes that session's
// section, so past chats in the file are never touched.
// Usage: node scripts/save-history.js <transcript.jsonl> [history/chat-history.md]
const fs = require("fs");
const path = require("path");

const src = process.argv[2];
const out = process.argv[3] || path.join(__dirname, "..", "history", "chat-history.md");
if (!src) {
  console.error("Usage: node scripts/save-history.js <transcript.jsonl> [output.md]");
  process.exit(1);
}

const HEADER =
  "# Chat history — Puneet Studios\n\nAll conversations between Puneet and Claude Code in this project, oldest first.\n" +
  "Passwords and secrets are replaced with `[REDACTED]`. Tool steps are summarised as one line each.\n";

const time = (ts) =>
  new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

// Hide passwords, tokens and keys before anything is written to disk.
const redact = (s) =>
  s
    .replace(/((?:password|passwd|pass|token|secret|api[_-]?key)\w*["']?\s*[:=]\s*["']?)[^\s"',]+/gi, "$1[REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{10,}|tskey-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,})/g, "[REDACTED]");

const isNoise = (t) => !t.trim() || /^\s*<(system-reminder|command-|local-command)/.test(t);

const entries = fs
  .readFileSync(src, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  })
  .filter((e) => e && (e.type === "user" || e.type === "assistant") && e.message && !e.isMeta);

const first = entries[0] ? new Date(entries[0].timestamp) : new Date();
const day = first.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

let body = `## Session — ${day}\n\n_Auto-saved · last saved ${time(Date.now())}_\n`;
let speaker = null;
for (const e of entries) {
  const c = e.message.content;
  const parts = typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : [];
  const lines = [];
  for (const p of parts) {
    if (p.type === "text" && !isNoise(p.text)) lines.push(redact(p.text.trim()));
    else if (p.type === "tool_use" && e.type === "assistant") {
      const what = (p.input && (p.input.description || p.input.file_path || p.input.pattern)) || "";
      lines.push(`> 🔧 *${p.name}* — ${redact(String(what))}`);
    }
  }
  if (!lines.length) continue;
  const who = e.type === "user" ? "🧑 Puneet" : "🤖 Claude";
  if (who !== speaker) {
    if (speaker === "🤖 Claude") body += "\n---\n";
    body += `\n### ${who} · ${time(e.timestamp)}\n\n`;
    speaker = who;
  }
  body += lines.join("\n\n") + "\n\n";
}

// Replace this session's section if it exists, otherwise append it at the end.
const id = path.basename(src, ".jsonl");
const start = `<!-- session:${id} start -->`;
const end = `<!-- session:${id} end -->`;
const block = `${start}\n${body.trimEnd()}\n${end}`;

let doc = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : HEADER;
const i = doc.indexOf(start);
const j = doc.indexOf(end);
doc = i !== -1 && j > i
  ? doc.slice(0, i) + block + doc.slice(j + end.length)
  : doc.trimEnd() + "\n\n" + block + "\n";

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, doc);
console.log(`Saved session ${id} to ${out}`);
