// Each build gets its own id and time, baked into the app itself, so a phone can tell
// exactly which version it's running and compare it with the PC's (see useAutoUpdate).
const BUILT_AT = Date.now();
const BUILD_ID = `ps-${BUILT_AT.toString(36)}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: async () => BUILD_ID,
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
    NEXT_PUBLIC_BUILT_AT: String(BUILT_AT),
  },
  // scripts/serve.js builds into a side folder, then swaps it in, so a failed build never
  // takes the running app down.
  distDir: process.env.PS_DIST_DIR || ".next",
  /* config options here */
  experimental: {
    agentFeedback: true,
    // The build cache doesn't notice new Tailwind classes in components, so the CSS could
    // come out stale (styles missing on phones). Always build fresh.
    turbopackFileSystemCacheForBuild: false,
  },
  // The service worker must always be re-checked, or phones keep running an old one.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
