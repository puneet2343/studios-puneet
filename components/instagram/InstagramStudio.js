"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AppShell";
import { useToast } from "@/components/Toaster";
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  DiamondIcon,
  DownloadIcon,
  InfoIcon,
  InstagramIcon,
  PlayIcon,
  SparkIcon,
  UploadIcon,
} from "@/components/icons";
import useUploader from "@/components/media/useUploader";
import { downloadUrl, fileUrl, thumbUrl } from "@/components/media/urls";
import useBackClose from "@/components/useBackClose";
import { formatDuration, formatEta, formatSize } from "@/lib/format";

const DEFAULTS = { format: "reel", framing: "fill", fps: "auto", color: "sdr", denoise: false, loudness: true, trim: true };
const sourceUrl = (file) => `/api/instagram/source?name=${encodeURIComponent(file.name)}`;

const CHECK_STYLE = {
  ok: { icon: CheckIcon, cls: "text-emerald-300" },
  info: { icon: InfoIcon, cls: "text-sky-300" },
  warn: { icon: AlertIcon, cls: "text-amber-200" },
  error: { icon: AlertIcon, cls: "text-red-400" },
};

// ---------- small building blocks ----------

function Card({ step, title, done, children }) {
  return (
    <section className="anim-rise rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2.5 text-[15px] font-semibold text-zinc-100">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors duration-300 ${
            done ? "bg-emerald-500/15 text-emerald-300" : "bg-white/[0.07] text-zinc-300"
          }`}
        >
          {done ? <CheckIcon size={13} strokeWidth={2.6} /> : step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="grid gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-2 py-2 transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
            value === o.value ? "bg-white/[0.09] text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-200"
          }`}
        >
          <span className="block text-center text-sm font-medium">{o.label}</span>
          {o.hint && <span className="mt-0.5 block text-center text-[11px] text-zinc-500">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 py-3 text-left">
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-zinc-200">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-violet-500" : "bg-white/[0.12]"}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-[#fff] shadow transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-1"}`} />
      </span>
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-zinc-500">{label}</p>
      {children}
    </div>
  );
}

// ---------- page ----------

export default function InstagramStudio() {
  const { loggedOut } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("new");
  const [exports, setExports] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [playing, setPlaying] = useState(null);
  useBackClose(Boolean(playing), () => setPlaying(null));

  const loadExports = useCallback(async () => {
    const res = await fetch("/api/instagram?exports=1", { cache: "no-store" });
    if (res.status === 401) return loggedOut();
    if (res.ok) setExports((await res.json()).exports);
  }, [loggedOut]);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/instagram", { cache: "no-store" });
    if (res.ok) return (await res.json()).jobs;
    return null;
  }, []);

  useEffect(() => {
    const first = setTimeout(() => {
      loadExports().catch(() => {});
      loadJobs()
        .then((j) => j && setJobs(j))
        .catch(() => {});
    }, 0);
    return () => clearTimeout(first);
  }, [loadExports, loadJobs]);

  // Poll every second while something is exporting; announce each finished export once.
  const busy = jobs.some((j) => j.status === "running" || j.status === "queued");
  const announced = useRef(new Set());
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(async () => {
      const next = await loadJobs().catch(() => null);
      if (!next) return;
      setJobs(next);
      for (const j of next) {
        if (j.status === "done" && !announced.current.has(j.id)) {
          announced.current.add(j.id);
          loadExports().catch(() => {});
          toast(j.outputs.length > 1 ? `${j.outputs.length} Story parts ready` : "Export ready", {
            action: { label: "View", onClick: () => setTab("mine") },
          });
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [busy, loadJobs, loadExports, toast]);

  async function dismiss(id) {
    await fetch(`/api/instagram?id=${id}`, { method: "DELETE" });
    const next = await loadJobs();
    if (next) setJobs(next);
  }

  const activeJobs = jobs.filter((j) => j.status !== "done");

  return (
    <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-32 pt-4 sm:px-6 lg:pb-12 lg:pt-8">
      <header className="mb-5 flex items-center gap-3.5 max-lg:hidden">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-pink-500 to-violet-600 text-[#fff] shadow-lg shadow-pink-500/20">
          <InstagramIcon size={22} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">Instagram Export</h1>
          <p className="text-sm text-zinc-500">Prepare videos so Instagram&apos;s compression keeps the most quality.</p>
        </div>
      </header>

      <div role="tablist" className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1 sm:inline-grid sm:w-80">
        {[
          ["new", "New export"],
          ["mine", `My exports${exports?.length ? ` · ${exports.length}` : ""}`],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-lg py-2 text-sm font-medium transition-colors duration-150 ${tab === id ? "bg-white/[0.09] text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-200"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeJobs.length > 0 && (
        <ul className="mb-5 space-y-2.5">
          {activeJobs.map((job) => (
            <JobRow key={job.id} job={job} onDismiss={() => dismiss(job.id)} />
          ))}
        </ul>
      )}

      <div key={tab} className="anim-fade">
        {tab === "new" ? (
          <NewExport
            onStarted={(job) => {
              setJobs((list) => [job, ...list.filter((j) => j.id !== job.id)]);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ) : (
          <MyExports exports={exports} onPlay={setPlaying} onNew={() => setTab("new")} />
        )}
      </div>

      {playing && <Player file={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}

// ---------- New export flow ----------

function NewExport({ onStarted }) {
  const toast = useToast();
  const [picked, setPicked] = useState(null); // { file, preview }
  const [source, setSource] = useState(null); // server id once uploaded
  const [analysis, setAnalysis] = useState(null);
  const [options, setOptions] = useState(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const inputRef = useRef(null);
  const set = (key) => (value) => setOptions((o) => ({ ...o, [key]: value }));

  const uploader = useUploader({
    urlFor: sourceUrl,
    onUploaded: (body) => setSource(body.id),
  });
  const upload = uploader.items.at(-1);

  useEffect(() => () => picked && URL.revokeObjectURL(picked.preview), [picked]);

  useEffect(() => {
    if (!source) return;
    let live = true;
    fetch(`/api/instagram?analyze=${encodeURIComponent(source)}`)
      .then(async (res) => {
        const data = await res.json();
        if (live) setAnalysis(res.ok ? data : { error: data.error });
      })
      .catch(() => live && setAnalysis({ error: "Couldn't read this video" }));
    return () => {
      live = false;
    };
  }, [source]);

  function choose(file) {
    if (!file) return;
    if (source) fetch(`/api/instagram/source?id=${encodeURIComponent(source)}`, { method: "DELETE" });
    if (upload?.status === "uploading") uploader.cancel(upload.id);
    setPicked({ file, preview: URL.createObjectURL(file) });
    setSource(null);
    setAnalysis(null);
    setOptions(DEFAULTS);
    uploader.enqueue([file]);
  }

  async function startExport() {
    setSubmitting(true);
    const res = await fetch("/api/instagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, options }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) return toast(data.error || "Couldn't start the export");
    onStarted(data.job);
    toast("Export started. You can leave this page, it keeps running.");
  }

  const info = analysis?.info;
  const v = info?.video;
  const vertical = v && Math.abs(v.width / v.height - 9 / 16) < 0.01;
  const ready = Boolean(source && v);
  const pct = upload && upload.file.size ? Math.round((upload.loaded / upload.file.size) * 100) : 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card step="1" title="Upload a video" done={Boolean(source)}>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {!picked ? (
            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                choose(e.dataTransfer.files?.[0]);
              }}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/12 px-6 py-12 text-center transition-[border-color,background-color,transform] duration-200 hover:border-violet-400/50 hover:bg-violet-500/[0.03] active:scale-[0.99]"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 text-pink-300">
                <UploadIcon size={24} />
              </span>
              <span className="text-[15px] font-medium text-zinc-100">Choose a video from your device</span>
              <span className="max-w-xs text-sm text-zinc-500">Your original isn&apos;t added to Media. Only the finished export is saved there.</span>
            </button>
          ) : (
            <div className="flex items-center gap-4">
              <video src={picked.preview} muted playsInline preload="metadata" className="h-28 w-[63px] shrink-0 rounded-lg bg-black object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">{picked.file.name}</p>
                <p className="text-xs tabular-nums text-zinc-500">{formatSize(picked.file.size)}</p>
                {source ? (
                  <p className="anim-fade mt-2 flex items-center gap-1.5 text-sm text-emerald-300">
                    <CheckIcon size={15} strokeWidth={2.4} /> Uploaded to the studio PC
                  </p>
                ) : upload?.status === "error" ? (
                  <p className="mt-2 text-sm text-red-400">{upload.error}. Try again.</p>
                ) : (
                  <div className="mt-2.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-pink-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs tabular-nums text-zinc-500">
                      Uploading {pct}%
                      {uploader.speed > 0 && upload ? ` · ${formatSize(uploader.speed)}/s · ${formatEta((upload.file.size - upload.loaded) / uploader.speed)}` : ""}
                    </p>
                  </div>
                )}
              </div>
              <button
                onClick={() => inputRef.current?.click()}
                className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-white/5 active:scale-95"
              >
                Change
              </button>
            </div>
          )}
        </Card>

        {source && (
          <Card step="2" title="Check" done={Boolean(v)}>
            {!analysis ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="skeleton h-14 rounded-xl" />
                ))}
              </div>
            ) : analysis.error ? (
              <p className="text-sm text-red-400">{analysis.error}</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["Resolution", `${v.width}×${v.height}`],
                    ["Frame rate", `${Math.round(v.fps * 100) / 100} fps`],
                    ["Length", formatDuration(info.duration)],
                    ["Size", formatSize(info.size)],
                    ["Codec", `${v.codec?.toUpperCase()}${v.tenBit ? " 10-bit" : ""}`],
                    ["Bitrate", info.bitrate ? `${(info.bitrate / 1e6).toFixed(1)} Mbps` : "—"],
                    ["Colour", v.hdr ? (v.hdr === "pq" ? "HDR10" : "HLG HDR") : "SDR"],
                    ["Audio", info.audio ? `${info.audio.codec?.toUpperCase()} ${Math.round(info.audio.sampleRate / 1000)} kHz` : "None"],
                  ].map(([k, val]) => (
                    <div key={k} className="rounded-xl bg-white/[0.03] px-3 py-2.5">
                      <dt className="text-[11px] text-zinc-500">{k}</dt>
                      <dd className="truncate text-sm font-medium tabular-nums text-zinc-100">{val}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="mt-4 space-y-2">
                  {analysis.checks.map((c, i) => {
                    const { icon: Icon, cls } = CHECK_STYLE[c.level];
                    return (
                      <li key={i} className="flex gap-2.5 text-sm text-zinc-300">
                        <Icon size={16} className={`mt-0.5 shrink-0 ${cls}`} />
                        {c.text}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Card>
        )}

        {ready && (
          <Card step="3" title="Export settings">
            <div className="space-y-5">
              <Field label="Post as">
                <Segmented
                  value={options.format}
                  onChange={set("format")}
                  options={[
                    { value: "reel", label: "Reel", hint: "Up to 3:00" },
                    { value: "story", label: "Story", hint: "60s parts" },
                  ]}
                />
              </Field>
              {!vertical && (
                <Field label="Framing">
                  <Segmented
                    value={options.framing}
                    onChange={set("framing")}
                    options={[
                      { value: "fill", label: "Fill screen", hint: "Crops the sides" },
                      { value: "fit", label: "Show everything", hint: "Blurred background" },
                    ]}
                  />
                </Field>
              )}
              {v.fps > 30.5 && (
                <Field label="Motion">
                  <Segmented
                    value={options.fps}
                    onChange={set("fps")}
                    options={[
                      { value: "auto", label: "Detail", hint: `${Math.round(v.fps / 2)} fps · recommended` },
                      { value: "smooth", label: "Smooth", hint: `${Math.round(Math.min(v.fps, 60))} fps · fast action` },
                    ]}
                  />
                </Field>
              )}
              {v.hdr && (
                <Field label="Colour">
                  <Segmented
                    value={options.color}
                    onChange={set("color")}
                    options={[
                      { value: "sdr", label: "SDR", hint: "Looks right everywhere" },
                      { value: "hdr", label: "Keep HDR", hint: "Brighter on HDR phones" },
                    ]}
                  />
                </Field>
              )}
              <div className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
                <Toggle checked={options.loudness} onChange={set("loudness")} label="Balance loudness" hint="Gently evens out volume (−14 LUFS, peaks under −1 dB)" />
                <Toggle checked={options.denoise} onChange={set("denoise")} label="Reduce noise" hint="For grainy or low-light clips. Grain wastes bitrate and turns blocky." />
                {options.format === "reel" && info.duration > 180 && (
                  <Toggle checked={options.trim} onChange={set("trim")} label="Trim to 3:00" hint="Off keeps up to 15:00" />
                )}
              </div>
              <ExportButton className="hidden lg:flex" onClick={startExport} busy={submitting} format={options.format} />
              <p className="text-center text-xs leading-relaxed text-zinc-500">
                1080×1920 · {options.color === "hdr" ? "HEVC 10-bit HDR" : "H.264 8-bit SDR"} · closed GOP · AAC 48 kHz · under{" "}
                {options.format === "story" ? "100" : "300"} MB · saved to Media with a <DiamondIcon size={10} className="inline text-pink-400" />
              </p>
            </div>
          </Card>
        )}
      </div>

      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <section className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.04] p-4 text-sm">
          <div className="flex gap-3">
            <InfoIcon size={18} className="mt-0.5 shrink-0 text-sky-300" />
            <div className="min-w-0 text-zinc-300">
              <p>
                <span className="font-medium text-zinc-100">Instagram re-compresses every upload</span> and plays Reels at up to 1080p, so no file can force
                4K playback there. This gives it the cleanest file it accepts, so less quality is lost.
              </p>
              <button onClick={() => setShowWhy((s) => !s)} className="-my-1.5 mt-0.5 inline-flex min-h-9 items-center gap-1 text-sky-300">
                What this does
                <ChevronDownIcon size={15} className={`transition-transform duration-200 ${showWhy ? "rotate-180" : ""}`} />
              </button>
              {showWhy && (
                <ul className="anim-fade mt-3 list-disc space-y-1.5 pl-5 text-zinc-400">
                  <li>Downscales to exactly 1080×1920 with a sharp filter, the largest size Meta&apos;s spec allows.</li>
                  <li>Converts HDR to SDR with the same curve Meta uses, or keeps HDR if you choose.</li>
                  <li>Steady frame rate, closed GOP, no edit lists, under 25 Mbps: everything Meta&apos;s spec asks for.</li>
                  <li>Keeps Stories under 100 MB and Reels under 300 MB without wasting quality.</li>
                  <li>Instagram gives extra-efficient encodes to videos that get lots of watch time. That part is up to your content.</li>
                </ul>
              )}
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-100">Before you post</h3>
          <ol className="space-y-2.5 text-sm text-zinc-400">
            {[
              "Download the export to your phone from My exports.",
              "In Instagram, turn on Settings → Media quality → Upload at highest quality.",
              "Upload on strong Wi-Fi.",
              "Post the file directly. Don't send it through WhatsApp first, which compresses it again.",
            ].map((tip, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] tabular-nums text-zinc-400">{i + 1}</span>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
        </section>
      </aside>

      {/* Phone: the main action stays in reach above the tab bar. */}
      {ready && (
        <div className="anim-sheet fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] short:bottom-[calc(2.75rem+env(safe-area-inset-bottom))] z-30 border-t border-white/[0.06] bg-zinc-950/90 px-4 py-3 backdrop-blur-xl lg:hidden">
          <ExportButton onClick={startExport} busy={submitting} format={options.format} />
        </div>
      )}
    </div>
  );
}

function ExportButton({ onClick, busy, format, className = "flex" }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`${className} w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600 py-3.5 text-sm font-semibold text-[#fff] shadow-lg shadow-fuchsia-600/20 transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-60`}
    >
      <SparkIcon size={17} />
      {busy ? "Starting…" : `Export ${format === "reel" ? "Reel" : "Story"}`}
    </button>
  );
}

function JobRow({ job, onDismiss }) {
  const pct = Math.round((job.progress ?? 0) * 100);
  const live = job.status === "running" || job.status === "queued";
  return (
    <li className="anim-rise rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 text-pink-300">
          {job.status === "error" ? <AlertIcon size={18} className="text-red-400" /> : <SparkIcon size={18} className={live ? "animate-pulse" : ""} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{job.name}</p>
          <p className="text-xs text-zinc-500">
            {job.options.format === "reel" ? "Reel" : "Story"} · {job.status === "error" ? "Failed" : job.status === "cancelled" ? "Cancelled" : job.stage}
            {job.status === "running" && job.speed ? ` · ${formatEta(job.eta)}` : ""}
          </p>
        </div>
        <button onClick={onDismiss} aria-label={live ? "Cancel export" : "Dismiss"} className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200">
          <CloseIcon size={16} />
        </button>
      </div>
      {live && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-pink-500 transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-9 text-right text-xs tabular-nums text-zinc-400">{pct}%</span>
        </div>
      )}
      {job.status === "error" && <p className="mt-2 break-words text-xs text-red-400">{job.error}</p>}
    </li>
  );
}

// ---------- My exports ----------

function MyExports({ exports, onPlay, onNew }) {
  if (exports === null) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton aspect-[9/16] rounded-2xl" />
        ))}
      </div>
    );
  }
  if (exports.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 text-pink-300">
          <DiamondIcon size={22} />
        </span>
        <p className="text-lg font-medium text-zinc-100">No exports yet</p>
        <p className="mt-1.5 max-w-sm text-sm text-zinc-500">Everything you export appears here, and in Media marked with a pink diamond.</p>
        <button onClick={onNew} className="mt-6 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-transform active:scale-[0.97]">
          Start an export
        </button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {exports.map((f) => (
        <button
          key={f.key}
          onClick={() => onPlay(f)}
          className="group relative aspect-[9/16] overflow-hidden rounded-2xl bg-zinc-900 text-left transition-transform duration-150 active:scale-[0.97]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbUrl(f)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-pink-400 backdrop-blur-sm">
            <DiamondIcon size={12} />
          </span>
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pb-2.5 pt-10">
            <span className="block truncate text-xs font-medium text-[#fff]">{f.name.replace(/ - IG (Reel|Story).*$/, "")}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#fff]/70">
              <span className="rounded bg-[#fff]/15 px-1.5 py-px text-[10px] font-medium text-[#fff]">
                {f.export.format === "story" ? `Story${f.export.part ? ` ${f.export.part}/${f.export.parts}` : ""}` : "Reel"}
              </span>
              {f.export.color === "hdr" && <span className="rounded bg-[#fff]/15 px-1.5 py-px text-[10px] font-medium text-[#fff]">HDR</span>}
              <span className="tabular-nums">{formatDuration(f.duration)}</span>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Player({ file, onClose }) {
  return (
    <div data-theme="dark" className="anim-fade fixed inset-0 z-50 flex flex-col bg-black text-zinc-100">
      <header className="flex items-center gap-2 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10">
          <ArrowLeftIcon size={20} />
        </button>
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
          <DiamondIcon size={12} className="shrink-0 text-pink-400" />
          <span className="truncate">{file.name}</span>
        </p>
        <a
          href={downloadUrl(file)}
          download={file.name}
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-950 transition-transform active:scale-95"
        >
          <DownloadIcon size={16} />
          Save
        </a>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <video src={fileUrl(file)} poster={thumbUrl(file)} controls autoPlay playsInline className="anim-pop max-h-full max-w-full rounded-xl bg-black" />
      </div>
      <p className="flex items-center justify-center gap-1.5 pb-[max(1rem,env(safe-area-inset-bottom))] text-xs tabular-nums text-zinc-500">
        <PlayIcon size={9} /> {formatSize(file.size)} · {file.width}×{file.height} · {formatDuration(file.duration)}
      </p>
    </div>
  );
}
