import { isAuthed, unauthorized } from "@/lib/auth";
import { createTripFolder, tripSuggestions } from "@/lib/library";
import { exists, forgetLibrarySize, resolveName } from "@/lib/media";

// GET                     -> suggested trip folders for loose top-level media
// POST { name, paths }    -> make the folder and move those files into it
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  return Response.json({ trips: await tripSuggestions() });
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const { name, paths } = await request.json().catch(() => ({}));
  if (!Array.isArray(paths) || !paths.length) return Response.json({ error: "Nothing to move" }, { status: 400 });
  const target = resolveName(name);
  if (!target) return Response.json({ error: "That name isn't allowed. Avoid symbols like / : * ? and don't start with a dot." }, { status: 400 });
  if (await exists(target)) return Response.json({ error: "A folder with that name already exists" }, { status: 409 });
  const result = await createTripFolder(name, paths.slice(0, 5000), resolveName);
  forgetLibrarySize();
  if (result.error) return Response.json(result, { status: 400 });
  return Response.json(result, { status: 201 });
}
