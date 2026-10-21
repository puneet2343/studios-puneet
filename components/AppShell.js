"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import Logo from "@/components/Logo";
import Toaster, { useToast } from "@/components/Toaster";
import {
  CalendarIcon,
  ChevronRightIcon,
  CopyIcon,
  DotsIcon,
  DriveIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  GearIcon,
  InstagramIcon,
  LogoutIcon,
  MediaIcon,
  MonitorIcon,
  MoonIcon,
  PlaneIcon,
  RefreshIcon,
  SunIcon,
  TrashIcon,
  WifiOffIcon,
} from "@/components/icons";
import { setThemePreference, useThemePreference } from "@/components/theme";
import useBackClose, { closeOverlaysThen, useExitGuard } from "@/components/useBackClose";
import { formatSize } from "@/lib/format";
import { storageLevel } from "@/lib/storage-levels";
import { StorageAlertsSwitch } from "@/components/StorageAlerts";

// Add new features here: a live item needs an href; items without one show as "Soon".
// `tab: true` also puts it in the phone's bottom tab bar.
const NAV = [
  {
    section: "Library",
    items: [{ label: "Media", href: "/", icon: MediaIcon, tab: true }],
  },
  {
    section: "Create",
    items: [{ label: "Instagram Export", short: "Instagram", href: "/instagram", icon: InstagramIcon, tab: true }],
  },
  {
    section: "Plan",
    items: [{ label: "Trip Planner", short: "Trips", href: "/trips", icon: PlaneIcon, tab: true }],
  },
  {
    section: "Tools",
    items: [
      { label: "Recycle Bin", href: "/trash", icon: TrashIcon, tool: true },
      { label: "Duplicates", href: "/duplicates", icon: CopyIcon, tool: true },
    ],
  },
  {
    section: "Coming soon",
    items: [
      { label: "Projects", icon: FolderIcon },
      { label: "Content calendar", icon: CalendarIcon },
    ],
  },
];
const TABS = NAV.flatMap((g) => g.items).filter((i) => i.tab);
// On phones these live in the "More" sheet.
const TOOLS = NAV.flatMap((g) => g.items).filter((i) => i.tool);
const AUTH_HINT = "ps.authed";

const ShellContext = createContext({ loggedOut: () => {}, setStorage: () => {} });

export function useAuth() {
  return useContext(ShellContext);
}

const isActive = (href, pathname) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

// Remembers that this device was signed in, so returning users go straight to the app
// instead of seeing the login screen flash while the session is checked.
function useAuthHint() {
  return useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(AUTH_HINT) === "1";
      } catch {
        return false;
      }
    },
    () => false
  );
}
// Installed phone apps stay paused in memory, so reopening them shows the old version.
// This notices when the studio PC is running a newer build: coming back to the app
// reloads it straight away; if the app is open at the time, a banner offers the update.
// Uploads and trims in progress hold the reload off (window.__psBusy).
// Also returns when the running version was built, shown under the app name.
// The version this copy of the app is (baked in when it was built), not what the PC
// says, so an old copy loaded from the phone's cache is still recognised as old.
const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID;
const MY_BUILT_AT = Number(process.env.NEXT_PUBLIC_BUILT_AT) || null;
const RELOADS_KEY = "ps.update.reloads";

// Reload, but never more than twice a minute (in case the PC keeps sending an old copy).
function reloadForUpdate() {
  try {
    const recent = JSON.parse(sessionStorage.getItem(RELOADS_KEY) || "[]").filter((t) => Date.now() - t < 60000);
    if (recent.length >= 2) return false;
    sessionStorage.setItem(RELOADS_KEY, JSON.stringify([...recent, Date.now()]));
  } catch {}
  window.location.reload();
  return true;
}

function useAutoUpdate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const idle = () => !(window.__psBusy > 0);
    // `fresh`: the app was just opened or brought back, so refreshing won't interrupt anything.
    async function check(fresh) {
      const info = await fetch("/api/version", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!info?.build || !MY_BUILD || info.build === MY_BUILD) return;
      // Out of date: refresh now if nothing's going on, otherwise offer it.
      if (fresh && idle() && reloadForUpdate()) return;
      setReady(true);
    }
    check(true);
    const timer = setInterval(() => document.visibilityState === "visible" && check(false), 30000);
    const onVisible = () => document.visibilityState === "visible" && check(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return { ready, builtAt: MY_BUILT_AT };
}

// Phone top bar: tucks away while scrolling down through media, comes back on the
// slightest scroll up (or near the top), like Instagram.
function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 80) setHidden(false);
        else if (y > last + 6) setHidden(true);
        else if (y < last - 6) setHidden(false);
        last = y;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return hidden;
}

// "Tue, 21 Oct · 11:14 am": when the running version was built.
function versionLabel(builtAt) {
  if (!builtAt) return null;
  const d = new Date(builtAt);
  const day = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${day} · ${time}`;
}

// Back with nothing open on the first screen: "Press back again to exit" (not an instant exit).
function ExitGuard() {
  const toast = useToast();
  useExitGuard(true, () => toast("Press back again to exit", { duration: 2000 }));
  return null;
}

function setAuthHint(on) {
  try {
    if (on) localStorage.setItem(AUTH_HINT, "1");
    else localStorage.removeItem(AUTH_HINT);
  } catch {}
}

export default function AppShell({ children }) {
  const [authed, setAuthed] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storage, setStorage] = useState(null);
  const { ready: updateReady, builtAt } = useAutoUpdate();
  const barHidden = useHideOnScroll();
  const version = versionLabel(builtAt);
  const pathname = usePathname();
  const router = useRouter();
  const hint = useAuthHint();
  useBackClose(settingsOpen, () => setSettingsOpen(false));

  // authed: null = checking, true / false = known, "offline" = the studio PC didn't answer.
  const check = useCallback(() => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8000);
    fetch("/api/login", { cache: "no-store", signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setAuthHint(d.authed);
        setAuthed(d.authed);
      })
      .catch(() => setAuthed((a) => (a === true || a === false ? a : "offline")))
      .finally(() => clearTimeout(timeout));
  }, []);

  useEffect(() => {
    check();
    // Offline launch support (public/sw.js). Skipped in `next dev`, where files change constantly.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [check]);

  // While offline, keep knocking quietly; the screen switches as soon as the PC answers.
  useEffect(() => {
    if (authed !== "offline") return;
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [authed, check]);

  const loggedOut = useCallback(() => {
    setAuthHint(false);
    setAuthed(false);
  }, []);

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    setSettingsOpen(false);
    loggedOut();
  }

  if (authed === false) {
    return (
      <Toaster>
        <Login
          onDone={() => {
            setAuthHint(true);
            setAuthed(true);
          }}
        />
      </Toaster>
    );
  }
  // Signed-in devices skip both screens and open straight onto the cached library.
  if (authed === "offline" && !hint) return <Offline onRetry={check} />;
  if (authed === null && !hint) return <Splash />;

  const current = NAV.flatMap((g) => g.items).find((i) => i.href && isActive(i.href, pathname));
  const onTool = Boolean(current?.tool);
  // Which bottom tab the sliding highlight sits under (the last slot is "More").
  const tabIndex = settingsOpen || onTool ? TABS.length : Math.max(0, TABS.findIndex((t) => isActive(t.href, pathname)));

  return (
    <ShellContext.Provider value={{ loggedOut, setStorage }}>
      <Toaster>
        <ExitGuard />
        <div className="flex min-h-dvh flex-1">
          {/* Desktop sidebar */}
          <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-white/[0.06] bg-zinc-950 lg:block">
            <nav className="flex h-full flex-col">
              <div className="flex items-center gap-3 px-5 pb-6 pt-6">
                <Logo size={34} />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold tracking-tight text-zinc-100">Puneet Studios</p>
                  <p className="truncate text-xs tabular-nums text-zinc-500">{version ? `Version · ${version}` : "Creator workspace"}</p>
                </div>
              </div>
              <div className="flex-1 space-y-7 overflow-y-auto px-3">
                {NAV.map((group) => (
                  <div key={group.section}>
                    <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-600">{group.section}</p>
                    <ul className="space-y-0.5">
                      {group.items.map(({ label, href, icon: Icon }) => {
                        const active = href && isActive(href, pathname);
                        const base = "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150";
                        return (
                          <li key={label}>
                            {href ? (
                              <Link
                                href={href}
                                className={`${base} ${active ? "bg-white/[0.06] text-zinc-50" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"}`}
                              >
                                {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-violet-400" />}
                                <Icon className={active ? "text-violet-300" : ""} />
                                {label}
                              </Link>
                            ) : (
                              <span className={`${base} cursor-default text-zinc-600`}>
                                <Icon />
                                {label}
                                <span className="ml-auto rounded-md border border-white/5 px-1.5 py-px text-[10px] text-zinc-600">Soon</span>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="space-y-1 p-3">
                {storage && <StorageMeter storage={storage} />}
                <ThemeSwitch />
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
                >
                  <LogoutIcon />
                  Log out
                </button>
              </div>
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0">
            {/* Phone top bar: just where you are. Navigation lives in the bottom tabs. */}
            <div
              className={`sticky top-0 z-30 flex items-center gap-2.5 border-b border-white/[0.06] bg-zinc-950/85 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-xl transition-transform duration-300 ease-out lg:hidden ${
                barHidden ? "-translate-y-full" : ""
              }`}
            >
              <Logo size={32} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[15px] font-semibold tracking-tight text-zinc-100">Puneet Studios</p>
                <p className={`truncate text-[11px] tabular-nums text-zinc-500 transition-opacity duration-300 ${version ? "opacity-100" : "opacity-0"}`}>
                  Version · {version ?? "…"}
                </p>
              </div>
              {current && <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-zinc-300">{current.short ?? current.label}</span>}
            </div>

            <div key={pathname} className="anim-fade flex flex-1 flex-col">
              {children}
            </div>

            {updateReady && (
              <button
                onClick={() => window.location.reload()}
                className="anim-rise fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[65] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-violet-500 py-2 pl-3 pr-4 text-sm font-medium text-[#fff] shadow-xl shadow-violet-900/30 active:scale-95"
              >
                <RefreshIcon size={15} />
                New version ready · Tap to update
              </button>
            )}
          </div>

          {/* Phone bottom tab bar */}
          <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
            <ul className="relative mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${TABS.length + 1}, minmax(0, 1fr))` }}>
              {/* One highlight that glides to the active tab. */}
              <span
                aria-hidden="true"
                className="tab-glide pointer-events-none absolute top-[0.4375rem] h-7 w-12 rounded-full bg-white/[0.09]"
                style={{ left: `calc(${(tabIndex * 100) / (TABS.length + 1)}% + (${100 / (TABS.length + 1)}% - 3rem) / 2)` }}
              />
              {TABS.map(({ label, short, href, icon: Icon }) => {
                const active = isActive(href, pathname);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={`flex h-[3.75rem] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150 active:scale-95 ${
                        active ? "text-zinc-50" : "text-zinc-500"
                      }`}
                    >
                      <span className={`relative flex h-7 w-12 items-center justify-center transition-transform duration-200 ${active ? "scale-105" : ""}`}>
                        <Icon size={20} strokeWidth={active ? 2.1 : 1.8} />
                      </span>
                      {short ?? label}
                    </Link>
                  </li>
                );
              })}
              <li>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className={`flex h-[3.75rem] w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors active:scale-95 ${
                    settingsOpen || onTool ? "text-zinc-50" : "text-zinc-500"
                  }`}
                >
                  <span className={`relative flex h-7 w-12 items-center justify-center transition-transform duration-200 ${settingsOpen || onTool ? "scale-105" : ""}`}>
                    <DotsIcon size={20} className="rotate-90" />
                  </span>
                  More
                </button>
              </li>
            </ul>
          </nav>

          {settingsOpen && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <div className="anim-fade absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSettingsOpen(false)} />
              <div className="anim-sheet absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white/[0.08] bg-zinc-950 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl">
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
                <div className="mb-5 flex items-center gap-3 px-1">
                  <Logo size={40} />
                  <div>
                    <p className="font-semibold text-zinc-100">Puneet Studios</p>
                    <p className="text-xs text-zinc-500">Signed in · studio PC</p>
                    {version && <p className="text-xs tabular-nums text-zinc-500">Version · {version}</p>}
                  </div>
                </div>
                <p className="mb-2 px-1 text-xs font-medium uppercase tracking-[0.06em] text-zinc-500">Tools</p>
                <div className="mb-5 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
                  {TOOLS.map(({ label, href, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={(e) => {
                        // Close the sheet (and its Back entry) first, then open the page,
                        // so Back from that page returns straight here.
                        e.preventDefault();
                        closeOverlaysThen(() => router.push(href));
                      }}
                      className="flex items-center gap-3 border-b border-white/[0.05] px-4 py-3.5 text-[15px] text-zinc-100 last:border-0 active:bg-white/5"
                    >
                      <Icon size={19} className="text-zinc-400" />
                      <span className="flex-1">{label}</span>
                      <ChevronRightIcon size={16} className="text-zinc-600" />
                    </Link>
                  ))}
                </div>
                <p className="mb-2 px-1 text-xs font-medium uppercase tracking-[0.06em] text-zinc-500">Appearance</p>
                <ThemeSwitch large />
                {storage && (
                  <>
                    <p className="mb-2 mt-5 px-1 text-xs font-medium uppercase tracking-[0.06em] text-zinc-500">Storage</p>
                    <StorageMeter storage={storage} />
                    <StorageAlertsSwitch />
                  </>
                )}
                <button
                  onClick={logout}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] py-3 text-sm font-medium text-red-300 transition-colors active:bg-white/5"
                >
                  <LogoutIcon size={17} />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </Toaster>
    </ShellContext.Provider>
  );
}

// Soft brand glow behind the opening screens.
function Glow() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="glow-drift absolute left-1/2 top-[38%] h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/[0.13] blur-3xl" />
      <div className="glow-drift-alt absolute left-[58%] top-[46%] h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/[0.09] blur-3xl" />
    </div>
  );
}

function Brand({ subtitle }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="anim-logo relative">
        <div className="absolute inset-0 rounded-[22px] bg-gradient-to-br from-violet-500 to-sky-500 opacity-40 blur-xl" />
        <Logo size={64} className="relative" />
      </div>
      <h1 className="anim-rise mt-6 text-[26px] font-semibold tracking-tight text-zinc-50 [animation-delay:80ms]">Puneet Studios</h1>
      <p className="anim-rise mt-1.5 text-sm text-zinc-500 [animation-delay:140ms]">{subtitle}</p>
    </div>
  );
}

// Shown only on a device that hasn't signed in yet, while the PC is being reached.
// The fade-in delay means a fast connection never flashes it at all.
function Splash() {
  return (
    <div className="anim-fade relative flex flex-1 flex-col items-center justify-center p-6 [animation-delay:150ms]">
      <Glow />
      <div className="relative">
        <Brand subtitle="Connecting to your studio PC" />
        <div className="mx-auto mt-8 h-[3px] w-28 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="progress-sweep h-full w-1/3 rounded-full bg-gradient-to-r from-violet-400 to-sky-400" />
        </div>
      </div>
    </div>
  );
}

function Offline({ onRetry }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="relative flex flex-1 items-center justify-center p-6">
      <Glow />
      <div className="anim-rise relative w-full max-w-[360px] text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-zinc-300">
          <WifiOffIcon size={28} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Studio PC is offline</h1>
        <p className="mt-1.5 text-sm text-zinc-500">Your media lives on the office PC. It isn&apos;t answering right now.</p>
        <ul className="mt-6 space-y-2 text-left text-sm">
          {[
            ["Tailscale is on", "Open the Tailscale app on this phone and switch it on."],
            ["The app is running on the PC", "On the office PC, run npm start in the project folder."],
          ].map(([title, hint]) => (
            <li key={title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <p className="font-medium text-zinc-200">{title}</p>
              <p className="mt-0.5 text-[13px] text-zinc-500">{hint}</p>
            </li>
          ))}
        </ul>
        <button
          onClick={() => {
            setBusy(true);
            onRetry();
            setTimeout(() => setBusy(false), 1200);
          }}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-semibold text-zinc-950 transition-[background-color,transform] hover:bg-zinc-200 active:scale-[0.98]"
        >
          <RefreshIcon size={16} className={busy ? "animate-spin" : ""} />
          Try again
        </button>
        <p className="mt-3 text-xs text-zinc-600">Retrying automatically every few seconds</p>
      </div>
    </div>
  );
}

const THEMES = [
  { id: "light", label: "Light", icon: SunIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
  { id: "system", label: "Auto", icon: MonitorIcon },
];

function ThemeSwitch({ large = false }) {
  const pref = useThemePreference();
  return (
    <div role="radiogroup" aria-label="Theme" className="mb-1 grid grid-cols-3 gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
      {THEMES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={pref === id}
          onClick={() => setThemePreference(id)}
          className={`flex items-center justify-center gap-1.5 rounded-lg transition-colors duration-150 ${large ? "py-2.5 text-sm" : "py-1.5 text-xs"} ${
            pref === id ? "bg-white/[0.08] text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-200"
          }`}
        >
          <Icon size={large ? 16 : 14} />
          {label}
        </button>
      ))}
    </div>
  );
}

function StorageMeter({ storage }) {
  const used = storage.total - storage.free;
  const pct = Math.min(100, (used / storage.total) * 100);
  const level = storageLevel(storage);
  return (
    <div className="mb-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
        <DriveIcon size={15} />
        <span>PC storage</span>
        <span className="ml-auto tabular-nums text-zinc-500">{Math.round(pct)}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ${level === "critical" ? "bg-red-400" : level === "low" ? "bg-amber-400" : "bg-gradient-to-r from-violet-400 to-sky-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] tabular-nums text-zinc-500">
        {formatSize(storage.free)} free · media {formatSize(storage.media)}
      </p>
    </div>
  );
}

function Login({ onDone }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDone();
    else setError(res ? "Wrong username or password." : "Can't reach the studio PC. Is Tailscale on?");
  }

  const input =
    "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/60 focus:bg-white/[0.05]";

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
      <Glow />
      <form onSubmit={submit} className="relative w-full max-w-[360px]">
        <div className="mb-9">
          <Brand subtitle="Sign in to your creator workspace" />
        </div>
        <div className="anim-rise space-y-2.5 [animation-delay:200ms]">
          <input
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className={input}
          />
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={`${input} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-zinc-500 transition-colors hover:text-zinc-200"
            >
              {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </div>
        </div>
        <p className={`h-6 pt-1.5 text-sm text-red-400 transition-opacity ${error ? "opacity-100" : "opacity-0"}`}>{error}</p>
        <button
          disabled={busy || !username || !password}
          className="anim-rise mt-1 w-full rounded-xl bg-white py-3 text-sm font-semibold text-zinc-950 transition-[background-color,transform,opacity] [animation-delay:240ms] hover:bg-zinc-200 active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="anim-fade mt-8 text-center text-xs text-zinc-600 [animation-delay:320ms]">Private · only reachable over your Tailscale network</p>
      </form>
    </div>
  );
}
