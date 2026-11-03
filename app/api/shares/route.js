import { isAuthed, unauthorized } from "@/lib/auth";
import { createShare, deleteShare, listShares } from "@/lib/shares";

// Managing shared-album links (logged in only). GET ?album=…, POST { album, days }, DELETE ?token=…
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const album = request.nextUrl.searchParams.get("album") ?? undefined;
  return Response.json({ shares: await listShares(album) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const days = [1, 7, 30].includes(body.days) ? body.days : null;
  const share = await createShare(body.album, days);
  return Response.json(share, { status: share.error ? 400 : 200 });
}

export async function DELETE(request) {
  if (!isAuthed(request)) return unauthorized();
  await deleteShare(request.nextUrl.searchParams.get("token"));
  return Response.json({ ok: true });
}
