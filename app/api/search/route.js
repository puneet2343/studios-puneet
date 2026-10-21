import { isAuthed, unauthorized } from "@/lib/auth";
import { searchLibrary } from "@/lib/library";

// GET ?q=beach   -> files and folders anywhere in the library whose path matches
// GET ?fav=1     -> every favourite, from every folder
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const params = request.nextUrl.searchParams;
  const query = (params.get("q") ?? "").slice(0, 100);
  const favoritesOnly = params.has("fav");
  if (!query.trim() && !favoritesOnly) return Response.json({ files: [], folders: [] });
  return Response.json(await searchLibrary({ query, favoritesOnly }));
}
