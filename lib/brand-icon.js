import sharp from "sharp";
import { logoSvg } from "@/lib/logo";

// PNG app icons from the same SVG as the in-app logo (lib/logo.js).
// `padded` (maskable): full-bleed colour with the lens inside the circle Android crops to;
//   Android 12+ also builds its launch screen from this one.
// `rounded` (any): the logo as a rounded tile on a transparent background.
export async function brandIcon(size, { padded = false, rounded = false } = {}) {
  let png;
  if (rounded) {
    const tile = Math.round(size * 0.86);
    const inner = await sharp(Buffer.from(logoSvg({ size: tile }))).png().toBuffer();
    const pad = Math.round((size - tile) / 2);
    png = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: inner, left: pad, top: pad }])
      .png()
      .toBuffer();
  } else {
    png = await sharp(Buffer.from(logoSvg({ size, tile: "full", mark: padded ? 0.5 : 0.62 }))).png().toBuffer();
  }
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}
