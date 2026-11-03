"use client";

import { useCallback, useEffect, useState } from "react";
import { app, useAppEvent, useAppStatus, useInApp } from "@/components/appBridge";
import { CheckIcon, RefreshIcon, SparkIcon } from "@/components/icons";
import PageHeader from "@/components/shell/PageHeader";
import { CHANGELOG } from "@/lib/changelog";

const BUILT_AT = Number(process.env.NEXT_PUBLIC_BUILT_AT) || null;
const when = (t) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

// What changed, newest first, and (in the phone app) checking for a newer app version.
export default function UpdatesPage() {
  const inApp = useInApp();
  const status = useAppStatus();
  const [update, setUpdate] = useState(null); // { state, version }
  const [latestApp, setLatestApp] = useState(null);

  useEffect(() => {
    fetch("/api/sync/app?info=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLatestApp(d))
      .catch(() => {});
  }, []);

  useAppEvent(useCallback((e) => e.type === "update" && setUpdate(e), []));

  const behind = inApp && status && latestApp && latestApp.versionCode > (status.versionCode ?? 0);
  const label = {
    latest: "You have the latest version",
    downloading: `Downloading version ${update?.version}…`,
    installing: "Installing… tap Update if Android asks",
    failed: "Couldn't update right now. It will try again by itself.",
  }[update?.state];

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 sm:px-6 lg:pb-12">
      <PageHeader flush title="Updates" subtitle={`Version ${CHANGELOG[0].version}${BUILT_AT ? ` · updated ${when(BUILT_AT)}` : ""}`} />

      <div className="mb-6 mt-1 rounded-3xl bg-gradient-to-br from-[#ff9a5a]/15 via-[#f0457f]/10 to-[#6a5cf0]/15 p-4">
        <p className="text-[15px] font-semibold text-zinc-50">Updates install by themselves</p>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
          Screens and features update the moment they change on your PC. When the phone app itself changes, it downloads the new version and installs it over the old one; your sign-in, photos and history stay.
        </p>
        {inApp && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[13px] text-zinc-300">
              Phone app {status?.version ?? "…"}
              {behind ? ` · version ${latestApp.versionName} is ready` : status ? " · up to date" : ""}
            </span>
            <button
              onClick={() => {
                setUpdate({ state: "checking" });
                app.checkUpdate();
              }}
              className="ml-auto flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-sm font-semibold text-[#fff] active:scale-95"
            >
              <RefreshIcon size={15} className={update?.state === "checking" || update?.state === "downloading" ? "animate-spin" : ""} />
              {behind ? "Update now" : "Check"}
            </button>
          </div>
        )}
        {label && <p className="mt-2 text-[13px] text-accent">{label}</p>}
      </div>

      <ol className="relative space-y-5 border-l-2 border-line pl-5">
        {CHANGELOG.map((u, i) => (
          <li key={u.version} className="relative">
            <span className={`absolute -left-[1.95rem] top-0.5 flex h-6 w-6 items-center justify-center rounded-full ${i === 0 ? "bg-accent text-[#fff]" : "bg-surface-2 text-zinc-400"}`}>
              {i === 0 ? <SparkIcon size={13} /> : <CheckIcon size={13} strokeWidth={2.5} />}
            </span>
            <p className="text-[15px] font-semibold text-zinc-50">
              Version {u.version} <span className="font-normal text-zinc-500">· {new Date(`${u.date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
            </p>
            <p className="text-sm font-medium text-accent">{u.title}</p>
            <ul className="mt-1.5 space-y-1">
              {u.items.map((t) => (
                <li key={t} className="text-[13px] leading-relaxed text-zinc-400">
                  • {t}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
