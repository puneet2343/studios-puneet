import { readFile } from "node:fs/promises";
import path from "node:path";

// The build the server is running. The app compares it with the build it loaded,
// so an installed phone app notices a new version and reloads itself.
let cached = null;

export async function GET() {
  cached ??= (await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.PS_DIST_DIR || ".next", "BUILD_ID"), "utf8").catch(() => "dev")).trim();
  return Response.json({ build: cached }, { headers: { "Cache-Control": "no-store" } });
}
