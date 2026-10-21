"use client";

import { useState } from "react";
import Dialog, { Button } from "@/components/Dialog";
import { CloseIcon, FolderIcon, PlusIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { MoveDialog } from "@/components/media/Folders";
import { CURRENCIES, uid } from "@/components/trips/tripUtils";
import { Field, MoneyInput, TextInput, inputClass } from "@/components/trips/ui";

/** New trip / trip details. `onSave(fields)` gets the trip fields to create or update. */
export default function TripForm({ trip, onClose, onSave }) {
  useBackClose(true, onClose);
  const [f, setF] = useState(() => ({
    name: trip?.name ?? "",
    destination: trip?.destination ?? "",
    startDate: trip?.startDate ?? "",
    endDate: trip?.endDate ?? "",
    currency: trip?.currency ?? "INR",
    budget: trip?.budget ?? null,
    travellers: trip?.travellers?.length ? trip.travellers : [{ id: uid(), name: "Me" }],
    mediaFolder: trip?.mediaFolder ?? null,
    cover: trip?.cover ?? null,
  }));
  const [person, setPerson] = useState("");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  function addPerson() {
    const name = person.trim();
    if (!name) return;
    set({ travellers: [...f.travellers, { id: uid(), name }] });
    setPerson("");
  }

  async function linkFolder(dir) {
    setPicking(false);
    if (!dir) return set({ mediaFolder: null, cover: null });
    // The newest photo or video in that folder becomes the trip's cover.
    const data = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    const pic = data?.files?.find((x) => x.kind === "image" || x.kind === "video");
    set({ mediaFolder: dir, cover: pic ? { path: pic.path, key: pic.key } : null });
  }

  async function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return setError("Give the trip a name");
    if (f.startDate && f.endDate && f.endDate < f.startDate) return setError("The trip can't end before it starts");
    setBusy(true);
    const problem = await onSave({ ...f, name: f.name.trim(), destination: f.destination.trim(), startDate: f.startDate || null, endDate: f.endDate || f.startDate || null });
    setBusy(false);
    if (problem) setError(problem);
  }

  return (
    <>
      <Dialog
        title={trip ? "Trip details" : "New trip"}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="trip-form" disabled={busy}>
              {busy ? "Saving…" : trip ? "Save" : "Create trip"}
            </Button>
          </>
        }
      >
        <form id="trip-form" onSubmit={submit} className="space-y-4 pb-1">
          <Field label="Trip name">
            <TextInput value={f.name} onChange={(name) => (set({ name }), setError(""))} placeholder="e.g. Goa with friends" autoFocus={!trip} maxLength={120} />
          </Field>
          <Field label="Destination">
            <TextInput value={f.destination} onChange={(destination) => set({ destination })} placeholder="e.g. North Goa" maxLength={160} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <input type="date" value={f.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value, endDate: f.endDate && f.endDate < e.target.value ? e.target.value : f.endDate })} className={inputClass} />
            </Field>
            <Field label="Ends">
              <input type="date" value={f.endDate ?? ""} min={f.startDate || undefined} onChange={(e) => set({ endDate: e.target.value })} className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <Field label="Currency">
              <select value={f.currency} onChange={(e) => set({ currency: e.target.value })} className={inputClass}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c} className="bg-zinc-900">
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Budget (optional)">
              <MoneyInput value={f.budget} onChange={(budget) => set({ budget })} currency={f.currency} placeholder="Total for the trip" />
            </Field>
          </div>

          <Field label="Who's going" hint="Add friends to split expenses and see who owes whom.">
            <div className="flex flex-wrap gap-1.5">
              {f.travellers.map((p) => (
                <span key={p.id} className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-3 pr-1 text-sm text-zinc-100">
                  {p.name}
                  {f.travellers.length > 1 && (
                    <button type="button" onClick={() => set({ travellers: f.travellers.filter((x) => x.id !== p.id) })} aria-label={`Remove ${p.name}`} className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-white/10">
                      <CloseIcon size={13} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPerson())}
                placeholder="Friend's name"
                maxLength={60}
                className={inputClass}
              />
              <Button type="button" onClick={addPerson} className="h-[2.875rem] shrink-0" aria-label="Add person">
                <PlusIcon size={16} />
                Add
              </Button>
            </div>
          </Field>

          <Field label="Photos & videos folder (optional)" hint="Link the trip's media folder: its newest photo becomes the cover.">
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-zinc-950 py-1.5 pl-3.5 pr-1.5">
              <FolderIcon size={17} className="shrink-0 text-violet-300" />
              <span className={`min-w-0 flex-1 truncate text-sm ${f.mediaFolder ? "text-zinc-100" : "text-zinc-600"}`}>{f.mediaFolder ? f.mediaFolder.replaceAll("/", " › ") : "Not linked"}</span>
              {f.mediaFolder && (
                <Button type="button" variant="ghost" onClick={() => linkFolder(null)} className="shrink-0">
                  Unlink
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => setPicking(true)} className="shrink-0">
                {f.mediaFolder ? "Change" : "Link"}
              </Button>
            </div>
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      </Dialog>
      {picking && (
        <MoveDialog pick moving={[]} from={f.mediaFolder ?? ""} title="Link a media folder" action="Link this folder" onClose={() => setPicking(false)} onMove={linkFolder} />
      )}
    </>
  );
}
