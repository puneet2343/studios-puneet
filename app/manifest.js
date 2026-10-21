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
      // ?v= changes whenever the icon design does, so phones fetch the new one.
      { src: "/icon-192.png?v=3", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
