import { promises as fs } from "node:fs";
import { isAuthed, unauthorized } from "@/lib/auth";
import { fileKey, kindOf, resolveName } from "@/lib/media";
import { QUALITIES, ensureRendition, renditionPath, renditionStatus } from "@/lib/renditions";
import { serveFile } from "@/lib/serve-file";

// Lighter playback copies for the player's quality menu.
// GET ?name=…&status=1  -> which qualities exist for this video and how far along they are
// POST { name, q }      -> start making one (returns at once; poll status)
// GET ?name=…&q=720     -> stream it (with seeking), if ready
async function videoAt(name) {
  const full = resolveName(name);
  const stat = full && kindOf(full) === "video" ? await fs.stat(full).catch(() => null) : null;
  return stat?.isFile() ? { full, stat } : null;
}

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;
  const video = await videoAt(params.get("name"));
  if (!video) return Response.json({ error: "Video not found" }, { status: 404 });
  if (params.has("status")) return Response.json(await renditionStatus(video.full));

  const q = Number(params.get("q"));
  if (!QUALITIES[q]) return Response.json({ error: "Unknown quality" }, { status: 400 });
  const file = renditionPath(fileKey(video.stat), q);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return Response.json({ error: "Not ready yet" }, { status: 404 });
  return serveFile(request, file, stat.size, {
    "Content-Type": "video/mp4",
    // The URL carries the original's content key, so a cached copy is never stale.
    "Cache-Control": "private, no-store",
  });
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const { name, q } = await request.json().catch(() => ({}));
  const video = await videoAt(name);
  if (!video) return Response.json({ error: "Video not found" }, { status: 404 });
  if (!QUALITIES[Number(q)]) return Response.json({ error: "Unknown quality" }, { status: 400 });
  ensureRendition(video.full, Number(q)).catch(() => {}); // runs in the background
  return Response.json({ ok: true }, { status: 202 });
}
