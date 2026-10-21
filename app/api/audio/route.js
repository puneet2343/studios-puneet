import { promises as fs } from "node:fs";
import { isAuthed, unauthorized } from "@/lib/auth";
import { extractAudio } from "@/lib/audio";
import { fileErrorResponse, kindOf, relPath, resolveName } from "@/lib/media";

// POST { name } -> saves the video's sound next to it, untouched (no re-encoding)
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const { name } = await request.json().catch(() => ({}));
  const full = resolveName(name);
  const stat = full && kindOf(full) === "video" ? await fs.stat(full).catch(() => null) : null;
  if (!stat?.isFile()) return Response.json({ error: "Video not found" }, { status: 404 });
  try {
    const result = await extractAudio(full);
    return Response.json({ ok: true, path: relPath(result.full), codec: result.codec }, { status: 201 });
  } catch (error) {
    if (error.userMessage) return Response.json({ error: error.userMessage }, { status: 422 });
    if (typeof error.code === "string") return fileErrorResponse(error, "save the audio");
    return Response.json({ error: "Couldn't extract the sound. The video may be damaged." }, { status: 500 });
  }
}
