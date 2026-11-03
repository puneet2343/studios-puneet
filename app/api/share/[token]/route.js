import { PassThrough, Readable } from "node:stream";
import { createReadStream, promises as fs } from "node:fs";
import archiver from "archiver";
import { logoSvg } from "@/lib/logo";
import { mimeType } from "@/lib/media";
import { serveFile } from "@/lib/serve-file";
import { openShare } from "@/lib/shares";
import { getThumb } from "@/lib/thumbs";

// A shared album, for people with the link (no login). Everything comes from this one route:
//   /api/share/<token>                 the page
//   ?f=<name>&thumb=1                  a small preview
//   ?f=<name>                          the original, untouched (?dl=1 to save it)
//   ?zip=1                             every original in one .zip (stored, not recompressed)
const NO_INDEX = { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

const gone = () =>
  new Response(page("Link not available", `<div class="empty"><h1>This link isn't available</h1><p>It may have expired, or the owner stopped sharing it.</p></div>`), {
    status: 404,
    headers: { ...NO_INDEX, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function GET(request, ctx) {
  const { token } = await ctx.params;
  const share = await openShare(token);
  if (!share) return gone();
  const q = request.nextUrl.searchParams;

  if (q.has("zip")) {
    const archive = archiver("zip", { store: true });
    const out = new PassThrough();
    archive.on("error", (e) => out.destroy(e));
    archive.on("warning", () => {});
    archive.pipe(out);
    for (const f of share.files) archive.file(f.full, { name: `${share.title}/${f.name}` });
    archive.finalize();
    request.signal.addEventListener("abort", () => archive.abort());
    return new Response(Readable.toWeb(out), {
      headers: {
        ...NO_INDEX,
        "Content-Type": "application/zip",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${share.title}.zip`)}`,
      },
    });
  }

  if (q.has("f")) {
    const file = share.file(q.get("f"));
    if (!file) return new Response(null, { status: 404 });
    if (q.has("thumb")) {
      const thumb = await getThumb(file.full, file.stat);
      if (!thumb) return new Response(null, { status: 404 });
      const { size } = await fs.stat(thumb);
      return new Response(Readable.toWeb(createReadStream(thumb)), {
        headers: { ...NO_INDEX, "Content-Type": "image/webp", "Content-Length": String(size), "Cache-Control": "private, max-age=86400" },
      });
    }
    return serveFile(request, file.full, file.size, {
      ...NO_INDEX,
      "Content-Type": mimeType(file.name),
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${q.has("dl") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    });
  }

  const total = share.files.reduce((s, f) => s + f.size, 0);
  const items = share.files.map((f) => ({ n: f.name, v: f.kind === "video" }));
  const until = share.expires ? ` · link works until ${new Date(share.expires).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "";
  const body = `
<header>
  <div class="brand">${logoSvg({ size: 30, id: "sh" })}<span>Puneet Studios</span></div>
  <h1>${esc(share.title)}</h1>
  <p class="sub">${share.files.length} item${share.files.length === 1 ? "" : "s"} · ${size(total)}${until}</p>
  ${share.files.length ? `<a class="btn" href="?zip=1">Download all · original quality</a>` : ""}
</header>
<main id="grid">${share.files.length ? "" : `<div class="empty"><p>This album is empty.</p></div>`}</main>
<div id="box" hidden>
  <div class="bar"><button id="x" aria-label="Close">&#x2715;</button><span id="nm"></span><a id="dl" class="btn small">Download</a></div>
  <div id="stage"></div>
  <button id="pv" class="nav" aria-label="Previous">&#x2039;</button><button id="nx" class="nav r" aria-label="Next">&#x203A;</button>
</div>
<script>${SCRIPT.replace("__ITEMS__", JSON.stringify(items).replace(/</g, "\\u003c"))}</script>`;
  return new Response(page(share.title, body), { headers: { ...NO_INDEX, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

// The page's own little viewer: grid of previews, tap for the original, swipe or arrows to move.
const SCRIPT = `
const items = __ITEMS__;
const u = (n, extra) => "?f=" + encodeURIComponent(n) + (extra || "");
const grid = document.getElementById("grid"), box = document.getElementById("box"), stage = document.getElementById("stage");
items.forEach((it, i) => {
  const b = document.createElement("button");
  b.className = "tile";
  const img = document.createElement("img");
  img.loading = "lazy"; img.alt = ""; img.src = u(it.n, "&thumb=1");
  b.appendChild(img);
  if (it.v) { const p = document.createElement("span"); p.className = "play"; p.textContent = "\\u25B6"; b.appendChild(p); }
  b.onclick = () => show(i);
  grid.appendChild(b);
});
let cur = -1;
function show(i) {
  if (i < 0 || i >= items.length) return;
  cur = i;
  const it = items[i];
  stage.innerHTML = "";
  const el = document.createElement(it.v ? "video" : "img");
  if (it.v) { el.controls = true; el.autoplay = true; el.playsInline = true; }
  el.src = u(it.n);
  stage.appendChild(el);
  document.getElementById("nm").textContent = it.n;
  document.getElementById("dl").href = u(it.n, "&dl=1");
  box.hidden = false;
  document.body.style.overflow = "hidden";
}
function close() { box.hidden = true; stage.innerHTML = ""; document.body.style.overflow = ""; cur = -1; }
document.getElementById("x").onclick = close;
document.getElementById("pv").onclick = () => show(cur - 1);
document.getElementById("nx").onclick = () => show(cur + 1);
addEventListener("keydown", (e) => { if (cur < 0) return; if (e.key === "Escape") close(); if (e.key === "ArrowLeft") show(cur - 1); if (e.key === "ArrowRight") show(cur + 1); });
let sx = null;
stage.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
stage.addEventListener("touchend", (e) => { if (sx === null) return; const d = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(d) > 60) show(cur + (d < 0 ? 1 : -1)); });
`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function size(b) {
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
}
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Puneet Studios</title>
<style>
:root{--bg:#fff;--fg:#18181b;--mute:#71717a;--tile:#f4f4f5;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0f;--fg:#f4f4f5;--mute:#a1a1aa;--tile:#1c1c22;--accent:#6d66f5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{max-width:1100px;margin:0 auto;padding:20px 16px 16px}.brand{display:flex;align-items:center;gap:8px;color:var(--mute);font-size:13px;font-weight:600}
h1{margin:14px 0 2px;font-size:28px;line-height:1.15}.sub{margin:0 0 14px;color:var(--mute);font-size:13px}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;border-radius:999px;padding:10px 18px;font-size:14px}.btn.small{padding:7px 14px;font-size:13px}
main{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding-bottom:40px}
@media(min-width:640px){main{grid-template-columns:repeat(5,1fr);gap:4px;padding:0 16px 40px}}
.tile{position:relative;aspect-ratio:1;border:0;padding:0;background:var(--tile);cursor:pointer;overflow:hidden}.tile img{width:100%;height:100%;object-fit:cover;display:block}
.play{position:absolute;right:6px;top:6px;background:rgba(0,0,0,.55);color:#fff;border-radius:999px;font-size:10px;padding:3px 7px}
.empty{grid-column:1/-1;text-align:center;padding:60px 16px;color:var(--mute)}.empty h1{color:var(--fg);font-size:22px}
#box{position:fixed;inset:0;background:#000;z-index:10;display:flex;flex-direction:column}#box[hidden]{display:none}
.bar{display:flex;align-items:center;gap:10px;padding:10px 12px;padding-top:max(10px,env(safe-area-inset-top));color:#fff}
.bar span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;opacity:.8}
#x{background:none;border:0;color:#fff;font-size:20px;width:40px;height:40px;cursor:pointer}
#stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}#stage img,#stage video{max-width:100%;max-height:100%;object-fit:contain}
.nav{position:absolute;top:50%;left:8px;transform:translateY(-50%);background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:999px;width:44px;height:44px;font-size:28px;cursor:pointer}.nav.r{left:auto;right:8px}
@media(hover:none){.nav{display:none}}
</style></head><body>${body}</body></html>`;
}
