import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// The build the server is running, and when it was built. The app compares the build
// with the one it loaded (so an installed phone app notices updates and reloads), and
// shows the build time under the app name.
let cached = null;

export async function GET() {
  if (!cached) {
    const file = path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.PS_DIST_DIR || ".next", "BUILD_ID");
    const [build, info] = await Promise.all([readFile(file, "utf8").catch(() => "dev"), stat(file).catch(() => null)]);
    cached = { build: build.trim(), builtAt: info ? Math.round(info.mtimeMs) : null };
  }
  return Response.json(cached, { headers: { "Cache-Control": "no-store" } });
}
