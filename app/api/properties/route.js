import { promises as fs } from "node:fs";
import { isAuthed, unauthorized } from "@/lib/auth";
import { resolveName } from "@/lib/media";
import { fileProperties } from "@/lib/properties";

// GET ?name=Goa Trip/clip.mp4 -> everything known about one file (for the Properties sheet)
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  const full = resolveName(request.nextUrl.searchParams.get("name"));
  const stat = full && (await fs.stat(full).catch(() => null));
  if (!stat?.isFile()) return Response.json({ error: "File not found" }, { status: 404 });
  return Response.json(await fileProperties(full));
}
