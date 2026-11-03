"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CloseIcon, HeartIcon, PhotosIcon, PlayIcon, SearchIcon, UploadIcon } from "@/components/icons";
import { EmptyPhotosArt } from "@/components/Illustrations";
import MediaBrowser from "@/components/library/MediaBrowser";
import { useLibrary } from "@/components/library/store";
import { usePeople } from "@/components/library/people";
import PageHeader, { Chips, HeaderButton } from "@/components/shell/PageHeader";
import useBackClose from "@/components/useBackClose";

const isMedia = (f) => f.kind === "image" || f.kind === "video";

// Search matches the album name, the file name, or the date ("oct", "2026", "17 oct").
function matches(f, q) {
  const d = new Date(f.taken);
  const text = `${f.path} ${d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} ${d.toLocaleDateString("en-IN", { month: "short" })}`.toLowerCase();
  return q.split(/\s+/).every((w) => text.includes(w));
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 sm:gap-1 md:grid-cols-5 lg:grid-cols-6">
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="skeleton aspect-square" />
      ))}
    </div>
  );
}

export default function PhotosPage() {
  const { files, error, pending } = useLibrary();
  const [filter, setFilter] = useState("all");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  useBackClose(searching, () => {
    setSearching(false);
    setQuery("");
  });
  useBackClose(filter !== "all", () => setFilter("all"));

  const media = useMemo(() => (files ?? []).filter(isMedia), [files]);
  const { people } = usePeople();

  // Search by what's in the photo ("beach", "cake"…): asked from the PC, which has looked at
  // every photo (lib/ai.js). Waits a moment after typing stops.
  const [smart, setSmart] = useState({ q: "", paths: [], loading: false });
  const [aiProgress, setAiProgress] = useState(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      setSmart((st) => ({ ...st, loading: true }));
      const d = await fetch(`/api/ai?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);
      setSmart({ q, paths: (d?.results ?? []).map((r) => r.path), loading: false });
    }, 450);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!searching) return;
    fetch("/api/ai", { cache: "no-store" })
      .then((r) => r.json())
      .then(setAiProgress)
      .catch(() => {});
  }, [searching]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kindOk = (f) => filter === "all" || (filter === "favorites" ? f.favorite : f.kind === "video");
    if (!q) return media.filter(kindOk);
    // 1. People you named, 2. album / file name / date, 3. what the photo shows (best first).
    const byPath = new Map(media.map((f) => [f.path, f]));
    const out = [];
    const seen = new Set();
    const add = (f) => f && kindOk(f) && !seen.has(f.path) && (seen.add(f.path), out.push(f));
    for (const p of people ?? []) if (p.name && p.name.toLowerCase().includes(q)) p.paths.forEach((path) => add(byPath.get(path)));
    media.filter((f) => matches(f, q)).forEach(add);
    if (smart.q.toLowerCase() === q) smart.paths.forEach((path) => add(byPath.get(path)));
    return out;
  }, [media, filter, query, people, smart]);

  const counts = useMemo(() => ({ favorites: media.filter((f) => f.favorite).length, videos: media.filter((f) => f.kind === "video").length }), [media]);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 pb-28 sm:px-6 lg:px-8 lg:pb-12">
      <MediaBrowser
        files={shown}
        grouped={!query.trim()}
        uploadTo=""
        empty={
          files === null ? (
            <GridSkeleton />
          ) : query || filter !== "all" ? (
            <p className="px-6 py-20 text-center text-sm text-zinc-500">
              {query
                ? smart.loading || smart.q.toLowerCase() !== query.trim().toLowerCase()
                  ? "Looking through your photos…"
                  : `Nothing matches "${query}"`
                : filter === "favorites"
                  ? "No favourites yet. Tap ♡ on a photo to add it."
                  : "No videos yet."}
            </p>
          ) : (
            <EmptyLibrary />
          )
        }
      >
        {({ upload }) => (
          <PageHeader
            title={searching ? "" : "Photos"}
            version={!searching}
            actions={
              searching ? null : (
                <>
                  <HeaderButton label="Search" onClick={() => setSearching(true)}>
                    <SearchIcon size={21} />
                  </HeaderButton>
                  <HeaderButton label="Upload" primary onClick={upload}>
                    <UploadIcon size={17} strokeWidth={2.2} />
                  </HeaderButton>
                </>
              )
            }
          >
            {searching && (
              <div className="absolute inset-x-0 top-[env(safe-area-inset-top)] flex h-16 items-center gap-2 px-3 sm:px-0">
                <div className="flex h-11 flex-1 items-center gap-2 rounded-full bg-surface px-4">
                  <SearchIcon size={18} className="text-zinc-500" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search: beach, cake, a person, oct 2026…"
                    className="min-w-0 flex-1 bg-transparent text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
                  />
                </div>
                <button
                  onClick={() => {
                    setSearching(false);
                    setQuery("");
                  }}
                  aria-label="Close search"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 hover:bg-white/5"
                >
                  <CloseIcon size={21} />
                </button>
              </div>
            )}
            {media.length > 0 && (
              <Chips
                value={filter}
                onChange={setFilter}
                options={[
                  { id: "all", label: "All", icon: PhotosIcon },
                  { id: "favorites", label: "Favourites", icon: HeartIcon, count: counts.favorites },
                  { id: "videos", label: "Videos", icon: PlayIcon, count: counts.videos },
                ]}
              />
            )}
            {error && <p className="mx-4 mb-3 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-300 sm:mx-0">{error}</p>}
            {pending > 0 && !error && <p className="px-4 pb-2 text-xs text-zinc-500 sm:px-0">Reading dates and places of {pending} new item{pending === 1 ? "" : "s"}…</p>}
            {searching && query.trim().length >= 2 && (
              <p className="px-4 pb-2 text-xs text-zinc-500 sm:px-0">
                {smart.loading ? "Searching what's in your photos…" : `${shown.length} result${shown.length === 1 ? "" : "s"} for "${query.trim()}"`}
                {aiProgress?.working ? ` · still learning your photos (${aiProgress.done} of ${aiProgress.total})` : ""}
              </p>
            )}
          </PageHeader>
        )}
      </MediaBrowser>
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="anim-rise flex flex-col items-center px-8 py-12 text-center">
      <EmptyPhotosArt className="w-64 max-w-full" />
      <h2 className="mt-4 text-xl font-semibold text-zinc-50">Your photos will live here</h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">Upload from this device, or install the Android app and every new photo and video copies itself to your PC, untouched.</p>
      <Link href="/settings" className="mt-5 rounded-full border border-line px-5 py-2.5 text-sm font-medium text-zinc-100 hover:bg-white/5">
        Set up phone backup
      </Link>
    </div>
  );
}
