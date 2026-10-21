import { createWriteStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isAuthed, unauthorized } from "@/lib/auth";
import { kindOf } from "@/lib/media";
import { SOURCE_DIR, newSourceId, purgeOldSources, sourcePath } from "@/lib/instagram-store";

// PUT ?name=<file name> — upload a video for Instagram Export. It is stored in the
// export tool's own working folder, never in the Media library.
export async function PUT(request) {
  if (!isAuthed(request)) return unauthorized();
  const name = request.nextUrl.searchParams.get("name");
  const id = newSourceId(name);
  if (!id || kindOf(id) !== "video") return Response.json({ error: "Choose a video file" }, { status: 400 });
  if (!request.body) return Response.json({ error: "Empty upload" }, { status: 400 });

  await fs.mkdir(SOURCE_DIR, { recursive: true });
  purgeOldSources().catch(() => {});
  const full = sourcePath(id);
  const temp = `${full}.uploading`;
  try {
    await pipeline(Readable.fromWeb(request.body), createWriteStream(temp));
    await fs.rename(temp, full);
    return Response.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    await fs.rm(temp, { force: true });
    return Response.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
  }
}

// DELETE ?id= — discard an uploaded source.
export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  const full = sourcePath(request.nextUrl.searchParams.get("id"));
  if (!full) return Response.json({ error: "Invalid id" }, { status: 400 });
  await fs.rm(full, { force: true });
  return Response.json({ ok: true });
}
