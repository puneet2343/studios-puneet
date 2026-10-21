"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme-boot";

const THEME_COLORS = { dark: "#09090b", light: "#fbfbfc" };

function resolve(pref) {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function apply(pref) {
  const root = document.documentElement;
  const theme = resolve(pref);
  root.dataset.theme = theme;
  root.dataset.themePref = pref;
  // The app’s own choice wins over the phone setting, so drop the media conditions.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute("media");
    m.setAttribute("content", THEME_COLORS[theme]);
  });
  window.dispatchEvent(new Event("ps-theme"));
}

export function setThemePreference(pref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {}
  apply(pref);
}

function subscribe(callback) {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onSystemChange = () => {
    if (document.documentElement.dataset.themePref === "system") apply("system");
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener("ps-theme", callback);
  return () => {
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("ps-theme", callback);
  };
}

export function useThemePreference() {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.themePref || "system",
    () => "system"
  );
}
