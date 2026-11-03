import { isAuthed, unauthorized } from "@/lib/auth";
import { UploadError } from "@/lib/uploads";
import { readHistory, saveReport, startSync, syncOverview } from "@/lib/phone-sync";
import { presentOnPc } from "@/lib/catalog";

// Phone Sync (see lib/phone-sync.js), used by the Android app.
// GET                                                        -> phones, newest synced files
// POST { action: "start", id, device, folder, name, size }   -> { offset } or { skip }
//        then the file goes up via PUT /api/upload?id=…&offset=…
// POST { action: "report", device, synced, pending, … }      -> saved for the Phone Sync page
// POST { action: "verify", items: [{ name, size }] }          -> { present: [true, false…] }
//        (before the app frees space, so it only deletes what's safely on the PC)
// GET ?history=1[&before=<time>]                            -> backup history, newest first
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;
  if (params.has("history")) {
    const before = Number(params.get("before")) || Infinity;
    return Response.json(await readHistory({ before }), { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(await syncOverview(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "start") {
      const result = await startSync({ ...body, size: Number(body.size) });
      return Response.json(result, { status: result.error ? 400 : 200 });
    }
    if (body.action === "report") return Response.json(await saveReport(body));
    if (body.action === "verify") {
      const items = Array.isArray(body.items) ? body.items.slice(0, 20000) : [];
      return Response.json({ present: await presentOnPc(items) });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const status = error instanceof UploadError ? error.status : 500;
    return Response.json({ error: error.message }, { status });
  }
}
