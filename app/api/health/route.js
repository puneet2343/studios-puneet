import { isAuthed, unauthorized } from "@/lib/auth";
import { healthSnapshot } from "@/lib/health";

// The phone app checks this every few minutes: it proves the PC is reachable and running,
// and reports the PC's own problems (disk almost full, backup drive out of date).
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  return Response.json(await healthSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
