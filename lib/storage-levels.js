// When the studio PC's disk counts as running low. Shared by the server (alerts,
// upload guard) and the phone (banner, storage bar), so both always agree.
export const LOW = { share: 0.15, bytes: 30e9 }; // under 15% or 30 GB free
export const CRITICAL = { share: 0.05, bytes: 10e9 }; // under 5% or 10 GB free

// Uploads that would leave less than this free are refused, so Windows never runs dry.
export const UPLOAD_RESERVE = 2e9;

export function storageLevel(disk) {
  if (!disk?.total) return "ok";
  const share = disk.free / disk.total;
  if (disk.free < CRITICAL.bytes || share < CRITICAL.share) return "critical";
  if (disk.free < LOW.bytes || share < LOW.share) return "low";
  return "ok";
}
