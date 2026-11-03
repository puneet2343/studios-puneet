// Update history shown in the app (Settings › Updates, and the version under each page title).
// Newest first. Add an entry with every update; `version` matches the Android app's
// versionName in android/AndroidManifest.xml when the phone app changes too.
export const CHANGELOG = [
  {
    version: "3.5",
    date: "2026-11-03",
    title: "Clean up, share albums, On this day",
    items: [
      "Clean up similar photos (Settings): finds the same photo saved twice and quick shots in a row, keeps the sharpest, and frees the space. Removed photos go to the Recycle Bin; favourites are always kept",
      "Share an album: tap Share in an album to make a private link. People with the link see only that album and can download the originals. Choose 7 days, 30 days or no end, and stop sharing any time",
      "On this day: photos from this date in earlier years (and a month ago) appear at the top of Photos",
    ],
  },
  {
    version: "3.4",
    date: "2026-11-03",
    title: "Smoother swiping and a lock button",
    items: [
      "Swiping between photos and videos glides smoothly; the next one is already waiting beside it",
      "Video: the buttons below (Download, Favourite, More…) no longer hide while you're using them",
      "Lock button (top of Photos, and in Settings) locks the app straight away",
      "After unlocking, the app stays open for 1 hour instead of 10 minutes",
    ],
  },
  {
    version: "3.3",
    date: "2026-11-03",
    title: "Cleaner video player, better People",
    items: [
      "Videos open at full size straight away (no more jump), and start faster",
      "Simpler controls: one play button, one slim bar with time, speed, sound and full screen. Double-tap left or right to skip 10 seconds",
      "People: the same person no longer shows up several times, and groups don't mix different people",
      "The same photo saved twice shows once in a person's photos",
      "The app no longer grows on your phone while you browse: originals and videos aren't kept, old app files are cleaned up, and the cache never passes 100 MB",
    ],
  },
  {
    version: "3.2",
    date: "2026-11-03",
    title: "Second backup copy and backup alerts",
    items: [
      "Backup copy: plug an external drive into the PC and your whole library is copied to it, checked byte for byte",
      "Deleted or changed files are kept on the drive for 30 days, and every file is re-checked monthly",
      "The phone tells you when backup stops and why (Tailscale off, PC off, app not running), with a one-tap fix",
      "The PC warns you if a phone hasn't backed up for a day, or the backup drive is out of date",
      "A short weekly summary of what was backed up",
    ],
  },
  {
    version: "3.1",
    date: "2026-11-03",
    title: "Search what's in your photos, and People",
    items: [
      "Search by what a photo shows: type beach, cake, cat, moon, a screenshot…",
      "People: faces are grouped by person in Albums. Add names, put two together, or hide someone",
      "Search a person by the name you gave them",
      "New photos are looked at automatically every few minutes. All of this happens on your PC only",
    ],
  },
  {
    version: "3.0",
    date: "2026-11-03",
    title: "New app lock PIN",
    items: ["The phone app lock PIN has changed"],
  },
  {
    version: "2.9",
    date: "2026-11-03",
    title: "Smoother unlock and one-tap updates",
    items: [
      "Fingerprint unlock opens the app straight away (it sometimes asked twice)",
      "New versions of the phone app download by themselves: just tap Update when Android asks",
    ],
  },
  {
    version: "2.5",
    date: "2026-11-03",
    title: "Fingerprint lock and automatic updates",
    items: [
      "The phone app opens with your fingerprint (or PIN), then stays open for 10 minutes",
      "The phone app now updates itself when there's a new version: no more reinstalling",
      "Version and update history are shown in the app",
    ],
  },
  {
    version: "2.4",
    date: "2026-11-03",
    title: "Backup that never misses",
    items: [
      "Always-on backup: new photos and videos go to the PC within seconds, screen on or off, app closed",
      "No duplicates ever: every file is fingerprinted, and anything already on the PC is skipped",
      "Every upload is checked byte for byte; a damaged one is sent again automatically",
      "Backs up everything already on the phone too, not only new photos",
      "Backup history in Settings",
      "Videos always play the original file (no lighter copies are made)",
      "The phone app retries by itself when the PC can't be reached",
    ],
  },
  {
    version: "2.0",
    date: "2026-11-03",
    title: "New Puneet Studios",
    items: [
      "Clean new design: Photos, Albums, Map and Settings",
      "New logo and sign-in screen",
      "Trips: give a name and dates, and the photos gather in one album",
      "Map of where your photos were taken",
      "Free up space on the phone once photos are safely on the PC",
      "The Android app is now the full app, with backup built in",
      "Instagram Export removed",
    ],
  },
  {
    version: "1.0",
    date: "2026-11-03",
    title: "Phone backup app",
    items: ["First Android app: copies new photos and videos to the PC by itself"],
  },
];

export const CURRENT = CHANGELOG[0];
