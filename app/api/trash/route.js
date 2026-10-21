import { isAuthed, unauthorized } from "@/lib/auth";
import { listBin, purgeFromBin } from "@/lib/bin";
import { forgetLibrarySize, restoreFromTrash } from "@/lib/media";

// GET                       -> Recycle Bin contents
// POST { ids: [...] }       -> restore to where they came from (also used by Undo)
// DELETE { ids } / { all }  -> delete forever
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  return Response.json({ items: await listBin() });
}

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

export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  const { ids, all } = await request.json().catch(() => ({}));
  const targets = all ? (await listBin()).map((i) => i.id) : ids;
  if (!Array.isArray(targets)) return Response.json({ error: "ids required" }, { status: 400 });
  const removed = await purgeFromBin(targets);
  forgetLibrarySize();
  return Response.json({ removed });
}
