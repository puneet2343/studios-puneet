"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { app, inApp } from "@/components/appBridge";
import { LoginHero } from "@/components/Illustrations";
import Logo from "@/components/Logo";
import Toaster, { useToast } from "@/components/Toaster";
import { AlbumsIcon, EyeIcon, EyeOffIcon, GearIcon, MapIcon, PhotosIcon, RefreshIcon, WifiOffIcon } from "@/components/icons";
import { clearLibraryCache, setUnauthorizedHandler } from "@/components/library/store";
import { useExitGuard } from "@/components/useBackClose";

// Four places, like Google Photos: Photos (everything by date), Albums (trips, albums,
// favourites), Map (where photos were taken) and Settings (phone backup, storage…).
const TABS = [
  { label: "Photos", href: "/", icon: PhotosIcon },
  { label: "Albums", href: "/albums", icon: AlbumsIcon },
  { label: "Map", href: "/map", icon: MapIcon },
  { label: "Settings", href: "/settings", icon: GearIcon, also: ["/trash", "/duplicates", "/history", "/updates", "/cleanup"] },
];
const AUTH_HINT = "ps.authed";

const ShellContext = createContext({ loggedOut: () => {}, logout: () => {}, setStorage: () => {} });
export function useAuth() {
  return useContext(ShellContext);
}

const isActive = (tab, pathname) =>
  tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href) || (tab.also ?? []).some((p) => pathname.startsWith(p));

// Remembers this device was signed in, so returning users open straight onto their photos.
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
function setAuthHint(on) {
  try {
    if (on) localStorage.setItem(AUTH_HINT, "1");
    else localStorage.removeItem(AUTH_HINT);
  } catch {}
}

// The PC rebuilds the app by itself when it changes; open phones pick the new version up
// (straight away when the app is reopened, or via a small banner while it's in use).
// Uploads and video edits in progress hold the reload off (window.__psBusy).
const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID;
const RELOADS_KEY = "ps.update.reloads";
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
    async function check(fresh) {
      const info = await fetch("/api/version", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!info?.build || !MY_BUILD || info.build === MY_BUILD) return;
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
  return ready;
}

// Inside the Android app: keep the phone's status/navigation bars in the app's colours.
function useAppBars() {
  useEffect(() => {
    if (!inApp()) return;
    const sync = () => app.setTheme(document.documentElement.dataset.theme !== "light");
    sync();
    window.addEventListener("ps-theme", sync);
    return () => window.removeEventListener("ps-theme", sync);
  }, []);
}

function ExitGuard() {
  const toast = useToast();
  useExitGuard(true, () => toast("Press back again to exit", { duration: 2000 }));
  return null;
}

export default function AppShell({ children }) {
  const [authed, setAuthed] = useState(null); // null = checking, true/false, "offline"
  const updateReady = useAutoUpdate();
  const pathname = usePathname();
  const hint = useAuthHint();
  useAppBars();

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
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [check]);

  useEffect(() => {
    if (authed !== "offline") return;
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [authed, check]);

  useEffect(() => {
    if (authed !== true || process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "warm", paths: TABS.map((t) => t.href) })).catch(() => {});
  }, [authed]);

  const loggedOut = useCallback(() => {
    setAuthHint(false);
    setAuthed(false);
  }, []);
  useEffect(() => setUnauthorizedHandler(loggedOut), [loggedOut]);

  const logout = useCallback(async () => {
    await fetch("/api/login", { method: "DELETE" }).catch(() => {});
    clearLibraryCache();
    // In the Android app, signing out also stops this phone's backup.
    if (inApp()) app.signOut();
    loggedOut();
  }, [loggedOut]);

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
  if (authed === "offline" && !hint) return <Offline onRetry={check} />;
  if (authed === null && !hint) return <Splash />;

  return (
    <ShellContext.Provider value={{ loggedOut, logout, setStorage: () => {} }}>
      <Toaster>
        <ExitGuard />
        <div className="flex min-h-dvh flex-1">
          {/* Computer: a calm sidebar. */}
          <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-background px-3 py-5 lg:flex">
            <div className="mb-7 flex items-center gap-3 px-3">
              <Logo size={36} />
              <span className="text-[17px] font-semibold tracking-tight text-zinc-50">Puneet Studios</span>
            </div>
            <nav className="space-y-1">
              {TABS.map((tab) => {
                const active = isActive(tab, pathname);
                const Icon = tab.icon;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`flex h-12 items-center gap-4 rounded-full px-4 text-[15px] font-medium transition-colors ${
                      active ? "bg-accent-soft text-accent" : "text-zinc-300 hover:bg-white/5"
                    }`}
                  >
                    <Icon size={21} strokeWidth={active ? 2.1 : 1.8} />
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col lg:pl-64">
            <div key={pathname.split("/")[1] || "photos"} className="anim-fade flex flex-1 flex-col">
              {children}
            </div>
          </main>

          {/* Phone: four tabs at the bottom, the active one in a soft pill. */}
          <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-background pb-[env(safe-area-inset-bottom)] lg:hidden">
            <ul className="mx-auto grid max-w-lg grid-cols-4">
              {TABS.map((tab) => {
                const active = isActive(tab, pathname);
                const Icon = tab.icon;
                return (
                  <li key={tab.href}>
                    <Link href={tab.href} className="flex h-[4.5rem] flex-col items-center justify-center gap-1 short:h-12 short:gap-0">
                      <span className={`flex h-8 w-16 items-center justify-center rounded-full transition-colors duration-200 ${active ? "bg-accent-soft text-accent" : "text-zinc-400"}`}>
                        <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                      </span>
                      <span className={`text-xs font-medium short:sr-only ${active ? "text-zinc-50" : "text-zinc-500"}`}>{tab.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {updateReady && (
            <button
              onClick={() => window.location.reload()}
              className="anim-rise fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[65] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-accent py-2 pl-3 pr-4 text-sm font-medium text-[#fff] shadow-xl active:scale-95"
            >
              <RefreshIcon size={15} />
              New version ready · Tap to update
            </button>
          )}
        </div>
      </Toaster>
    </ShellContext.Provider>
  );
}

function Splash() {
  return (
    <div className="anim-fade flex flex-1 flex-col items-center justify-center p-6 [animation-delay:150ms]">
      <div className="anim-logo">
        <Logo size={72} />
      </div>
      <p className="mt-5 text-xl font-semibold tracking-tight text-zinc-50">Puneet Studios</p>
      <div className="mt-6 h-1 w-24 overflow-hidden rounded-full bg-surface-2">
        <div className="progress-sweep h-full w-1/3 rounded-full bg-accent" />
      </div>
    </div>
  );
}

function Offline({ onRetry }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="anim-rise w-full max-w-[360px] text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface text-zinc-300">
          <WifiOffIcon size={28} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Can&apos;t reach your PC</h1>
        <p className="mt-1.5 text-sm text-zinc-500">Your photos live on the studio PC. Check that Tailscale is on (on this phone) and Puneet Studios is running on the PC.</p>
        <button
          onClick={() => {
            setBusy(true);
            onRetry();
            setTimeout(() => setBusy(false), 1200);
          }}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-[#fff] active:scale-[0.98]"
        >
          <RefreshIcon size={16} className={busy ? "animate-spin" : ""} />
          Try again
        </button>
        <p className="mt-3 text-xs text-zinc-500">Retrying by itself every few seconds</p>
      </div>
    </div>
  );
}

function Login({ onDone }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

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
    if (res?.ok) {
      // In the Android app: the app signs in too, so it can back up this phone by itself.
      if (inApp()) app.signedIn(username.trim(), password);
      onDone();
    }
    else setError(res ? "That username or password isn't right." : "Can't reach your PC. Is Tailscale on?");
  }

  const input =
    "peer h-14 w-full rounded-2xl border border-line bg-surface px-4 pt-4 text-[16px] text-zinc-50 outline-none transition-colors focus:border-accent focus:bg-background";
  const label =
    "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-zinc-500 transition-all peer-focus:top-4 peer-focus:text-xs peer-focus:text-accent peer-[:not(:placeholder-shown)]:top-4 peer-[:not(:placeholder-shown)]:text-xs";

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:flex-row">
      {/* Art: top on phones, left half on computers. */}
      <div className="relative flex items-end justify-center overflow-hidden bg-gradient-to-br from-[#fff1e8] via-[#ffe4ef] to-[#e9e6ff] px-6 pb-2 pt-[max(2rem,env(safe-area-inset-top))] lg:w-1/2 lg:items-center lg:p-12">
        <div className="w-full max-w-md">
          <LoginHero className="anim-pop w-full" />
          <p className="mt-2 hidden text-center text-2xl font-semibold tracking-tight text-[#1f1a2e] lg:block">Every photo. Original quality. On your own PC.</p>
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center px-6 pb-10 pt-8 lg:items-center">
        <form onSubmit={submit} className="anim-rise w-full max-w-[380px]">
          <div className="mb-7 flex items-center gap-3">
            <Logo size={48} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Puneet Studios</h1>
              <p className="text-sm text-zinc-500">Sign in to see your photos</p>
            </div>
          </div>
          <div className="space-y-3">
            <label className="relative block">
              <input autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder=" " value={username} onChange={(e) => setUsername(e.target.value)} className={input} />
              <span className={label}>Username</span>
            </label>
            <label className="relative block">
              <input
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder=" "
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${input} pr-14`}
              />
              <span className={label}>Password</span>
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 hover:text-zinc-200"
              >
                {show ? <EyeOffIcon size={19} /> : <EyeIcon size={19} />}
              </button>
            </label>
          </div>
          <p className={`min-h-6 pt-2 text-sm text-red-400 ${error ? "" : "invisible"}`}>{error || "."}</p>
          <button
            disabled={busy || !username || !password}
            className="mt-1 h-14 w-full rounded-2xl bg-accent text-[16px] font-semibold text-[#fff] transition-[background-color,transform,opacity] hover:bg-accent-strong active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="mt-6 text-center text-xs text-zinc-500">Private · only reachable over your own Tailscale network</p>
        </form>
      </div>
    </div>
  );
}
