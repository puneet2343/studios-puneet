import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { isAuthed, unauthorized } from "@/lib/auth";
import { faceBox, findByKey } from "@/lib/ai";
import { MEDIA_DIR, kindOf } from "@/lib/media";
import { getThumb } from "@/lib/thumbs";

// GET ?key=<content key>&i=<face number> -> a small square picture of that face (cached).
const DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, ".meta", "faces");

export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const key = request.nextUrl.searchParams.get("key") ?? "";
  const i = Number(request.nextUrl.searchParams.get("i") ?? 0);
  if (!/^[0-9a-f]{20}$/.test(key) || !Number.isInteger(i) || i < 0) return new Response(null, { status: 400 });
  const out = path.join(DIR, `${key}-${i}.webp`);
  let data = await fs.readFile(out).catch(() => null);
  if (!data) {
    const [box, file] = await Promise.all([faceBox(key, i), findByKey(key)]);
    if (!box || !file) return new Response(null, { status: 404 });
    const source = kindOf(file.full) === "video" || /\.(heic|heif)$/i.test(file.full) ? await getThumb(file.full, file.stat) : file.full;
    const img = sharp(source, { failOn: "none" }).rotate();
    const { data: buf, info } = await img.toBuffer({ resolveWithObject: true });
    // A square around the face with some room for hair and chin.
    const [x, y, w, h] = [box[0] * info.width, box[1] * info.height, box[2] * info.width, box[3] * info.height];
    const side = Math.min(Math.max(w, h) * 1.6, info.width, info.height);
    const left = Math.round(Math.min(Math.max(0, x + w / 2 - side / 2), info.width - side));
    const top = Math.round(Math.min(Math.max(0, y + h / 2 - side / 2), info.height - side));
    data = await sharp(buf).extract({ left, top, width: Math.round(side), height: Math.round(side) }).resize(192, 192).webp({ quality: 82 }).toBuffer();
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(out, data);
  }
  return new Response(data, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable" } });
}
