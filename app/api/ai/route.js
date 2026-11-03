import { isAuthed, unauthorized } from "@/lib/auth";
import { aiProgress, searchByMeaning } from "@/lib/ai";

// GET ?q=beach  -> { results: [{ path, score }] }  photos that look like the words, best first
// GET           -> { done, total, working }        how far the PC is with looking at photos
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return Response.json(aiProgress(), { headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json({ results: await searchByMeaning(q) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ results: [], error: error.message }, { status: 503 });
  }
}
