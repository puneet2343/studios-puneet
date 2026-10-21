import { isAuthed, unauthorized } from "@/lib/auth";
import { PlanError, addPlanFile, openPlanFile, removePlanFile } from "@/lib/plans";
import { mimeType } from "@/lib/media";
import { serveFile } from "@/lib/serve-file";

// Tickets, booking PDFs and receipts attached to a trip.
// PUT ?trip=…&name=…   (body: the file)  -> { file }
// GET ?trip=…&file=…                     -> the file (inline; &download=1 to save it)
// DELETE ?trip=…&file=…
function failed(error) {
  if (error instanceof PlanError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
}

export async function PUT(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;
  if (!request.body) return Response.json({ error: "Empty file" }, { status: 400 });
  try {
    const file = await addPlanFile(params.get("trip"), params.get("name") || "file", request.headers.get("content-type"), request.body, Number(request.headers.get("content-length")) || 0);
    return Response.json({ file }, { status: 201 });
  } catch (error) {
    return failed(error);
  }
}

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;
  try {
    const file = await openPlanFile(params.get("trip"), params.get("file"));
    return serveFile(request, file.full, file.size, {
      "Content-Type": mimeType(file.name),
      "Content-Disposition": `${params.has("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, max-age=86400",
    });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;
  await removePlanFile(params.get("trip"), params.get("file"));
  return Response.json({ ok: true });
}
