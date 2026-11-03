import { isAuthed, unauthorized } from "@/lib/auth";
import { UploadError, appendChunk, cancelUpload, openUpload } from "@/lib/uploads";
import { finishPhoneUpload } from "@/lib/phone-sync";

// Resumable uploads (see lib/uploads.js).
// POST { id, name: "Folder/clip.mp4", size }   -> { offset } bytes already on the PC
// PUT ?id=…&offset=…  (body: next piece)        -> { offset } or { done, path }
// DELETE ?id=…                                  -> cancel and discard
function failed(error) {
  if (error instanceof UploadError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    return Response.json(await openUpload({ id: body.id, name: body.name, size: Number(body.size) }));
  } catch (error) {
    return failed(error);
  }
}

export async function PUT(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;
  try {
    const body = request.body ?? new Blob([]).stream(); // a 0-byte file sends an empty piece
    const result = await appendChunk(params.get("id"), Number(params.get("offset")), body);
    // Phone backups: verified byte for byte, filed into their trip, noted in the history.
    if (result.done && result.extra?.sync) {
      const finished = await finishPhoneUpload(result);
      if (finished.corrupt) return Response.json({ error: "The file changed on the way. It will be sent again." }, { status: 422 });
      return Response.json({ ...finished, extra: undefined }, { status: 201 });
    }
    if (result.done) delete result.extra;
    return Response.json(result, { status: result.mismatch ? 409 : result.done ? 201 : 200 });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  await cancelUpload(request.nextUrl.searchParams.get("id"));
  return Response.json({ ok: true });
}
