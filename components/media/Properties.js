"use client";

import { useEffect, useState } from "react";
import { CloseIcon, StarFilledIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { formatDateTime, formatDuration, formatSize } from "@/lib/format";

const mbps = (bps) => (bps ? `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} Mbps` : null);
const kbps = (bps) => (bps ? `${Math.round(bps / 1000)} kbps` : null);
const fps = (n) => (n ? `${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : n.toFixed(2)} fps` : null);
const CODECS = { hevc: "HEVC (H.265)", h264: "H.264 (AVC)", av1: "AV1", vp9: "VP9", aac: "AAC", opus: "Opus", mp3: "MP3", pcm_s16le: "PCM", prores: "ProRes" };

function quality(w, h) {
  const short = Math.min(w, h);
  if (!short) return null;
  if (short >= 2160) return "4K";
  if (short >= 1440) return "2K";
  if (short >= 1080) return "Full HD";
  if (short >= 720) return "HD";
  return "SD";
}

function when(value, utcOffset) {
  if (!value) return null;
  const t = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(t)) return String(value);
  return formatDateTime(t) + (utcOffset ? ` (UTC${utcOffset.slice(0, 3)}:${utcOffset.slice(3)})` : "");
}

function Section({ title, rows }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!shown.length) return null;
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{title}</h3>
      <dl className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03]">
        {shown.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] px-4 py-2.5 text-sm last:border-0">
            <dt className="shrink-0 text-zinc-500">{label}</dt>
            <dd className="min-w-0 break-words text-right tabular-nums text-zinc-100">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Everything known about one file, as a sheet over the viewer. */
export default function Properties({ file, onClose }) {
  useBackClose(true, onClose);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/properties?name=${encodeURIComponent(file.path ?? file.name)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => live && setData(d))
      .catch(() => live && setError("Couldn't read this file's details."));
    return () => {
      live = false;
    };
  }, [file]);

  const m = data?.media;
  const v = m?.video;
  const a = m?.audio;
  const img = data?.image;
  const location = m?.location || img?.location;

  return (
    <div className="fixed inset-0 z-[58] flex items-end justify-center sm:items-center" onClick={(e) => e.stopPropagation()}>
      <div className="anim-fade absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-label="Properties" className="anim-sheet relative flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl sm:m-3 sm:rounded-3xl">
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" />
        <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-zinc-100">Properties</h2>
            <p className="mt-0.5 flex items-center gap-1.5 break-all text-xs text-zinc-500">
              {file.favorite && <StarFilledIcon size={11} className="shrink-0 text-amber-300" />}
              
              {file.name}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error ? (
            <p className="px-1 py-6 text-sm text-red-400">{error}</p>
          ) : !data ? (
            <div className="space-y-2 pb-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton h-10 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              {v && (
                <div className="mb-4 flex flex-wrap gap-1.5 px-1">
                  {[quality(v.width, v.height), fps(v.fps), CODECS[v.codec] ?? v.codec?.toUpperCase(), v.hdr ?? "SDR", `${v.bitDepth}-bit`].filter(Boolean).map((chip) => (
                    <span key={chip} className="rounded-full border border-violet-400/25 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-200">
                      {chip}
                    </span>
                  ))}
                </div>
              )}

              {v && (
                <Section
                  title="Video"
                  rows={[
                    ["Resolution", `${v.width} × ${v.height}${v.width < v.height ? " (vertical)" : ""}`],
                    ["Frame rate", [fps(v.fps), v.variableFps ? "variable" : null].filter(Boolean).join(" · ")],
                    ["Recorded at", v.captureFps && Math.round(v.captureFps) !== Math.round(v.fps) ? fps(v.captureFps) : null],
                    ["Codec", [CODECS[v.codec] ?? v.codec, v.profile].filter(Boolean).join(" · ")],
                    ["Bitrate", mbps(v.bitrate || m.bitrate)],
                    ["Colour", [v.hdr ?? "SDR", `${v.bitDepth}-bit`, v.pixFmt].filter(Boolean).join(" · ")],
                    ["Colour space", v.colorSpace],
                    ["Rotation", v.rotation ? `${Math.abs(v.rotation)}° ${v.rotation < 0 ? "clockwise" : "anticlockwise"}` : null],
                    ["Frames", v.frames ? v.frames.toLocaleString() : null],
                  ]}
                />
              )}
              {a && (
                <Section
                  title="Audio"
                  rows={[
                    ["Codec", CODECS[a.codec] ?? a.codec],
                    ["Sample rate", a.sampleRate ? `${(a.sampleRate / 1000).toFixed(1)} kHz` : null],
                    ["Channels", a.layout ? `${a.channels} (${a.layout})` : a.channels],
                    ["Bitrate", kbps(a.bitrate)],
                  ]}
                />
              )}
              {img && (
                <Section
                  title="Photo"
                  rows={[
                    ["Resolution", img.width && `${img.width} × ${img.height} (${((img.width * img.height) / 1e6).toFixed(1)} MP)`],
                    ["Camera", img.camera],
                    ["Lens", img.lens],
                    ["Aperture", img.aperture],
                    ["Shutter", img.shutter],
                    ["ISO", img.iso],
                    ["Focal length", [img.focalLength, img.focal35 ? `${img.focal35} equiv.` : null].filter(Boolean).join(" · ")],
                    ["Flash", img.flash],
                    ["Format", [img.format?.toUpperCase(), img.space?.toUpperCase(), img.bitDepth ? `${img.bitDepth}-bit` : null].filter(Boolean).join(" · ")],
                    ["Edited with", img.software],
                  ]}
                />
              )}
              {(m || img) && (
                <Section
                  title={m ? "Recording" : "Taken"}
                  rows={[
                    [m ? "Recorded" : "Taken", m ? when(m.recorded, m.utcOffset) : img.taken ? when(img.taken) : null],
                    ["Length", m?.duration ? formatDuration(m.duration) : null],
                    ["Device", m?.device],
                    ["Android", m?.androidVersion],
                    [
                      "Location",
                      location ? (
                        <a
                          href={`https://www.google.com/maps?q=${location.lat},${location.lon}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-violet-300 underline-offset-2 hover:underline"
                        >
                          {location.lat.toFixed(5)}, {location.lon.toFixed(5)} · Open in Maps
                        </a>
                      ) : null,
                    ],
                  ]}
                />
              )}
              <Section
                title="File"
                rows={[
                  ["Size", `${formatSize(data.size)} (${data.size.toLocaleString()} bytes)`],
                  ["Type", data.extension],
                  ["Folder", data.folder],
                  ["Added to library", when(data.modified)],
                  ["Overall bitrate", m ? mbps(m.bitrate) : null],
                ]}
              />
              {data.unreadable && <p className="px-1 pb-3 text-xs text-amber-200">Some details couldn&apos;t be read from this file.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
