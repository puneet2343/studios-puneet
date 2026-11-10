import { promises as fs } from "node:fs";
import { isAuthed, unauthorized } from "@/lib/auth";
import { ladderFile } from "@/lib/renditions";
import { serveFile } from "@/lib/serve-file";

// The pieces of a video's streaming ladder (see lib/renditions.js). Paths, not query strings,
// so the playlists' relative links work: /api/hls/<key>/master.m3u8, /api/hls/<key>/v1/seg004.m4s
const TYPES = { m3u8: "application/vnd.apple.mpegurl", m4s: "video/iso.segment", mp4: "video/mp4", jpg: "image/jpeg" };

export async function GET(request, ctx) {
  if (!isAuthed(request)) return unauthorized();
  const { key, file } = await ctx.params;
  const full = ladderFile(key, file.join("/"));
  const stat = full ? await fs.stat(full).catch(() => null) : null;
  if (!stat?.isFile()) return Response.json({ error: "Not found" }, { status: 404 });
  return serveFile(request, full, stat.size, {
    "Content-Type": TYPES[full.split(".").pop()],
    // Not kept on the phone (the app must not grow); the player holds what it needs in memory.
    "Cache-Control": "private, no-store",
  });
}
