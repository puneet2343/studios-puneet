"use client";

import { useEffect, useState } from "react";
import Dialog, { Button } from "@/components/Dialog";
import { FolderIcon, MusicIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { MoveDialog, parentOf } from "@/components/media/Folders";

const CODECS = { aac: "AAC", alac: "Apple Lossless", mp3: "MP3", flac: "FLAC", opus: "Opus", vorbis: "Vorbis", ac3: "Dolby Digital", eac3: "Dolby Digital Plus" };

/**
 * "Extract audio": choose the file name and the folder, then the sound is copied out
 * of the video exactly as it is (no re-encoding).
 */
export default function ExtractAudioDialog({ file, onClose, onSaved }) {
  useBackClose(true, onClose);
  const videoBase = file.name.replace(/\.[^.]+$/, "");
  const [name, setName] = useState(`${videoBase} (audio)`);
  const [dir, setDir] = useState(file.path.includes("/") ? parentOf(file.path) : "");
  const [picking, setPicking] = useState(false);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/audio?name=${encodeURIComponent(file.path)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && (d.error ? setError(d.error) : setInfo(d)))
      .catch(() => live && setError("Can't reach the studio PC."));
    return () => {
      live = false;
    };
  }, [file.path]);

  async function save(e) {
    e?.preventDefault();
    if (!name.trim() || !info) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.path, saveAs: name.trim(), dir }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "Can't reach the studio PC." };
    setBusy(false);
    if (!res?.ok) return setError(data.error || "Couldn't extract the sound");
    onSaved(data.path);
  }

  const details = info && [CODECS[info.codec] ?? info.codec.toUpperCase(), info.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : null, info.channels === 2 ? "stereo" : info.channels === 1 ? "mono" : info.channels ? `${info.channels} channels` : null].filter(Boolean).join(" · ");

  return (
    <>
      <Dialog
        title="Extract audio"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="audio-form" disabled={busy || !info || !name.trim()}>
              {busy ? "Saving…" : "Save audio"}
            </Button>
          </>
        }
      >
        <form id="audio-form" onSubmit={save}>
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-violet-400/20 bg-violet-500/[0.07] px-3 py-2.5">
            <MusicIcon size={18} className="shrink-0 text-violet-300" />
            <p className="min-w-0 text-xs text-zinc-300">
              {info ? (
                <>
                  <span className="font-medium text-zinc-100">{details}</span>
                  <br />
                  Copied exactly as it is: original quality, nothing re-encoded.
                </>
              ) : error ? (
                <span className="text-red-400">{error}</span>
              ) : (
                "Checking the sound…"
              )}
            </p>
          </div>

          <label className="mb-1.5 block px-0.5 text-xs font-medium text-zinc-500" htmlFor="audio-name">
            Name
          </label>
          <div className="flex items-center rounded-xl border border-white/10 bg-zinc-950 focus-within:border-violet-400/60">
            <input
              id="audio-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (info) setError("");
              }}
              onFocus={(e) => e.target.select()}
              maxLength={150}
              className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm text-zinc-100 outline-none"
            />
            <span className="shrink-0 pr-3.5 text-sm text-zinc-500">{info?.ext ?? ""}</span>
          </div>

          <p className="mb-1.5 mt-4 px-0.5 text-xs font-medium text-zinc-500">Save in</p>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-zinc-950 py-1.5 pl-3.5 pr-1.5">
            <FolderIcon size={17} className="shrink-0 text-violet-300" />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{dir ? dir.replaceAll("/", " › ") : "Media (top level)"}</span>
            <Button type="button" variant="ghost" onClick={() => setPicking(true)} className="shrink-0">
              Change
            </Button>
          </div>
          {error && info && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </form>
      </Dialog>

      {picking && (
        <MoveDialog
          pick
          moving={[]}
          from={dir}
          title="Save audio in…"
          action="Use this folder"
          onClose={() => setPicking(false)}
          onMove={(chosen) => {
            setDir(chosen);
            setPicking(false);
          }}
        />
      )}
    </>
  );
}

