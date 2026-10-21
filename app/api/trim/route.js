import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { isAuthed, unauthorized } from "@/lib/auth";
import { fileErrorResponse, kindOf, relPath, resolveName } from "@/lib/media";
import { filmstrip, trimInfo, trimVideo } from "@/lib/trim";

// GET ?name=           -> { duration, keyframes } for the trim editor
// GET ?name=&strip=1   -> timeline filmstrip image
// POST { name, start, end, replace } -> lossless cut
async function videoAt(name) {
  const full = resolveName(name);
  if (!full || kindOf(full) !== "video") return null;
  const stat = await fs.stat(full).catch(() => null);
  return stat?.isFile() ? full : null;
}

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;
  const full = await videoAt(params.get("name"));
  if (!full) return Response.json({ error: "Video not found" }, { status: 404 });

  if (params.has("strip")) {
    try {
      const strip = await filmstrip(full);
      const { size } = await fs.stat(strip);
      return new Response(Readable.toWeb(createReadStream(strip)), {
        headers: { "Content-Type": "image/webp", "Content-Length": String(size), "Cache-Control": "private, max-age=31536000, immutable" },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  try {
    return Response.json(await trimInfo(full));
  } catch {
    return Response.json({ error: "Couldn't read this video" }, { status: 422 });
  }
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const { name, start, end, replace } = await request.json().catch(() => ({}));
  const full = await videoAt(name);
  if (!full) return Response.json({ error: "Video not found" }, { status: 404 });
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.3) {
    return Response.json({ error: "Pick a part at least half a second long" }, { status: 400 });
  }
  try {
    const result = await trimVideo(full, start, end, { replace: Boolean(replace) });
    return Response.json({ ok: true, path: relPath(result.full), trashId: result.trashId }, { status: 201 });
  } catch (error) {
    if (typeof error.code === "string") return fileErrorResponse(error, "save the trimmed clip");
    return Response.json({ error: "Trimming failed. The video may be damaged or in an unusual format." }, { status: 500 });
  }
}
