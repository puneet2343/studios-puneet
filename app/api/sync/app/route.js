import { promises as fs } from "node:fs";
import { isAuthed, unauthorized } from "@/lib/auth";
import { APK } from "@/lib/phone-sync";
import { serveFile } from "@/lib/serve-file";

// Download the Puneet Studios Android app (built by android/build.bat).
// GET ?info=1 -> { versionCode, versionName, built } (the phone app updates itself when newer)
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  if (request.nextUrl.searchParams.has("info")) {
    const info = await fs.readFile(APK.replace(/PuneetStudios\.apk$/, "version.json"), "utf8").then(JSON.parse, () => null);
    return Response.json(info ?? { versionCode: 0 }, { headers: { "Cache-Control": "no-store" } });
  }
  const stat = await fs.stat(APK).catch(() => null);
  if (!stat) return Response.json({ error: "The Android app hasn't been built yet" }, { status: 404 });
  return serveFile(request, APK, stat.size, {
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": 'attachment; filename="PuneetStudios.apk"',
    "Cache-Control": "no-store",
  });
}
