import { promises as fs } from "node:fs";
import { isAuthed, unauthorized } from "@/lib/auth";
import { probe } from "@/lib/ffmpeg";
import { analyze, cancelJob, createJob, listJobs } from "@/lib/instagram";
import { readRegistry, sourceDisplayName, sourcePath } from "@/lib/instagram-store";
import { listMedia } from "@/lib/media";

// GET             -> export jobs with live progress
// GET ?exports=1  -> every Instagram export currently in the library
// GET ?analyze=id -> details + plain-language checks for an uploaded source
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;

  if (params.has("exports")) {
    const [{ files }, registry] = await Promise.all([listMedia(), readRegistry()]);
    const exports = files.filter((f) => registry[f.key]).map((f) => ({ ...f, export: registry[f.key] }));
    return Response.json({ exports });
  }

  const id = params.get("analyze");
  if (!id) return Response.json({ jobs: listJobs() });
  const full = sourcePath(id);
  if (!full) return Response.json({ error: "Invalid id" }, { status: 400 });
  try {
    await fs.access(full);
    return Response.json(analyze(await probe(full)));
  } catch {
    return Response.json({ error: "Couldn't read this video. It may be damaged or an unsupported format." }, { status: 422 });
  }
}

// POST { source, options } -> queue an export of an uploaded source
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const { source, options } = await request.json().catch(() => ({}));
  const full = sourcePath(source);
  if (!full) return Response.json({ error: "Upload a video first" }, { status: 400 });
  try {
    await fs.access(full);
    const job = await createJob(full, sourceDisplayName(source), options);
    return Response.json({ job }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.code === "ENOENT" ? "That upload has expired — please upload it again" : error.message }, { status: 422 });
  }
}

// DELETE ?id= -> cancel a running/queued export, or dismiss a finished one
export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  const ok = cancelJob(request.nextUrl.searchParams.get("id"));
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
