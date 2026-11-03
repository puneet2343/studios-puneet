// Runs once when the server starts: begins the 10-minute disk check that sends
// "studio PC is running low on space" notifications to subscribed phones.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMonitor } = await import("./lib/storage-alerts");
    startMonitor();
    // Fingerprints of library files, so phone backups never create duplicates.
    const { startHashWorker } = await import("./lib/hashes");
    startHashWorker();
    // Photo search and People: looks at each photo once, on this PC only.
    const { startAiWorker } = await import("./lib/ai");
    startAiWorker();
    // Second copy on an external drive: when it's plugged in, then every 10 minutes.
    const { startBackupWorker } = await import("./lib/backup");
    startBackupWorker();
    // Watchdog: a phone that has gone quiet, a backup drive that is out of date.
    const { startHealthWatch } = await import("./lib/health");
    startHealthWatch();
  }
}
