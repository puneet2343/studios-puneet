"use client";

import { useState } from "react";
import Dialog, { Button } from "@/components/Dialog";
import { TrashIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { CATEGORIES, METHODS, money, today, tripDays, uid } from "@/components/trips/tripUtils";
import { Attachments, Field, MoneyInput, Segmented, TextInput, inputClass } from "@/components/trips/ui";

/** Add / edit an expense: amount, category, who paid, who shares it, receipt photo. */
export default function ExpenseSheet({ trip, expense, onClose, onSave, onDelete, onAttach }) {
  useBackClose(true, onClose);
  const isNew = !trip.expenses.some((e) => e.id === expense?.id);
  const everyone = trip.travellers.map((p) => p.id);
  const days = tripDays(trip);
  const t = today();
  const [ex, setEx] = useState(() => ({
    id: uid(),
    title: "",
    amount: null,
    category: "food",
    date: days.includes(t) ? t : days[0] ?? t,
    paidBy: everyone[0] ?? "",
    splitWith: everyone,
    method: "upi",
    itemId: null,
    notes: "",
    receipt: null,
    ...expense,
  }));
  const [error, setError] = useState("");
  const set = (patch) => setEx((v) => ({ ...v, ...patch }));
  const group = trip.travellers.length > 1;
  const share = ex.amount && ex.splitWith.length ? ex.amount / ex.splitWith.length : null;

  function submit(e) {
    e.preventDefault();
    if (!ex.amount || ex.amount <= 0) return setError("Enter the amount");
    if (group && !ex.splitWith.length) return setError("Pick at least one person to share it");
    onSave({ ...ex, title: ex.title.trim() || CATEGORIES[ex.category]?.label || "Expense" });
  }

  return (
    <Dialog
      title={isNew ? "Add expense" : "Expense"}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <Button type="button" variant="ghost" onClick={() => onDelete(ex.id)} aria-label="Delete" className="mr-auto px-3 text-red-300 max-sm:flex-none">
              <TrashIcon size={17} />
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="expense-form">
            {isNew ? "Add" : "Save"}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="space-y-4 pb-1">
        <Field label="Amount">
          <MoneyInput value={ex.amount} onChange={(amount) => (set({ amount }), setError(""))} currency={trip.currency} placeholder="0" autoFocus={isNew} />
        </Field>
        <Field label="What for">
          <TextInput value={ex.title} onChange={(title) => set({ title })} placeholder="e.g. Dinner at Thalassa" maxLength={200} />
        </Field>
        <Field label="Category">
          <Segmented size="sm" value={ex.category} onChange={(category) => set({ category })} options={Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" value={ex.date ?? ""} onChange={(e) => set({ date: e.target.value || null })} className={inputClass} />
          </Field>
          <Field label="Paid with">
            <select value={ex.method} onChange={(e) => set({ method: e.target.value })} className={inputClass}>
              {Object.entries(METHODS).map(([id, label]) => (
                <option key={id} value={id} className="bg-zinc-900">
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {group && (
          <>
            <Field label="Paid by">
              <Segmented size="sm" value={ex.paidBy} onChange={(paidBy) => set({ paidBy })} options={trip.travellers.map((p) => ({ id: p.id, label: p.name }))} />
            </Field>
            <Field label="Split between" hint={share ? `${money(share, trip.currency)} each` : undefined}>
              <div className="flex flex-wrap gap-1.5">
                {trip.travellers.map((p) => {
                  const on = ex.splitWith.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => (set({ splitWith: on ? ex.splitWith.filter((x) => x !== p.id) : [...ex.splitWith, p.id] }), setError(""))}
                      className={`h-9 rounded-full border px-3.5 text-sm transition-colors ${on ? "border-violet-400/50 bg-violet-500/15 text-violet-300" : "border-white/10 text-zinc-500 line-through"}`}
                    >
                      {p.name}
                    </button>
                  );
                })}
                <button type="button" onClick={() => set({ splitWith: everyone })} className="h-9 rounded-full px-3 text-xs font-medium text-violet-300">
                  Everyone
                </button>
              </div>
            </Field>
          </>
        )}

        <Field label="Notes">
          <textarea value={ex.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} maxLength={2000} className={inputClass} />
        </Field>
        <Field label="Receipt">
          <Attachments
            tripId={trip.id}
            files={trip.files}
            ids={ex.receipt ? [ex.receipt] : []}
            accept="image/*,application/pdf"
            capture="environment"
            label={ex.receipt ? "Replace receipt" : "Take a photo of the receipt"}
            onAdd={(file) => {
              onAttach(file);
              set({ receipt: file.id });
            }}
            onRemove={() => set({ receipt: null })}
          />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Dialog>
  );
}
