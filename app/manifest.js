export default function manifest() {
  return {
    name: "Puneet Studios",
    short_name: "Puneet Studios",
    description: "Creator workspace: media library on the studio PC",
    start_url: "/",
    display: "standalone",
    // Launch-screen colour: matches the app in light mode, so opening it doesn’t flash dark.
    background_color: "#fbfbfc",
    theme_color: "#fbfbfc",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
