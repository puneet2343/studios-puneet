// Tiny vibrations for key actions on phones (ignored where unsupported, e.g. iPhone
// browsers and desktops). Kept very short so they feel like a tap, not a buzz.
export function haptic(kind = "tap") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const patterns = { tap: 8, tick: 4, success: [10, 40, 14], warn: [18, 30, 18] };
  try {
    navigator.vibrate(patterns[kind] ?? 8);
  } catch {}
}
