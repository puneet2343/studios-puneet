import { isAuthed, unauthorized } from "@/lib/auth";
import { setFavorites } from "@/lib/library";

// POST { keys: [...], on: true | false } -> star or unstar files (by content key)
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const { keys, on } = await request.json().catch(() => ({}));
  if (!Array.isArray(keys) || !keys.length) return Response.json({ error: "keys required" }, { status: 400 });
  await setFavorites(keys.slice(0, 1000), Boolean(on));
  return Response.json({ ok: true });
}
