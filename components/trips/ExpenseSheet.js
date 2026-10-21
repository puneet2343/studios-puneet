"use client";

import { useState } from "react";
import Dialog, { Button } from "@/components/Dialog";
import { TrashIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { CATEGORIES, METHODS, guessCategory, money, today, tripDays, uid } from "@/components/trips/tripUtils";
import { Attachments, Field, MoneyInput, Segmented, TextInput, inputClass } from "@/components/trips/ui";

/**
 * Add / edit an expense. Built for logging on the go: amount first, the category is
 * guessed from the name, one tap for UPI / Cash / Card, and "Only <payer>" for personal spends.
 */
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
  const [pickedCategory, setPickedCategory] = useState(!isNew);
  const [error, setError] = useState("");
  const set = (patch) => setEx((v) => ({ ...v, ...patch }));
  const group = trip.travellers.length > 1;
  const share = ex.amount && ex.splitWith.length ? ex.amount / ex.splitWith.length : null;
  const payerName = trip.travellers.find((p) => p.id === ex.paidBy)?.name ?? "payer";
  const onlyPayer = ex.splitWith.length === 1 && ex.splitWith[0] === ex.paidBy;
  const allIn = ex.splitWith.length === everyone.length;

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
          <TextInput
            value={ex.title}
            onChange={(title) => {
              const guess = !pickedCategory && guessCategory(title);
              set(guess ? { title, category: guess } : { title });
            }}
            placeholder="e.g. Lunch at Curlies, Petrol, Parking"
            maxLength={200}
          />
        </Field>
        <Field label="Category">
          <Segmented
            wrap
            size="sm"
            value={ex.category}
            onChange={(category) => (setPickedCategory(true), set({ category }))}
            options={Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label }))}
          />
        </Field>
        <Field label="Paid with">
          <Segmented size="sm" value={ex.method} onChange={(method) => set({ method })} options={Object.entries(METHODS).map(([id, label]) => ({ id, label }))} />
        </Field>

        {group && (
          <>
            <Field label="Paid by">
              <Segmented
                wrap
                size="sm"
                value={ex.paidBy}
                // A personal spend follows the payer: "Only Riya" stays "Only <whoever paid>".
                onChange={(paidBy) => set(onlyPayer ? { paidBy, splitWith: [paidBy] } : { paidBy })}
                options={trip.travellers.map((p) => ({ id: p.id, label: p.name }))}
              />
            </Field>
            <Field label="Split between" hint={share ? (onlyPayer ? `Personal — not split` : `${money(share, trip.currency)} each`) : undefined}>
              <div className="mb-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => (set({ splitWith: everyone }), setError(""))}
                  className={`h-9 rounded-full border px-3.5 text-xs font-medium transition-colors ${allIn ? "border-violet-400/50 bg-violet-500/15 text-violet-300" : "border-white/10 text-zinc-400"}`}
                >
                  Everyone
                </button>
                <button
                  type="button"
                  onClick={() => (set({ splitWith: [ex.paidBy] }), setError(""))}
                  className={`h-9 rounded-full border px-3.5 text-xs font-medium transition-colors ${onlyPayer ? "border-violet-400/50 bg-violet-500/15 text-violet-300" : "border-white/10 text-zinc-400"}`}
                >
                  Only {payerName}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {trip.travellers.map((p) => {
                  const on = ex.splitWith.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => (set({ splitWith: on ? ex.splitWith.filter((x) => x !== p.id) : [...ex.splitWith, p.id] }), setError(""))}
                      className={`h-9 rounded-full border px-3.5 text-sm transition-colors ${on ? "border-violet-400/50 bg-violet-500/15 text-violet-300" : "border-white/10 text-zinc-500 line-through"}`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        )}

        <Field label="Date">
          <input type="date" value={ex.date ?? ""} onChange={(e) => set({ date: e.target.value || null })} className={inputClass} />
        </Field>
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
