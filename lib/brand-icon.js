import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";

// The built-in OG font has no heavy weight, so use Windows' Segoe UI Black when present.
async function loadFonts() {
  try {
    const data = await readFile(/*turbopackIgnore: true*/ "C:\\Windows\\Fonts\\seguibl.ttf");
    return [{ name: "Brand", data, weight: 800, style: "normal" }];
  } catch {
    return [];
  }
}

// PNG version of components/Logo.js for the home-screen / install icons.
// `padded` keeps the monogram inside the safe zone Android uses for maskable icons.
export async function brandIcon(size, { padded = false } = {}) {
  const inset = Math.round(size * (padded ? 0.12 : 0.04));
  const fonts = await loadFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #8b5cf6, #0ea5e9)",
          padding: inset,
        }}
      >
        <div
          style={{
            display: "flex",
            color: "white",
            fontFamily: fonts.length ? "Brand" : undefined,
            fontSize: (size - inset * 2) * 0.48,
            fontWeight: 800,
            letterSpacing: -size * 0.02,
          }}
        >
          PS
        </div>
      </div>
    ),
    { width: size, height: size, fonts }
  );
}
