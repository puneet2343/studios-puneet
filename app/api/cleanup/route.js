import { isAuthed, unauthorized } from "@/lib/auth";
import { findGroups } from "@/lib/bestshot";

// Groups of the same or nearly the same photo, with the suggested keeper (lib/bestshot.js).
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  return Response.json(await findGroups(), { headers: { "Cache-Control": "no-store" } });
}
