import { promises as fs } from "node:fs";
import { isAuthed, unauthorized } from "@/lib/auth";
import { kindOf, resolveName } from "@/lib/media";
import { streamStatus } from "@/lib/renditions";

// GET ?name=…  -> is this video's streaming ladder ready (or how far along), its preview
// pictures, and facts about the original. Asking also moves the video to the front of the
// queue, so a video someone opens is prepared first.
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const full = resolveName(request.nextUrl.searchParams.get("name"));
  const stat = full && kindOf(full) === "video" ? await fs.stat(full).catch(() => null) : null;
  if (!stat?.isFile()) return Response.json({ error: "Video not found" }, { status: 404 });
  return Response.json(await streamStatus(full, { start: true }), { headers: { "Cache-Control": "no-store" } });
}
