import { isAuthed, unauthorized } from "@/lib/auth";
import { backupNow, backupStatus, setRetention, setupDrive } from "@/lib/backup";

// Second copy on an external drive (see lib/backup.js).
// GET                                   -> status, connected drives, last run
// POST { action: "setup", root }        -> use this drive for backups
// POST { action: "run" }                -> back up now
// POST { action: "confirm" }            -> go ahead although many files left the library
// POST { action: "verify" }             -> back up and re-check every file on the drive now
// POST { action: "retention", days }    -> keep deleted/changed files 7 / 30 / 90 / 365 days
export async function GET(request) {
  if (!isAuthed(request)) return unauthorized();
  return Response.json(await backupStatus(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  if (!isAuthed(request)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "setup") return Response.json(await setupDrive(String(body.root ?? "")));
    if (body.action === "retention") {
      await setRetention(Number(body.days));
      return Response.json({ ok: true });
    }
    if (["run", "confirm", "verify"].includes(body.action)) {
      // Runs in the background; the app watches progress through GET.
      backupNow({ confirmLargeRemoval: body.action === "confirm", fullCheck: body.action === "verify" }).catch(() => {});
      return Response.json({ started: true });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
