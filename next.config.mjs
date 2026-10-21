/** @type {import('next').NextConfig} */
const nextConfig = {
  // scripts/serve.js builds into a side folder, then swaps it in, so a failed build never
  // takes the running app down.
  distDir: process.env.PS_DIST_DIR || ".next",
  /* config options here */
  experimental: {
    agentFeedback: true,
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
