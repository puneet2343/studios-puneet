import { isAuthed, unauthorized } from "@/lib/auth";
import { catalog } from "@/lib/catalog";

// The whole library in one go (see lib/catalog.js): Photos, Albums and Map all use it.
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  return Response.json(await catalog(), { headers: { "Cache-Control": "no-store" } });
}
