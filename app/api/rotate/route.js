import { promises as fs } from "node:fs";
import { isAuthed, unauthorized } from "@/lib/auth";
import { fileErrorResponse, kindOf, relPath, resolveName } from "@/lib/media";
import { rotateVideo } from "@/lib/trim";

// POST { name, turns: 0-3 (quarter turns clockwise), flip, replace } -> lossless rotate / mirror
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const { name, turns, flip, replace } = await request.json().catch(() => ({}));
  const full = resolveName(name);
  const stat = full && kindOf(full) === "video" ? await fs.stat(full).catch(() => null) : null;
  if (!stat?.isFile()) return Response.json({ error: "Video not found" }, { status: 404 });
  const quarter = ((Math.round(Number(turns)) % 4) + 4) % 4;
  if (!Number.isFinite(quarter) || (quarter === 0 && !flip)) {
    return Response.json({ error: "Turn or flip the video first" }, { status: 400 });
  }
  try {
    const result = await rotateVideo(full, quarter, Boolean(flip), { replace: Boolean(replace) });
    return Response.json({ ok: true, path: relPath(result.full), trashId: result.trashId }, { status: 201 });
  } catch (error) {
    if (typeof error.code === "string") return fileErrorResponse(error, "save the rotated video");
    return Response.json({ error: "Rotating failed. The video may be damaged or in an unusual format." }, { status: 500 });
  }
}
