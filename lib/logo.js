// The Puneet Studios mark: a lens with a little landscape (mountains + sun) inside, on a
// warm coral → pink → violet tile. One SVG source for the in-app logo (components/Logo.js),
// the home-screen icons (lib/brand-icon.js) and the Android app icon.
//  tile: "rounded" = rounded tile (in-app, "any" icons), "full" = full-bleed square (maskable)
//  mark: how much of the tile the lens fills
//  layers: "all", "background" or "lens" (Android builds its adaptive icon from the two parts)
export function logoSvg({ size = 64, tile = "rounded", mark = 0.62, id = "ps", layers = "all" } = {}) {
  const r = tile === "rounded" ? 16 : 0;
  const s = mark / 0.62; // the lens below is drawn at 0.62 of the tile
  const t = `translate(32 32) scale(${s.toFixed(4)}) translate(-32 -32)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="Puneet Studios">
<defs>
<linearGradient id="${id}-bg" x1="0.08" y1="0" x2="0.92" y2="1"><stop offset="0" stop-color="#ff9a5a"/><stop offset="0.5" stop-color="#f0457f"/><stop offset="1" stop-color="#6a5cf0"/></linearGradient>
<radialGradient id="${id}-hi" cx="0.25" cy="0.15" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<clipPath id="${id}-lens"><circle cx="32" cy="32" r="13.2"/></clipPath>
</defs>
${layers === "lens" ? "" : `<rect width="64" height="64" rx="${r}" fill="url(#${id}-bg)"/>
<rect width="64" height="64" rx="${r}" fill="url(#${id}-hi)"/>`}
${layers === "background" ? "" : `<g transform="${t}">
<circle cx="32" cy="32" r="16" fill="none" stroke="#fff" stroke-width="4.2"/>
<g clip-path="url(#${id}-lens)">
<circle cx="32" cy="32" r="13.2" fill="#fff" fill-opacity="0.16"/>
<circle cx="37.6" cy="26.4" r="3.4" fill="#fff"/>
<path d="M14 47 L25.5 32.5 L31 39 L37.5 30.5 L50 47 Z" fill="#fff"/>
</g>
</g>`}
</svg>`;
}
