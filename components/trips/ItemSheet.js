"use client";

import { useState } from "react";
import Dialog, { Button } from "@/components/Dialog";
import { TrashIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { ITEM_TYPES, MODES, STATUSES, fmtDay, tripDays, uid } from "@/components/trips/tripUtils";
import { Attachments, Field, MoneyInput, Segmented, TextInput, inputClass } from "@/components/trips/ui";

function DayPicker({ trip, value, onChange, allowNone = true, label = "Day", noneLabel = "Not decided (ideas)" }) {
  const days = tripDays(trip);
  if (!days.length) {
    return (
      <Field label={label}>
        <input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={inputClass} />
      </Field>
    );
  }
  const outside = value && !days.includes(value);
  return (
    <Field label={label}>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={inputClass}>
        {allowNone && (
          <option value="" className="bg-zinc-900">
            {noneLabel}
          </option>
        )}
        {outside && (
          <option value={value} className="bg-zinc-900">
            {fmtDay(value)}
          </option>
        )}
        {days.map((d, i) => (
          <option key={d} value={d} className="bg-zinc-900">
            Day {i + 1} · {fmtDay(d)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function TimeInput({ label, value, onChange }) {
  return (
    <Field label={label}>
      <input type="time" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={inputClass} />
    </Field>
  );
}

/** Add / edit one plan entry (transport, stay, place, food or note). */
export default function ItemSheet({ trip, item, onClose, onSave, onDelete, onAttach, onDetach }) {
  useBackClose(true, onClose);
  const isNew = !trip.items.some((i) => i.id === item.id);
  const [it, setIt] = useState(() => ({
    id: uid(),
    type: "activity",
    mode: "flight",
    title: "",
    day: null,
    time: null,
    endDay: null,
    endTime: null,
    from: "",
    to: "",
    location: "",
    provider: "",
    ref: "",
    seat: "",
    cost: null,
    status: "tobook",
    paid: false,
    done: false,
    link: "",
    notes: "",
    files: [],
    ...item,
  }));
  const [error, setError] = useState("");
  const set = (patch) => setIt((v) => ({ ...v, ...patch }));
  const t = it.type;
  const bookable = t === "transport" || t === "stay";

  function submit(e) {
    e.preventDefault();
    if (t === "stay" && !it.title.trim()) return setError("Add the hotel or place name");
    if (t === "transport" && !it.from.trim() && !it.to.trim() && !it.title.trim()) return setError("Add where you're going from and to");
    if ((t === "activity" || t === "food" || t === "note") && !it.title.trim()) return setError("Give it a name");
    if (t === "stay" && it.day && it.endDay && it.endDay < it.day) return setError("Check-out can't be before check-in");
    onSave({ ...it, title: it.title.trim(), status: bookable ? it.status : it.status === "cancelled" ? "cancelled" : it.status });
  }

  const typeLabel = t === "transport" ? MODES[it.mode]?.label ?? "Transport" : ITEM_TYPES[t].label;

  return (
    <Dialog
      title={isNew ? `Add ${typeLabel.toLowerCase()}` : typeLabel}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <Button type="button" variant="ghost" onClick={() => onDelete(it.id)} aria-label="Delete" className="mr-auto px-3 text-red-300 max-sm:flex-none">
              <TrashIcon size={17} />
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="item-form">
            {isNew ? "Add" : "Save"}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="space-y-4 pb-1">
        {isNew && (
          <Segmented
            value={t}
            onChange={(type) => set({ type, status: type === "transport" || type === "stay" ? "tobook" : "idea" })}
            options={Object.entries(ITEM_TYPES).map(([id, v]) => ({ id, label: v.label.split(" /")[0], icon: v.icon }))}
          />
        )}

        {t === "transport" && (
          <>
            <Segmented size="sm" value={it.mode} onChange={(mode) => set({ mode })} options={Object.entries(MODES).map(([id, v]) => ({ id, label: v.label, icon: v.icon }))} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <TextInput value={it.from} onChange={(from) => (set({ from }), setError(""))} placeholder="e.g. Delhi" maxLength={160} />
              </Field>
              <Field label="To">
                <TextInput value={it.to} onChange={(to) => (set({ to }), setError(""))} placeholder="e.g. Goa" maxLength={160} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DayPicker trip={trip} value={it.day} onChange={(day) => set({ day })} label="Departs" />
              <TimeInput label="At" value={it.time} onChange={(time) => set({ time })} />
              <DayPicker trip={trip} value={it.endDay} onChange={(endDay) => set({ endDay })} label="Arrives" noneLabel="Same day" />
              <TimeInput label="At" value={it.endTime} onChange={(endTime) => set({ endTime })} />
            </div>
            <Field label={it.mode === "flight" ? "Airline & flight no." : it.mode === "train" ? "Train name & no." : "Operator"}>
              <TextInput value={it.provider} onChange={(provider) => set({ provider })} placeholder={it.mode === "flight" ? "e.g. IndiGo 6E 2134" : it.mode === "train" ? "e.g. Rajdhani 12431" : "e.g. Zingbus / Uber"} maxLength={120} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={it.mode === "train" || it.mode === "flight" ? "PNR" : "Booking no."}>
                <TextInput value={it.ref} onChange={(ref) => set({ ref })} placeholder="e.g. 4521 8890 12" maxLength={80} />
              </Field>
              <Field label="Seat / berth">
                <TextInput value={it.seat} onChange={(seat) => set({ seat })} placeholder="e.g. 14C / B2-33" maxLength={60} />
              </Field>
            </div>
          </>
        )}

        {t === "stay" && (
          <>
            <Field label="Hotel / stay">
              <TextInput value={it.title} onChange={(title) => (set({ title }), setError(""))} placeholder="e.g. Zostel Anjuna" maxLength={200} autoFocus={isNew} />
            </Field>
            <Field label="Address">
              <TextInput value={it.location} onChange={(location) => set({ location })} placeholder="Opens in Google Maps" maxLength={300} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <DayPicker trip={trip} value={it.day} onChange={(day) => set({ day })} label="Check-in" allowNone={false} />
              <TimeInput label="From" value={it.time} onChange={(time) => set({ time })} />
              <DayPicker trip={trip} value={it.endDay} onChange={(endDay) => set({ endDay })} label="Check-out" allowNone={false} />
              <TimeInput label="By" value={it.endTime} onChange={(endTime) => set({ endTime })} />
            </div>
            <Field label="Confirmation no.">
              <TextInput value={it.ref} onChange={(ref) => set({ ref })} placeholder="e.g. BKG-209344" maxLength={80} />
            </Field>
          </>
        )}

        {(t === "activity" || t === "food" || t === "note") && (
          <>
            <Field label={t === "food" ? "Restaurant / café" : t === "note" ? "Title" : "Place or activity"}>
              <TextInput
                value={it.title}
                onChange={(title) => (set({ title }), setError(""))}
                placeholder={t === "food" ? "e.g. Thalassa" : t === "note" ? "e.g. Rent scooty near hotel" : "e.g. Chapora Fort sunset shoot"}
                maxLength={200}
                autoFocus={isNew}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <DayPicker trip={trip} value={it.day} onChange={(day) => set({ day })} />
              <TimeInput label="Time" value={it.time} onChange={(time) => set({ time })} />
            </div>
            {t !== "note" && (
              <Field label="Location">
                <TextInput value={it.location} onChange={(location) => set({ location })} placeholder="Opens in Google Maps" maxLength={300} />
              </Field>
            )}
          </>
        )}

        {t !== "note" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t === "stay" ? "Total cost" : "Cost"}>
              <MoneyInput value={it.cost} onChange={(cost) => set({ cost })} currency={trip.currency} placeholder="0" />
            </Field>
            <Field label="Status">
              <select value={it.status} onChange={(e) => set({ status: e.target.value })} className={inputClass}>
                {Object.entries(STATUSES)
                  .filter(([id]) => (bookable ? id !== "idea" : true))
                  .map(([id, s]) => (
                    <option key={id} value={id} className="bg-zinc-900">
                      {s.label}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        )}

        {t !== "note" && it.cost > 0 && it.status !== "cancelled" && (
          <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3">
            <span className="text-sm text-zinc-200">
              Paid
              <span className="block text-xs text-zinc-500">Adds it to the trip&apos;s expenses</span>
            </span>
            <input type="checkbox" checked={it.paid} onChange={(e) => set(e.target.checked && it.status === "tobook" ? { paid: true, status: "booked" } : { paid: e.target.checked })} className="h-5 w-5 accent-violet-500" />
          </label>
        )}

        {t !== "note" && (
          <Field label="Link (optional)">
            <TextInput value={it.link} onChange={(link) => set({ link })} placeholder="Booking page, menu, Instagram…" maxLength={500} inputMode="url" />
          </Field>
        )}
        <Field label="Notes">
          <textarea value={it.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} maxLength={4000} placeholder="Anything to remember" className={inputClass} />
        </Field>
        {t !== "note" && (
          <Field label={bookable ? "Tickets & confirmations" : "Tickets & photos"}>
            <Attachments
              tripId={trip.id}
              files={trip.files}
              ids={it.files}
              onAdd={(file) => {
                onAttach(file);
                set({ files: [...it.files, file.id] });
              }}
              onRemove={(id) => {
                onDetach(id);
                set({ files: it.files.filter((x) => x !== id) });
              }}
            />
          </Field>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Dialog>
  );
}
