import { promises as fs } from "node:fs";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import { isAuthed, unauthorized } from "@/lib/auth";
import { resolveName } from "@/lib/media";

// GET ?dir=Goa Trip        -> the whole folder (with subfolders) as "Goa Trip.zip"
// GET ?p=a.mp4&p=b.jpg     -> just those files, as "Puneet Studios.zip"
// Streamed while it's being built (nothing is written to disk first). Files are stored
// without compression: photos and videos are already compressed, so it's fast and exact.
async function collect(dir, prefix, out) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith(".") || e.name.endsWith(".uploading")) continue;
    const full = path.join(dir, e.name);
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) await collect(full, name, out);
    else if (e.isFile()) out.push({ full, name });
  }
}

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;
  const entries = [];
  let zipName = "Puneet Studios";

  if (params.has("dir")) {
    const full = resolveName(params.get("dir"));
    const stat = full && (await fs.stat(full).catch(() => null));
    if (!stat?.isDirectory()) return Response.json({ error: "Folder not found" }, { status: 404 });
    zipName = path.basename(full);
    await collect(full, zipName, entries);
  } else {
    const names = new Set();
    for (const p of params.getAll("p").slice(0, 2000)) {
      const full = resolveName(p);
      const stat = full && (await fs.stat(full).catch(() => null));
      if (!stat) continue;
      if (stat.isDirectory()) await collect(full, path.basename(full), entries);
      else {
        // Two picked files can share a name (different folders): keep both.
        let name = path.basename(full);
        for (let i = 1; names.has(name); i++) name = `${path.parse(full).name} (${i})${path.extname(full)}`;
        names.add(name);
        entries.push({ full, name });
      }
    }
  }
  if (!entries.length) return Response.json({ error: "Nothing to download" }, { status: 404 });

  const archive = archiver("zip", { store: true });
  const out = new PassThrough();
  archive.on("error", (error) => out.destroy(error));
  archive.on("warning", () => {}); // e.g. a file deleted mid-way: skip it
  archive.pipe(out);
  for (const { full, name } of entries) archive.file(full, { name });
  archive.finalize();
  // Stop reading files if the phone cancels the download.
  request.signal.addEventListener("abort", () => archive.abort());

  return new Response(Readable.toWeb(out), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${zipName}.zip`)}`,
      "Cache-Control": "no-store",
    },
  });
}
