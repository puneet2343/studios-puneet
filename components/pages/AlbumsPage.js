"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Dialog, { Button } from "@/components/Dialog";
import { useToast } from "@/components/Toaster";
import { CalendarIcon, DotsIcon, UsersIcon, FolderIcon, HeartFilledIcon, PencilIcon, PlaneIcon, PlayIcon, PlusIcon, SparkIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { EmptyTripsArt } from "@/components/Illustrations";
import MediaBrowser from "@/components/library/MediaBrowser";
import { Face, MergeDialog, NamePersonDialog, usePeople, updatePerson } from "@/components/library/people";
import { albumsFrom, createAlbum, deleteAlbum, folderOf, refreshLibrary, renamePath, restoreFiles, useLibrary } from "@/components/library/store";
import { ConfirmDialog, NameDialog } from "@/components/media/Folders";
import { thumbUrl } from "@/components/media/urls";
import PageHeader, { HeaderButton } from "@/components/shell/PageHeader";
import useBackClose from "@/components/useBackClose";

// ----- Trips -----
function useTrips() {
  const [data, setData] = useState({ trips: null, suggestions: [] });
  const load = useCallback(async () => {
    const d = await fetch("/api/trips", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (d) setData(d);
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  return { ...data, reload: load };
}

const fmtDay = (day, withYear = true) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
export function tripDates(t) {
  if (t.start === t.end) return fmtDay(t.start);
  const sameYear = t.start.slice(0, 4) === t.end.slice(0, 4);
  return `${fmtDay(t.start, !sameYear)} – ${fmtDay(t.end)}`;
}
const toDay = (ms) => new Date(ms).toLocaleDateString("en-CA");

export function TripDialog({ trip, initial, onClose, onSaved }) {
  useBackClose(true, onClose);
  const [name, setName] = useState(trip?.name ?? initial?.name ?? "");
  const [start, setStart] = useState(() => trip?.start ?? initial?.start ?? toDay(Date.now()));
  const [end, setEnd] = useState(() => trip?.end ?? initial?.end ?? toDay(Date.now()));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/trips", {
      method: trip ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: trip?.id, name: name.trim(), start, end }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "Can't reach the studio PC." };
    setBusy(false);
    if (!res?.ok) return setError(data.error || "Couldn't save the trip");
    onSaved(data);
  }

  const input = "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] text-zinc-100 outline-none focus:border-accent";
  return (
    <Dialog
      title={trip ? "Edit trip" : "New trip"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="trip-form" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : trip ? "Save" : "Create trip"}
          </Button>
        </>
      }
    >
      <form id="trip-form" onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-sm text-zinc-400">Trip name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Goa Dec 2026" maxLength={100} className={input} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm text-zinc-400">From</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-zinc-400">To</span>
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={input} />
          </label>
        </div>
        <p className="rounded-xl bg-accent-soft px-3.5 py-3 text-[13px] leading-relaxed text-zinc-300">
          Photos taken on these dates are gathered into this trip, and new ones from your phone go straight in while you travel.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Dialog>
  );
}

// ----- Cards -----
function Cover({ file, className = "" }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`overflow-hidden bg-surface-2 ${className}`}>
      {file && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl(file)} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-600">
          <FolderIcon size={30} />
        </div>
      )}
    </div>
  );
}

function AlbumCard({ title, subtitle, cover, onClick, badge }) {
  return (
    <button onClick={onClick} className="group block w-full text-left">
      <div className="relative">
        <Cover file={cover} className="aspect-square rounded-2xl" />
        {badge}
      </div>
      <p className="mt-2 truncate text-[15px] font-medium text-zinc-100">{title}</p>
      <p className="truncate text-[13px] text-zinc-500">{subtitle}</p>
    </button>
  );
}

function TripCard({ trip, cover, count, onClick }) {
  return (
    <button onClick={onClick} className="group relative block aspect-[4/5] w-44 shrink-0 overflow-hidden rounded-3xl text-left sm:w-52">
      <Cover file={cover} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-3.5 text-[#fff]">
        <p className="truncate text-base font-semibold">{trip.name}</p>
        <p className="truncate text-xs opacity-85">
          {tripDates(trip)} · {count} item{count === 1 ? "" : "s"}
        </p>
      </div>
      <span className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-[#fff] backdrop-blur-md">
        <PlaneIcon size={16} />
      </span>
    </button>
  );
}

const isMedia = (f) => f.kind === "image" || f.kind === "video";

export default function AlbumsPage() {
  const toast = useToast();
  const { files, folders } = useLibrary();
  const { trips, suggestions, reload } = useTrips();
  const { people, reload: reloadPeople } = usePeople();
  const [open, setOpen] = useState(null); // { type: "album"|"trip"|"favorites"|"videos"|"person", path?, id? }
  const [tripDialog, setTripDialog] = useState(null); // { trip } to edit, { initial } for new
  const [naming, setNaming] = useState(false);
  useBackClose(Boolean(open), () => setOpen(null));

  const albums = useMemo(() => albumsFrom(files, folders), [files, folders]);
  const tripFolders = useMemo(() => new Set((trips ?? []).map((t) => t.folder)), [trips]);
  const media = useMemo(() => (files ?? []).filter(isMedia), [files]);
  const favorites = media.filter((f) => f.favorite);
  const videos = media.filter((f) => f.kind === "video");
  const albumByPath = useMemo(() => new Map(albums.map((a) => [a.path, a])), [albums]);

  async function tripSaved({ trip, moved }, isNew) {
    setTripDialog(null);
    await Promise.all([reload(), refreshLibrary()]);
    toast(isNew ? `Trip "${trip.name}" created${moved ? ` · ${moved} photo${moved === 1 ? "" : "s"} added` : ""}` : `Saved${moved ? ` · ${moved} more photo${moved === 1 ? "" : "s"} added` : ""}`);
    if (isNew) setOpen({ type: "trip", id: trip.id });
  }

  if (open) {
    return (
      <AlbumView
        open={open}
        files={files ?? []}
        trips={trips ?? []}
        onClose={() => setOpen(null)}
        onEditTrip={(trip) => setTripDialog({ trip })}
        onChanged={reload}
        people={people ?? []}
        onPeopleChanged={reloadPeople}
        tripDialog={tripDialog && <TripDialog {...tripDialog} onClose={() => setTripDialog(null)} onSaved={(d) => tripSaved(d, !tripDialog.trip)} />}
      />
    );
  }

  const plainAlbums = albums.filter((a) => !tripFolders.has(a.path));

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 sm:px-6 lg:px-8 lg:pb-12">
      <PageHeader
        flush
        version
        title="Albums"
        actions={
          <HeaderButton label="New album" primary onClick={() => setNaming(true)}>
            <PlusIcon size={18} strokeWidth={2.2} />
          </HeaderButton>
        }
      />

      {/* People (found by the PC in your photos) */}
      {people?.length > 0 && (
        <section className="mb-8 mt-2">
          <h2 className="mb-3 text-lg font-semibold text-zinc-50">People</h2>
          <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {people.map((p) => (
              <button key={p.id} onClick={() => setOpen({ type: "person", id: p.id })} className="flex w-20 shrink-0 flex-col items-center gap-1.5">
                <Face person={p} size={76} className="ring-2 ring-transparent transition hover:ring-accent" />
                <span className={`w-full truncate text-center text-[13px] ${p.name ? "font-medium text-zinc-100" : "text-zinc-500"}`}>{p.name || "Add a name"}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Trips */}
      <section className="mb-8 mt-2">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-50">Trips</h2>
          <button onClick={() => setTripDialog({})} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft">
            <PlusIcon size={16} strokeWidth={2.2} /> New trip
          </button>
        </div>
        {trips && trips.length === 0 && suggestions.length === 0 ? (
          <div className="flex items-center gap-4 rounded-3xl bg-surface p-4">
            <EmptyTripsArt className="w-28 shrink-0" />
            <div>
              <p className="font-medium text-zinc-100">Going somewhere?</p>
              <p className="mt-0.5 text-[13px] text-zinc-500">Add a trip with its dates. Its photos gather in one place, even the ones your phone backs up on the way.</p>
              <button onClick={() => setTripDialog({})} className="mt-2.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#fff]">
                Add a trip
              </button>
            </div>
          </div>
        ) : (
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {[...(trips ?? [])]
              .sort((a, b) => b.start.localeCompare(a.start))
              .map((t) => {
                const a = albumByPath.get(t.folder);
                return <TripCard key={t.id} trip={t} cover={a?.cover} count={a?.count ?? 0} onClick={() => setOpen({ type: "trip", id: t.id })} />;
              })}
            {suggestions.slice(0, 3).map((s) => (
              <button
                key={s.id}
                onClick={() => setTripDialog({ initial: { name: s.name.replace(/^(Trip|Day out) · /, ""), start: toDay(s.from), end: toDay(s.to) } })}
                className="relative flex aspect-[4/5] w-44 shrink-0 flex-col overflow-hidden rounded-3xl border-2 border-dashed border-accent/40 bg-accent-soft p-3.5 text-left sm:w-52"
              >
                <div className="grid flex-1 grid-cols-2 gap-1 overflow-hidden rounded-2xl">
                  {s.covers.slice(0, 4).map((c) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={c.path} src={thumbUrl(c)} alt="" className="h-full w-full object-cover" />
                  ))}
                </div>
                <p className="mt-2.5 flex items-center gap-1 text-xs font-semibold text-accent">
                  <SparkIcon size={13} /> Looks like a trip
                </p>
                <p className="truncate text-sm font-medium text-zinc-100">
                  {s.name} · {s.count}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Collections */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-zinc-50">Collections</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <AlbumCard
            title="Favourites"
            subtitle={`${favorites.length} item${favorites.length === 1 ? "" : "s"}`}
            cover={favorites[0]}
            onClick={() => setOpen({ type: "favorites" })}
            badge={
              <span className="absolute bottom-2 left-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-pink-300 backdrop-blur-md">
                <HeartFilledIcon size={16} />
              </span>
            }
          />
          <AlbumCard
            title="Videos"
            subtitle={`${videos.length} video${videos.length === 1 ? "" : "s"}`}
            cover={videos[0]}
            onClick={() => setOpen({ type: "videos" })}
            badge={
              <span className="absolute bottom-2 left-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-[#fff] backdrop-blur-md">
                <PlayIcon size={11} />
              </span>
            }
          />
        </div>
      </section>

      {/* Albums */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-50">Your albums</h2>
        {files === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton aspect-square rounded-2xl" />
            ))}
          </div>
        ) : plainAlbums.length === 0 ? (
          <p className="rounded-2xl bg-surface p-5 text-sm text-zinc-500">No albums yet. Tap &quot;New album&quot;, or select photos and choose &quot;Add to album&quot;.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
            {plainAlbums.map((a) => (
              <AlbumCard
                key={a.path}
                title={a.name}
                subtitle={`${a.count} item${a.count === 1 ? "" : "s"}${a.parent ? ` · ${a.parent.split("/").at(-1)}` : ""}`}
                cover={a.cover}
                onClick={() => setOpen({ type: "album", path: a.path })}
              />
            ))}
          </div>
        )}
      </section>

      {naming && (
        <NameDialog
          title="New album"
          action="Create"
          onClose={() => setNaming(false)}
          submit={async (name) => {
            const made = await createAlbum(name);
            if (made.error) return made.error;
            setNaming(false);
            setOpen({ type: "album", path: made.path });
          }}
        />
      )}
      {tripDialog && <TripDialog {...tripDialog} onClose={() => setTripDialog(null)} onSaved={(d) => tripSaved(d, !tripDialog.trip)} />}
    </div>
  );
}

// ----- One album / trip / collection -----
function AlbumView({ open, files, trips, onClose, onEditTrip, onChanged, tripDialog, people, onPeopleChanged }) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(null); // "delete-album" | "remove-trip" | "hide-person"
  const [naming, setNaming] = useState(false);
  const [merging, setMerging] = useState(false);
  const person = open.type === "person" ? people.find((p) => p.id === open.id) : null;
  useBackClose(menu, () => setMenu(false));

  const trip = open.type === "trip" ? trips.find((t) => t.id === open.id) : null;
  const path = open.type === "album" ? open.path : trip?.folder;
  const media = files.filter(isMedia);
  const shown =
    open.type === "favorites"
      ? media.filter((f) => f.favorite)
      : open.type === "videos"
        ? media.filter((f) => f.kind === "video")
        : open.type === "person"
          ? media.filter((f) => person?.paths.includes(f.path))
          : files.filter((f) => folderOf(f.path) === path);
  const title =
    open.type === "favorites" ? "Favourites" : open.type === "videos" ? "Videos" : open.type === "person" ? person?.name || "Add a name" : trip ? trip.name : path?.split("/").at(-1);
  const subtitle = trip ? `${tripDates(trip)} · ${shown.length} items` : `${shown.length} item${shown.length === 1 ? "" : "s"}`;

  async function removeAlbum() {
    setConfirm(null);
    const r = await deleteAlbum(path);
    if (r.error) return toast(r.error, { duration: 8000 });
    onChanged();
    onClose();
    toast(`Album moved to Recycle Bin`, { action: { label: "Undo", onClick: () => restoreFiles([r.trashId]).then(onChanged) } });
  }

  async function removeTrip() {
    setConfirm(null);
    await fetch(`/api/trips?id=${trip.id}`, { method: "DELETE" }).catch(() => null);
    onChanged();
    onClose();
    toast(`"${trip.name}" is now a normal album. No photos were deleted.`);
  }

  const items = [
    ...(person ? [{ label: person.name ? "Rename" : "Add a name", icon: PencilIcon, run: () => setNaming(true) }] : []),
    ...(person ? [{ label: "Same person as…", icon: UsersIcon, run: () => setMerging(true) }] : []),
    ...(person ? [{ label: "Hide this person", icon: TrashIcon, danger: true, run: () => setConfirm("hide-person") }] : []),
    ...(trip ? [{ label: "Edit trip", icon: CalendarIcon, run: () => onEditTrip(trip) }] : []),
    ...(open.type === "album" ? [{ label: "Rename album", icon: PencilIcon, run: () => setRenaming(true) }] : []),
    ...(trip ? [{ label: "Stop being a trip", icon: PlaneIcon, run: () => setConfirm("remove-trip") }] : []),
    ...(path ? [{ label: "Delete album", icon: TrashIcon, danger: true, run: () => setConfirm("delete-album") }] : []),
  ];

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 pb-28 sm:px-6 lg:px-8 lg:pb-12">
      <MediaBrowser
        files={shown}
        grouped={open.type !== "album" || shown.length > 30}
        uploadTo={path ?? null}
        empty={
          <div className="flex flex-col items-center px-8 py-16 text-center">
            <p className="text-lg font-medium text-zinc-100">Nothing here yet</p>
            <p className="mt-1 max-w-xs text-sm text-zinc-500">
              {trip ? "Photos taken during the trip will gather here, including ones your phone backs up." : path ? "Upload photos here, or add them from Photos." : ""}
            </p>
          </div>
        }
      >
        {({ upload }) => (
          <PageHeader
            title={title}
            subtitle={subtitle}
            onBack={onClose}
            actions={
              <>
                {path && (
                  <HeaderButton label="Upload here" onClick={upload}>
                    <UploadIcon size={20} />
                  </HeaderButton>
                )}
                {items.length > 0 && (
                  <span className="relative">
                    <HeaderButton label="More" onClick={() => setMenu((m) => !m)}>
                      <DotsIcon size={20} className="rotate-90" />
                    </HeaderButton>
                    {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />}
                    {menu && (
                      <div className="anim-pop absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-2xl border border-line bg-zinc-900 py-1.5 shadow-2xl">
                        {items.map(({ label, icon: Icon, run, danger }) => (
                          <button
                            key={label}
                            onClick={() => {
                              setMenu(false);
                              run();
                            }}
                            className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-white/5 ${danger ? "text-red-300" : "text-zinc-100"}`}
                          >
                            <Icon size={18} className={danger ? "" : "text-zinc-400"} /> {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                )}
              </>
            }
          />
        )}
      </MediaBrowser>

      {renaming && (
        <NameDialog
          title="Rename album"
          action="Save"
          initial={title}
          onClose={() => setRenaming(false)}
          submit={async (name) => {
            const r = await renamePath(path, name);
            if (r.error) return r.error;
            setRenaming(false);
            onClose();
            onChanged();
          }}
        />
      )}
      {confirm === "delete-album" && (
        <ConfirmDialog
          title="Delete this album?"
          message={`"${title}" and the ${shown.length} item${shown.length === 1 ? "" : "s"} in it go to the Recycle Bin (kept for 3 days).`}
          action="Delete album"
          onClose={() => setConfirm(null)}
          onConfirm={removeAlbum}
        />
      )}
      {confirm === "remove-trip" && (
        <ConfirmDialog
          title="Stop being a trip?"
          message={`"${title}" stays as a normal album with all its photos. New photos from these dates will no longer be added automatically.`}
          action="Make it an album"
          onClose={() => setConfirm(null)}
          onConfirm={removeTrip}
        />
      )}
      {naming && person && (
        <NamePersonDialog
          person={person}
          onClose={() => setNaming(false)}
          onDone={() => {
            setNaming(false);
            onPeopleChanged();
          }}
        />
      )}
      {merging && person && (
        <MergeDialog
          person={person}
          people={people}
          onClose={() => setMerging(false)}
          onDone={(target) => {
            setMerging(false);
            onPeopleChanged();
            onClose();
            toast(`Put together with ${target.name || "that person"}`);
          }}
        />
      )}
      {confirm === "hide-person" && person && (
        <ConfirmDialog
          title="Hide this person?"
          message="They won't show in People any more. No photos are deleted."
          action="Hide"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            await updatePerson(person.id, { hidden: true });
            onPeopleChanged();
            onClose();
          }}
        />
      )}
      {tripDialog}
    </div>
  );
}
