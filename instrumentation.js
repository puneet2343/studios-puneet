// Runs once when the server starts: begins the 10-minute disk check that sends
// "studio PC is running low on space" notifications to subscribed phones.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMonitor } = await import("./lib/storage-alerts");
    startMonitor();
  }
}
