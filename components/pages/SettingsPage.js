"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AppShell";
import { app, useAppEvent, useAppStatus, useInApp } from "@/components/appBridge";
import { StorageAlertsSwitch } from "@/components/StorageAlerts";
import { useToast } from "@/components/Toaster";
import {
  AlertIcon,
  ChevronRightIcon,
  ClockIcon,
  CloudCheckIcon,
  CopyIcon,
  DownloadIcon,
  DriveIcon,
  LogoutIcon,
  MonitorIcon,
  MoonIcon,
  PhoneIcon,
  RefreshIcon,
  SparkIcon,
  SunIcon,
  TrashIcon,
} from "@/components/icons";
import { FreeUpSpaceArt, PhoneSyncArt } from "@/components/Illustrations";
import BackupCard from "@/components/settings/BackupCard";
import Logo from "@/components/Logo";
import { useLibrary } from "@/components/library/store";
import PageHeader from "@/components/shell/PageHeader";
import { setThemePreference, useThemePreference } from "@/components/theme";
import { formatSize } from "@/lib/format";
import { storageLevel } from "@/lib/storage-levels";

const BUILT_AT = Number(process.env.NEXT_PUBLIC_BUILT_AT) || null;

function ago(t) {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function Section({ title, children }) {
  return (
    <section className="mb-6">
      {title && <h2 className="mb-2 px-1 text-sm font-semibold text-zinc-400">{title}</h2>}
      <div className="overflow-hidden rounded-3xl bg-surface">{children}</div>
    </section>
  );
}

function Row({ icon: Icon, title, subtitle, href, onClick, right, danger }) {
  const inner = (
    <>
      {Icon && (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? "bg-red-500/10 text-red-300" : "bg-accent-soft text-accent"}`}>
          <Icon size={19} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] font-medium ${danger ? "text-red-300" : "text-zinc-100"}`}>{title}</span>
        {subtitle && <span className="block text-[13px] text-zinc-500">{subtitle}</span>}
      </span>
      {right ?? ((href || onClick) && <ChevronRightIcon size={18} className="text-zinc-600" />)}
    </>
  );
  const cls = "flex w-full items-center gap-3.5 border-b border-line px-4 py-3.5 text-left last:border-0";
  if (href) return <Link href={href} className={`${cls} hover:bg-white/[0.03] active:bg-white/5`}>{inner}</Link>;
  if (onClick) return <button onClick={onClick} className={`${cls} hover:bg-white/[0.03] active:bg-white/5`}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

function Toggle({ on, onChange, label }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-zinc-700"}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-[#fff] shadow transition-all ${on ? "left-6" : "left-1"}`} />
    </button>
  );
}

// ----- This phone (inside the Android app) -----
function ThisPhone() {
  const toast = useToast();
  const status = useAppStatus();
  const [freeable, setFreeable] = useState(null); // { count, bytes } or { checking: true } or { error }

  useEffect(() => {
    const t = setTimeout(() => {
      setFreeable({ checking: true });
      app.checkFreeable();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useAppEvent(
    useCallback(
      (e) => {
        if (e.type === "freeable") setFreeable(e.error ? { error: e.error } : { count: e.count, bytes: e.bytes });
        if (e.type === "freed") {
          toast(e.count ? `Freed ${formatSize(e.bytes)} on this phone · ${e.count} item${e.count === 1 ? "" : "s"} (still safe on your PC)` : "Nothing was removed", { duration: 7000 });
          setFreeable({ checking: true });
          app.checkFreeable();
        }
      },
      [toast]
    )
  );

  if (!status) return null;
  const waiting = status.waiting ?? 0;
  const line = !status.photosAllowed
    ? { text: "Needs permission to see your photos", tone: "text-red-300", icon: AlertIcon }
    : status.paused
      ? { text: "Backup paused", tone: "text-zinc-400", icon: CloudCheckIcon }
      : status.current
        ? { text: `Backing up · ${waiting} left`, tone: "text-accent", icon: RefreshIcon }
        : status.error && waiting
          ? { text: status.error, tone: "text-amber-200", icon: AlertIcon }
          : waiting
            ? { text: `${waiting} waiting${status.online ? "" : " · no internet right now"}`, tone: "text-zinc-200", icon: CloudCheckIcon }
            : { text: "Backed up", tone: "text-emerald-300", icon: CloudCheckIcon };

  return (
    <>
      <Section title="This phone">
        <div className="flex items-center gap-3.5 px-4 py-4">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft ${line.tone}`}>
            <line.icon size={22} className={status.current ? "animate-spin [animation-duration:2.5s]" : ""} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-[17px] font-semibold ${line.tone}`}>{line.text}</p>
            <p className="truncate text-[13px] text-zinc-500">
              {status.current
                ? `${status.current} · ${status.percent}%`
                : `${status.alwaysOn ? "Always on · " : ""}${status.synced.toLocaleString("en-IN")} backed up · last ${ago(status.lastUpload)}`}
            </p>
          </div>
          <button onClick={() => app.syncNow()} className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#fff] active:scale-95">
            Sync now
          </button>
        </div>
        {!status.photosAllowed && <Row icon={AlertIcon} title="Allow photos & videos" subtitle={'Choose "Allow all" so new photos can back up'} onClick={() => app.allowPhotos()} danger />}
        {!status.backgroundAllowed && <Row icon={AlertIcon} title="Let it run in the background" subtitle="So backup keeps going when the app is closed" onClick={() => app.allowBackground()} />}
        {status.signedIn === false && (
          <Row icon={AlertIcon} title="Sign in again to back up" subtitle="Sign out and back in, so this phone can back up by itself" danger />
        )}
        {!status.allOld && (
          <Row icon={CloudCheckIcon} title="Back up older photos too" subtitle="Also send everything that was on this phone before" onClick={() => app.backupAll()} />
        )}
        <Row icon={PhoneIcon} title="Use Wi-Fi only" subtitle="Don't use mobile data for backup" right={<Toggle label="Use Wi-Fi only" on={status.wifiOnly} onChange={(on) => app.setWifiOnly(on)} />} />
        <Row icon={CloudCheckIcon} title="Pause backup" subtitle="Nothing is sent until you turn this off" right={<Toggle label="Pause backup" on={status.paused} onChange={(on) => app.setPaused(on)} />} />
      </Section>

      <Section title="Free up space">
        <div className="flex items-center gap-4 p-4">
          <FreeUpSpaceArt className="w-28 shrink-0" />
          <div className="min-w-0">
            {freeable?.checking || !freeable ? (
              <p className="text-sm text-zinc-500">Checking what&apos;s safely on your PC…</p>
            ) : freeable.error ? (
              <p className="text-sm text-amber-200">{freeable.error}</p>
            ) : freeable.count ? (
              <>
                <p className="text-[15px] font-semibold text-zinc-50">Free up {formatSize(freeable.bytes)}</p>
                <p className="mt-0.5 text-[13px] text-zinc-500">
                  {freeable.count.toLocaleString("en-IN")} photo{freeable.count === 1 ? "" : "s"} and video{freeable.count === 1 ? "" : "s"} on this phone are already backed up, byte for byte. Remove the phone&apos;s copies; they stay in Puneet Studios.
                </p>
                <button onClick={() => app.freeUpSpace()} className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#fff] active:scale-95">
                  Free up {formatSize(freeable.bytes)}
                </button>
              </>
            ) : (
              <>
                <p className="text-[15px] font-semibold text-zinc-50">Nothing to free up</p>
                <p className="mt-0.5 text-[13px] text-zinc-500">When photos are backed up, you can remove them from this phone here.</p>
              </>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}

// ----- Get the app (in a browser) -----
function GetTheApp({ app: apk }) {
  const [steps, setSteps] = useState(false);
  return (
    <Section>
      <div className="p-4">
        <div className="flex items-center gap-4">
          <PhoneSyncArt className="w-28 shrink-0" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-zinc-50">Back up your phone automatically</p>
            <p className="mt-0.5 text-[13px] text-zinc-500">The Puneet Studios Android app copies every new photo and video to your PC by itself, original quality, and can free up space on your phone.</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          {apk ? (
            <a href="/api/sync/app" download="PuneetStudios.apk" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-[#fff] active:scale-95">
              <DownloadIcon size={17} /> Get the Android app
            </a>
          ) : (
            <p className="flex-1 text-sm text-zinc-500">The Android app is being prepared on the PC.</p>
          )}
          <button onClick={() => setSteps((s) => !s)} className="h-11 rounded-full border border-line px-4 text-sm text-zinc-200">
            {steps ? "Hide" : "How"}
          </button>
        </div>
        {steps && (
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[13px] text-zinc-400">
            <li>Tap &quot;Get the Android app&quot; on your phone and open the file.</li>
            <li>If asked, allow installing from Chrome, then tap Install.</li>
            <li>Open Puneet Studios and sign in with your username and password.</li>
            <li>Allow photos & videos → choose &quot;Allow all&quot;.</li>
          </ol>
        )}
      </div>
    </Section>
  );
}

const THEMES = [
  { id: "light", label: "Light", icon: SunIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
  { id: "system", label: "Auto", icon: MonitorIcon },
];

export default function SettingsPage() {
  const { logout } = useAuth();
  const inApp = useInApp();
  const pref = useThemePreference();
  const { disk } = useLibrary();
  const [sync, setSync] = useState(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/sync", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setSync(d))
        .catch(() => {});
    const t = setTimeout(load, 0);
    const timer = setInterval(load, 20000);
    return () => {
      clearTimeout(t);
      clearInterval(timer);
    };
  }, []);

  const used = disk ? disk.total - disk.free : 0;
  const pct = disk ? Math.min(100, (used / disk.total) * 100) : 0;
  const level = disk ? storageLevel(disk) : "ok";
  const version = BUILT_AT ? new Date(BUILT_AT).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 sm:px-6 lg:pb-12">
      <PageHeader flush version title="Settings" />

      <div className="mb-6 mt-1 flex items-center gap-4 rounded-3xl bg-gradient-to-br from-[#ff9a5a]/15 via-[#f0457f]/10 to-[#6a5cf0]/15 p-4">
        <Logo size={52} />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-zinc-50">Puneet Studios</p>
          <p className="text-[13px] text-zinc-500">Signed in · your studio PC{version ? ` · updated ${version}` : ""}</p>
        </div>
      </div>

      {inApp ? <ThisPhone /> : <GetTheApp app={sync?.app} />}

      <Section title="Backup copy (external drive)">
        <BackupCard librarySize={disk?.media ?? 0} />
      </Section>

      <Section title="Backup">
        <Row icon={ClockIcon} title="Backup history" subtitle="Every photo and video your phones sent, and duplicates skipped" href="/history" />
        <Row icon={SparkIcon} title="Updates" subtitle="What's new, and the phone app's version" href="/updates" />
      </Section>

      {sync?.devices?.length > 0 && (
        <Section title="Phones backing up">
          {sync.devices.map((d) => (
            <Row
              key={d.device}
              icon={PhoneIcon}
              title={d.device}
              subtitle={`${d.error ? d.error : d.pending ? `${d.pending} waiting` : "Backed up"} · ${d.synced.toLocaleString("en-IN")} sent · seen ${ago(d.lastSeen)}`}
            />
          ))}
        </Section>
      )}

      <Section title="Studio PC">
        {disk && (
          <div className="border-b border-line px-4 py-4">
            <div className="mb-2 flex items-center gap-2 text-[15px] font-medium text-zinc-100">
              <DriveIcon size={18} className="text-accent" />
              Storage
              <span className="ml-auto text-sm tabular-nums text-zinc-500">{formatSize(disk.free)} free</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${level === "critical" ? "bg-red-400" : level === "low" ? "bg-amber-400" : "bg-gradient-to-r from-[#ff9a5a] via-[#f0457f] to-[#6a5cf0]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[13px] text-zinc-500">Photos & videos use {formatSize(disk.media)}</p>
          </div>
        )}
        <Row icon={TrashIcon} title="Recycle Bin" subtitle="Deleted items, kept for 3 days" href="/trash" />
        <Row icon={CopyIcon} title="Duplicates" subtitle="Find copies and free space on the PC" href="/duplicates" />
        {!inApp && (
          <div className="px-4 py-2">
            <StorageAlertsSwitch />
          </div>
        )}
      </Section>

      <Section title="Appearance">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1.5 p-2">
          {THEMES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="radio"
              aria-checked={pref === id}
              onClick={() => setThemePreference(id)}
              className={`flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-medium transition-colors ${pref === id ? "bg-accent text-[#fff]" : "text-zinc-300 hover:bg-white/5"}`}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
        </div>
      </Section>

      <Section>
        <Row icon={LogoutIcon} title="Sign out" onClick={logout} danger />
      </Section>
    </div>
  );
}
