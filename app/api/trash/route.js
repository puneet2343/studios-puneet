import { isAuthed, unauthorized } from "@/lib/auth";
import { restoreFromTrash } from "@/lib/media";

// Undo for deletes: POST { ids: [...] } moves those files back into the library.
export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const { ids } = await request.json().catch(() => ({}));
  if (!Array.isArray(ids)) return Response.json({ error: "ids required" }, { status: 400 });

  const restored = [];
  for (const id of ids) {
    const name = await restoreFromTrash(id).catch(() => null);
    if (name) restored.push(name);
  }
  return Response.json({ restored });
}
