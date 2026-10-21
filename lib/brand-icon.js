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

// Deep violet → blue → cyan with a soft light from the top-left, like the in-app logo.
const SURFACE =
  "radial-gradient(circle at 22% 18%, rgba(255,255,255,0.42), rgba(255,255,255,0) 52%), linear-gradient(140deg, #7c3aed 0%, #4f46e5 45%, #0ea5e9 100%)";

function Monogram({ size, fonts }) {
  return (
    <div
      style={{
        display: "flex",
        color: "white",
        fontFamily: fonts.length ? "Brand" : undefined,
        fontSize: size,
        fontWeight: 800,
        letterSpacing: -size * 0.04,
        textShadow: `0 ${size * 0.04}px ${size * 0.12}px rgba(30, 10, 80, 0.45)`,
      }}
    >
      PS
    </div>
  );
}

// PNG version of components/Logo.js for the home-screen / install icons.
// `padded` (maskable): full-bleed colour, monogram kept inside the circle Android crops to;
//   Android 12+ also builds its launch screen from this one.
// `rounded` (any): the logo as a rounded tile on a transparent background, so it never
//   sits on a white plate or shows hard square corners.
export async function brandIcon(size, { padded = false, rounded = false } = {}) {
  const fonts = await loadFonts();
  if (rounded) {
    const tile = Math.round(size * 0.86);
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              width: tile,
              height: tile,
              borderRadius: tile * 0.27,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundImage: SURFACE,
              boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.18)",
            }}
          >
            <Monogram size={tile * 0.44} fonts={fonts} />
          </div>
        </div>
      ),
      { width: size, height: size, fonts }
    );
  }
  const inset = Math.round(size * (padded ? 0.14 : 0.04));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundImage: SURFACE }}>
        <Monogram size={(size - inset * 2) * 0.46} fonts={fonts} />
      </div>
    ),
    { width: size, height: size, fonts }
  );
}
