import { isAuthed, unauthorized } from "@/lib/auth";
import { listPeople, updatePerson } from "@/lib/ai";

// GET                                   -> { people: [{ id, name, count, paths, cover }] }
// PATCH { id, name?, hidden?, mergeInto? } -> rename, hide, or merge two people into one
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  return Response.json({ people: await listPeople() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request) {
  if (!isAuthed(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const p = await updatePerson(String(body.id ?? ""), body);
  if (!p) return Response.json({ error: "Person not found" }, { status: 404 });
  return Response.json({ ok: true });
}
