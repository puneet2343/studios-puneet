import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { isAuthed, unauthorized } from "@/lib/auth";
import { kindOf, resolveName } from "@/lib/media";
import { getThumb } from "@/lib/thumbs";
import { trashPath } from "@/lib/bin";

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  // ?trash=<id> shows a thumbnail for something in the Recycle Bin.
  const params = request.nextUrl.searchParams;
  const full = params.has("trash") ? trashPath(params.get("trash")) : resolveName(params.get("name"));
  if (!full || !["image", "video"].includes(kindOf(full))) {
    return new Response(null, { status: 404 });
  }

  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    return new Response(null, { status: 404 });
  }

  const thumb = await getThumb(full, stat);
  if (!thumb) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  const { size } = await fs.stat(thumb);
  return new Response(Readable.toWeb(createReadStream(thumb)), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(size),
      // The client puts the content key in the URL, so a cached thumb never goes stale.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
