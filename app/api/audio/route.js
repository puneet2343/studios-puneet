import { promises as fs } from "node:fs";
import { isAuthed, unauthorized } from "@/lib/auth";
import { audioInfo, extractAudio } from "@/lib/audio";
import { fileErrorResponse, kindOf, relPath, resolveDir, resolveName } from "@/lib/media";

// GET ?name=…                          -> what the sound is and which file type it becomes
// POST { name, saveAs?, dir? }         -> saves the video's sound, untouched (no re-encoding),
//                                         as "<saveAs>.m4a" (or .mp3/.flac…) in folder `dir`
async function videoAt(name) {
  const full = resolveName(name);
  const stat = full && kindOf(full) === "video" ? await fs.stat(full).catch(() => null) : null;
  return stat?.isFile() ? full : null;
}

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const full = await videoAt(request.nextUrl.searchParams.get("name"));
  if (!full) return Response.json({ error: "Video not found" }, { status: 404 });
  try {
    return Response.json(await audioInfo(full));
  } catch (error) {
    return Response.json({ error: error.userMessage ?? "Couldn't read this video's sound." }, { status: 422 });
  }
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const { name, saveAs, dir } = await request.json().catch(() => ({}));
  const full = await videoAt(name);
  if (!full) return Response.json({ error: "Video not found" }, { status: 404 });
  let targetDir;
  if (dir !== undefined && dir !== null) {
    targetDir = resolveDir(dir);
    const stat = targetDir && (await fs.stat(targetDir).catch(() => null));
    if (!stat?.isDirectory()) return Response.json({ error: "That folder no longer exists" }, { status: 404 });
  }
  try {
    const result = await extractAudio(full, { baseName: typeof saveAs === "string" && saveAs.trim() ? saveAs : undefined, dir: targetDir });
    return Response.json({ ok: true, path: relPath(result.full), codec: result.codec }, { status: 201 });
  } catch (error) {
    if (error.userMessage) return Response.json({ error: error.userMessage }, { status: 422 });
    if (typeof error.code === "string") return fileErrorResponse(error, "save the audio");
    return Response.json({ error: "Couldn't extract the sound. The video may be damaged." }, { status: 500 });
  }
}
