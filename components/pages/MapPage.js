"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon, MapIcon } from "@/components/icons";
import { EmptyMapArt } from "@/components/Illustrations";
import MediaBrowser from "@/components/library/MediaBrowser";
import { useLibrary } from "@/components/library/store";
import { thumbUrl } from "@/components/media/urls";
import { useThemePreference } from "@/components/theme";
import useBackClose from "@/components/useBackClose";

// Every photo and video that knows where it was taken, as photo pins on a map.
// Nearby pins merge into one (with a count) and split apart as you zoom in.
// Tap a pin to see its photos.
const CELL = 64; // px: pins closer than this on screen merge

function resolvedTheme() {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export default function MapPage() {
  const { files } = useLibrary();
  const pref = useThemePreference();
  const box = useRef(null);
  const map = useRef(null);
  const tiles = useRef(null);
  const layer = useRef(null);
  const leaflet = useRef(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState(null); // files under a tapped pin
  useBackClose(Boolean(picked), () => setPicked(null));

  const located = useMemo(() => (files ?? []).filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng) && (f.kind === "image" || f.kind === "video")), [files]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !box.current || map.current) return;
      leaflet.current = L;
      map.current = L.map(box.current, { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView([22.5, 79], 4);
      L.control.zoom({ position: "bottomright" }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Light or dark map to match the app.
  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L) return;
    const theme = pref === "system" ? resolvedTheme() : pref;
    tiles.current?.remove();
    // OpenStreetMap's own tiles (free, no key). Dark mode recolours them (see globals.css).
    tiles.current = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);
    box.current?.classList.toggle("map-dark", theme !== "light");
  }, [ready, pref]);

  // Pins: grouped by screen distance, redrawn after every zoom/pan.
  useEffect(() => {
    const L = leaflet.current;
    const m = map.current;
    if (!ready || !L || !m) return;
    function draw() {
      layer.current.clearLayers();
      const cells = new Map();
      for (const f of located) {
        const p = m.project([f.lat, f.lng], m.getZoom());
        const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(f);
      }
      for (const group of cells.values()) {
        const lat = group.reduce((s, f) => s + f.lat, 0) / group.length;
        const lng = group.reduce((s, f) => s + f.lng, 0) / group.length;
        const size = group.length > 1 ? 56 : 48;
        const icon = L.divIcon({
          className: "",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          html: `<div class="ps-pin" style="width:${size}px;height:${size}px"><img src="${thumbUrl(group[0])}" alt="" loading="lazy">${group.length > 1 ? `<span>${group.length}</span>` : ""}</div>`,
        });
        L.marker([lat, lng], { icon, keyboard: true, title: `${group.length} photo${group.length === 1 ? "" : "s"}` })
          .on("click", () => setPicked(group))
          .addTo(layer.current);
      }
    }
    draw();
    m.on("zoomend", draw);
    if (!fitted.current && located.length) {
      fitted.current = true;
      m.fitBounds(L.latLngBounds(located.map((f) => [f.lat, f.lng])), { padding: [48, 48], maxZoom: 13 });
    }
    return () => m.off("zoomend", draw);
  }, [ready, located]);

  return (
    <div className="relative flex-1">
      {/* Fills the screen above the phone's tab bar. */}
      <div ref={box} className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] top-0 z-0 lg:bottom-0 lg:left-64" />

      <div className="pointer-events-none fixed inset-x-0 top-0 z-10 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:left-64 lg:px-6">
        <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-background/90 py-2 pl-3 pr-4 shadow-lg backdrop-blur-xl">
          <MapIcon size={18} className="text-accent" />
          <span className="text-sm font-semibold text-zinc-50">Map</span>
          <span className="text-sm text-zinc-500">· {located.length} with a location</span>
        </div>
      </div>

      {files && located.length === 0 && (
        <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 mx-auto max-w-md rounded-3xl bg-background/95 p-5 text-center shadow-2xl backdrop-blur-xl lg:bottom-6 lg:left-[calc(16rem+1.5rem)]">
          <EmptyMapArt className="mx-auto w-48" />
          <p className="mt-2 font-semibold text-zinc-50">No places yet</p>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
            Photos show up here when your camera saves where they were taken. On your phone, open <b className="text-zinc-300">Camera → Settings</b> and turn on <b className="text-zinc-300">Location tags</b>. New photos will appear here after they sync.
          </p>
        </div>
      )}

      {picked && (
        <div className="fixed inset-0 z-40 flex items-end lg:left-64">
          <div className="anim-fade absolute inset-0 bg-black/40" onClick={() => setPicked(null)} />
          <div className="anim-sheet relative max-h-[78dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-4 pb-2 pt-3 backdrop-blur-xl">
              <div className="flex-1">
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/15" />
                <p className="font-semibold text-zinc-50">
                  {picked.length} photo{picked.length === 1 ? "" : "s"} here
                </p>
              </div>
              <button onClick={() => setPicked(null)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/5">
                <CloseIcon size={20} />
              </button>
            </div>
            <div className="pb-4">
              <MediaBrowser files={picked} grouped={picked.length > 12} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
