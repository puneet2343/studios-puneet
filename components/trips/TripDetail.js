"use client";

import { useRouter } from "next/navigation";
import { createElement, useEffect, useState } from "react";
import { useToast } from "@/components/Toaster";
import { ArrowLeftIcon, ChartIcon, ChecklistIcon, DotsIcon, MapIcon, PencilIcon, PinIcon, PlaneIcon, PlusIcon, TicketIcon, TrashIcon, UsersIcon, WalletIcon } from "@/components/icons";
import useBackClose from "@/components/useBackClose";
import { ConfirmDialog } from "@/components/media/Folders";
import { thumbUrl } from "@/components/media/urls";
import AnalysisTab from "@/components/trips/AnalysisTab";
import BookingsTab from "@/components/trips/BookingsTab";
import ChecklistTab from "@/components/trips/ChecklistTab";
import ExpenseSheet from "@/components/trips/ExpenseSheet";
import ItemSheet from "@/components/trips/ItemSheet";
import MoneyTab from "@/components/trips/MoneyTab";
import PlanTab, { ItemRow } from "@/components/trips/PlanTab";
import TripForm from "@/components/trips/TripForm";
import { categoryForItem, daysBetween, fmtRange, itemTitle, itemsForDay, money, today, totals, tripDays, tripStatus, uid } from "@/components/trips/tripUtils";
import useTrip, { dropTripCache } from "@/components/trips/useTrip";
import { haptic } from "@/lib/haptics";

const TABS = [
  { id: "overview", label: "Overview", icon: MapIcon },
  { id: "plan", label: "Plan", icon: PinIcon },
  { id: "bookings", label: "Bookings", icon: TicketIcon },
  { id: "money", label: "Money", icon: WalletIcon },
  { id: "analysis", label: "Analysis", icon: ChartIcon },
  { id: "checklist", label: "Checklist", icon: ChecklistIcon },
];

const STATUS_TONES = {
  upcoming: "bg-sky-500/80 text-[#fff] border-white/25",
  live: "bg-emerald-500/85 text-[#fff] border-white/25",
  done: "bg-black/45 text-[#fff] border-white/20",
  muted: "bg-black/45 text-[#fff] border-white/20",
};

function SaveState({ status }) {
  const text = { saving: "Saving…", saved: "Saved", offline: "Saved on phone · will sync", error: "Couldn't save · retrying", loading: "" }[status] ?? "";
  return <span className={`text-[11px] ${status === "offline" || status === "error" ? "text-amber-200" : "text-zinc-500"}`}>{text}</span>;
}

// What's coming next: the first plan entry from now on (or the first one, before the trip).
function nextUp(trip) {
  const t = today();
  const now = new Date().toTimeString().slice(0, 5);
  return trip.items
    .filter((i) => i.day && i.status !== "cancelled" && i.type !== "note" && !i.done)
    .sort((a, b) => `${a.day}${a.time ?? "99:99"}`.localeCompare(`${b.day}${b.time ?? "99:99"}`))
    .find((i) => i.day > t || (i.day === t && (i.time ?? "99:99") >= now));
}

function Stat({ icon, label, value, sub, tone = "", onClick }) {
  return (
    <button onClick={onClick} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 text-left active:bg-white/[0.05]">
      <span className="flex items-center gap-1.5 text-xs text-zinc-500">
        {createElement(icon, { size: 14 })}
        {label}
      </span>
      <span className={`mt-1 block text-lg font-semibold tabular-nums text-zinc-100 ${tone}`}>{value}</span>
      {sub && <span className="block text-xs text-zinc-500">{sub}</span>}
    </button>
  );
}

function Overview({ trip, update, onOpenItem, onTab, onToggleDone }) {
  const router = useRouter();
  const st = tripStatus(trip);
  const { spent, planned, byDay } = totals(trip);
  const live = st.tone === "live";
  const t = today();
  const todayItems = live ? itemsForDay(trip, t) : [];
  const spentToday = byDay[t] ?? 0;
  const todayCount = trip.expenses.filter((e) => e.date === t).length;
  const days = tripDays(trip);
  const bookings = trip.items.filter((i) => i.type === "transport" || i.type === "stay");
  const toBook = bookings.filter((i) => i.status === "tobook").length;
  const checked = trip.checklist.filter((c) => c.done).length;
  const next = nextUp(trip);
  const [notes, setNotes] = useState(trip.notes);

  return (
    <div className="space-y-4 pb-24">
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.07]">
        {trip.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl(trip.cover)} alt="" className="h-44 w-full object-cover" />
        ) : (
          <div className="flex h-44 items-center justify-center bg-gradient-to-br from-violet-600 via-indigo-500 to-sky-500 text-[#fff]/35">
            <PlaneIcon size={48} strokeWidth={1.2} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-3.5 pt-12 text-[#fff]">
          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur ${STATUS_TONES[st.tone]}`}>{st.label}</span>
          <p className="mt-1.5 text-xl font-semibold leading-tight">{trip.name}</p>
          <p className="text-sm text-[#fff]/75">{[trip.destination, fmtRange(trip.startDate, trip.endDate)].filter(Boolean).join(" · ")}</p>
        </div>
      </div>

      {live && (
        <div>
          <p className="mb-1.5 flex justify-between px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            <span>Today · {st.label}</span>
          </p>
          <button onClick={() => onTab("money")} className="mb-2 flex w-full items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-left active:bg-white/[0.05]">
            <span className="flex items-center gap-2 text-sm text-zinc-300">
              <WalletIcon size={16} className="text-zinc-500" />
              Spent today
            </span>
            <span className="text-right">
              <span className="block text-base font-semibold tabular-nums text-zinc-100">{money(spentToday, trip.currency)}</span>
              <span className="block text-xs text-zinc-500">{todayCount ? `${todayCount} expense${todayCount === 1 ? "" : "s"}` : "Nothing logged yet"}</span>
            </span>
          </button>
          {todayItems.length ? (
            <ul className="space-y-1.5">
              {todayItems.map(({ item, role }) => (
                <ItemRow key={`${item.id}-${role}`} trip={trip} item={item} role={role} onOpen={onOpenItem} onToggleDone={onToggleDone} compact />
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-center text-sm text-zinc-500">Nothing planned for today — a free day.</p>
          )}
        </div>
      )}

      {next && !(live && next.day === t) && (
        <div>
          <p className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Next up · {next.day === today() ? "today" : `in ${daysBetween(today(), next.day)} day${daysBetween(today(), next.day) === 1 ? "" : "s"}`}</p>
          <ul>
            <ItemRow trip={trip} item={next} onOpen={onOpenItem} compact />
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Stat
          icon={WalletIcon}
          label="Spent"
          value={money(spent, trip.currency, { compact: true })}
          sub={trip.budget ? `of ${money(trip.budget, trip.currency, { compact: true })} budget` : planned ? `${money(planned, trip.currency, { compact: true })} planned` : "No budget set"}
          tone={trip.budget && spent > trip.budget ? "text-red-300" : ""}
          onClick={() => onTab("money")}
        />
        <Stat icon={TicketIcon} label="Bookings" value={bookings.length ? `${bookings.length - toBook}/${bookings.length}` : "—"} sub={toBook ? `${toBook} still to book` : bookings.length ? "All booked" : "None yet"} tone={toBook ? "text-amber-200" : ""} onClick={() => onTab("bookings")} />
        <Stat icon={ChecklistIcon} label="Checklist" value={trip.checklist.length ? `${checked}/${trip.checklist.length}` : "—"} sub={trip.checklist.length ? (checked === trip.checklist.length ? "All packed" : "Keep going") : "Start packing list"} onClick={() => onTab("checklist")} />
        <Stat icon={MapIcon} label="Plan" value={days.length ? `${days.length} day${days.length === 1 ? "" : "s"}` : "—"} sub={`${trip.items.filter((i) => i.type !== "note").length} things planned`} onClick={() => onTab("plan")} />
      </div>

      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
        <UsersIcon size={17} className="shrink-0 text-zinc-500" />
        <p className="min-w-0 flex-1 truncate text-sm text-zinc-200">{trip.travellers.map((p) => p.name).join(", ")}</p>
      </div>

      {trip.mediaFolder && (
        <button
          onClick={() => {
            try {
              sessionStorage.setItem("ps.openDir", trip.mediaFolder);
            } catch {}
            router.push("/");
          }}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 text-sm font-medium text-zinc-200 active:bg-white/5"
        >
          Open trip photos & videos
        </button>
      )}

      <label className="block">
        <span className="mb-1.5 block px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            const value = e.target.value;
            update((t) => ({ ...t, notes: value }));
          }}
          rows={4}
          placeholder="Ideas, contacts, Wi-Fi passwords, what to shoot…"
          className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-400/50"
        />
      </label>
    </div>
  );
}

/** One trip: header, tabs, and the add/edit sheets. */
export default function TripDetail({ id, onBack, onDeleted }) {
  const toast = useToast();
  const { trip, update, status } = useTrip(id, { onConflict: () => toast("Combined with changes made on another device", { duration: 5000 }) });
  const [tab, setTab] = useState(() => {
    try {
      return sessionStorage.getItem(`ps.trip.tab.${id}`) || "overview";
    } catch {
      return "overview";
    }
  });
  const [itemSheet, setItemSheet] = useState(null);
  const [expenseSheet, setExpenseSheet] = useState(null);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useBackClose(menu, () => setMenu(false));

  useEffect(() => {
    try {
      sessionStorage.setItem(`ps.trip.tab.${id}`, tab);
    } catch {}
  }, [id, tab]);

  if (status === "missing") {
    return (
      <Shell onBack={onBack} title="Trip not found">
        <p className="py-16 text-center text-sm text-zinc-500">This trip was deleted.</p>
      </Shell>
    );
  }
  if (!trip && status === "unavailable") {
    return (
      <Shell onBack={onBack} title="No signal">
        <div className="px-2 py-16 text-center">
          <p className="text-[15px] font-medium text-zinc-200">This trip isn&apos;t saved on this phone yet</p>
          <p className="mt-1.5 text-sm text-zinc-500">It opens as soon as there&apos;s signal. Trips you open with signal stay on the phone for next time.</p>
        </div>
      </Shell>
    );
  }
  if (!trip) {
    return (
      <Shell onBack={onBack} title="Loading…">
        <div className="space-y-3 py-4">
          <div className="skeleton h-44 rounded-3xl" />
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
        </div>
      </Shell>
    );
  }

  const attach = (file) => update((t) => ({ ...t, files: [...t.files, file] }));

  // Saving an entry keeps its "paid" expense in step: paid -> one linked expense, otherwise none.
  function saveItem(it) {
    setItemSheet(null);
    haptic("tap");
    if (it.paid && it.status === "tobook") it = { ...it, status: "booked" };
    update((t) => {
      const exists = t.items.some((i) => i.id === it.id);
      const items = exists ? t.items.map((i) => (i.id === it.id ? it : i)) : [...t.items, it];
      const counts = it.paid && it.cost > 0 && it.status !== "cancelled";
      let expenses = t.expenses.filter((e) => e.itemId !== it.id || counts);
      if (counts) {
        const base = { title: itemTitle(it), amount: it.cost, category: categoryForItem(it), date: it.day ?? today() };
        expenses = expenses.some((e) => e.itemId === it.id)
          ? expenses.map((e) => (e.itemId === it.id ? { ...e, ...base } : e))
          : [...expenses, { id: uid(), ...base, paidBy: t.travellers[0]?.id ?? "", splitWith: t.travellers.map((p) => p.id), method: "upi", itemId: it.id, notes: "", receipt: null }];
      }
      return { ...t, items, expenses };
    });
  }

  function deleteItem(itemId) {
    setItemSheet(null);
    const before = { items: trip.items, expenses: trip.expenses };
    update((t) => ({ ...t, items: t.items.filter((i) => i.id !== itemId), expenses: t.expenses.filter((e) => e.itemId !== itemId) }));
    toast("Removed from the plan", { action: { label: "Undo", onClick: () => update((t) => ({ ...t, ...before })) } });
  }

  function saveExpense(ex) {
    setExpenseSheet(null);
    haptic("tap");
    const isNew = !trip.expenses.some((e) => e.id === ex.id);
    update((t) => ({ ...t, expenses: t.expenses.some((e) => e.id === ex.id) ? t.expenses.map((e) => (e.id === ex.id ? ex : e)) : [...t.expenses, ex] }));
    if (isNew) {
      toast(`Added ${money(ex.amount, trip.currency)} · ${ex.title}`, {
        action: { label: "Undo", onClick: () => update((t) => ({ ...t, expenses: t.expenses.filter((e) => e.id !== ex.id) })) },
      });
    }
  }

  function deleteExpense(exId) {
    setExpenseSheet(null);
    const before = { items: trip.items, expenses: trip.expenses };
    const linked = trip.expenses.find((e) => e.id === exId)?.itemId;
    update((t) => ({
      ...t,
      expenses: t.expenses.filter((e) => e.id !== exId),
      // An expense that came from a booking: the booking is no longer "paid".
      items: linked ? t.items.map((i) => (i.id === linked ? { ...i, paid: false } : i)) : t.items,
    }));
    toast("Expense deleted", { action: { label: "Undo", onClick: () => update((t) => ({ ...t, ...before })) } });
  }

  async function deleteTrip() {
    setConfirmDelete(false);
    // Made on this phone and never reached the PC: nothing to delete there.
    if (!trip.rev) {
      dropTripCache(id);
      return onDeleted(trip.name, null);
    }
    const res = await fetch(`/api/plans?id=${id}`, { method: "DELETE" }).catch(() => null);
    const data = res?.ok ? await res.json() : null;
    if (!data) return toast("Couldn't delete the trip. Check the connection.");
    dropTripCache(id);
    onDeleted(trip.name, data.undo);
  }

  const liveTrip = tripStatus(trip).tone === "live";
  const toggleDone = (item) => (haptic("tick"), update((t) => ({ ...t, items: t.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) })));

  const addItem = (preset) => setItemSheet({ id: uid(), status: "tobook", ...preset, type: preset?.type ?? (preset?.status === "idea" ? "activity" : preset?.day !== undefined ? "activity" : "transport") });

  return (
    <Shell
      onBack={onBack}
      title={trip.name}
      subtitle={<SaveState status={status} />}
      actions={
        <span className="relative">
          <button onClick={() => setMenu((m) => !m)} aria-label="Trip options" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 active:bg-white/10">
            <DotsIcon size={19} />
          </button>
          {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />}
          {menu && (
            <div className="anim-pop absolute right-0 top-12 z-20 w-52 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 py-1.5 shadow-2xl">
              <button onClick={() => (setMenu(false), setEditing(true))} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-100 active:bg-white/5">
                <PencilIcon size={17} className="text-zinc-400" /> Trip details
              </button>
              <button onClick={() => (setMenu(false), setConfirmDelete(true))} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-red-300 active:bg-white/5">
                <TrashIcon size={17} /> Delete trip
              </button>
            </div>
          )}
        </span>
      }
      tabs={
        <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-2.5">
          {TABS.map(({ id: t, label, icon: Icon }) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                document.getElementById("trip-scroll")?.scrollTo({ top: 0 });
              }}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors ${tab === t ? "bg-white text-zinc-950 font-semibold" : "text-zinc-400 active:bg-white/5"}`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      }
    >
      {tab === "overview" && <Overview trip={trip} update={update} onOpenItem={setItemSheet} onTab={setTab} onToggleDone={toggleDone} />}
      {tab === "plan" && <PlanTab trip={trip} onOpen={setItemSheet} onAdd={addItem} onToggleDone={toggleDone} />}
      {tab === "bookings" && (
        <BookingsTab trip={trip} onOpen={setItemSheet} onAdd={addItem} onMarkBooked={(item) => (haptic("success"), update((t) => ({ ...t, items: t.items.map((i) => (i.id === item.id ? { ...i, status: "booked" } : i)) })))} />
      )}
      {tab === "money" && <MoneyTab trip={trip} onOpen={setExpenseSheet} />}
      {tab === "analysis" && <AnalysisTab trip={trip} />}
      {tab === "checklist" && <ChecklistTab trip={trip} update={update} />}

      {/* One main action per tab. During the trip, logging spends is what matters most. */}
      {(tab === "money" || (tab === "overview" && liveTrip)) && (
        <button
          onClick={() => setExpenseSheet({})}
          aria-label="Add expense"
          className="anim-pop fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-zinc-950 shadow-xl shadow-black/30 transition-transform active:scale-95"
        >
          <PlusIcon size={20} strokeWidth={2.4} />
          Expense
        </button>
      )}
      {(tab === "plan" || (tab === "overview" && !liveTrip)) && (
        <button
          onClick={() => addItem(tab === "plan" ? { day: null } : undefined)}
          aria-label="Add to plan"
          className="anim-pop fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-zinc-950 shadow-xl shadow-black/30 transition-transform active:scale-95"
        >
          <PlusIcon size={20} strokeWidth={2.4} />
          Add
        </button>
      )}

      {itemSheet && (
        <ItemSheet trip={trip} item={itemSheet} onClose={() => setItemSheet(null)} onSave={saveItem} onDelete={deleteItem} onAttach={attach} onDetach={() => {}} />
      )}
      {expenseSheet && <ExpenseSheet trip={trip} expense={expenseSheet} onClose={() => setExpenseSheet(null)} onSave={saveExpense} onDelete={deleteExpense} onAttach={attach} />}
      {editing && (
        <TripForm
          trip={trip}
          onClose={() => setEditing(false)}
          onSave={(fields) => {
            setEditing(false);
            update((t) => {
              // Removed travellers drop out of splits; the first remaining one covers their payments.
              const ids = new Set(fields.travellers.map((p) => p.id));
              const fallback = fields.travellers[0]?.id ?? "";
              return {
                ...t,
                ...fields,
                expenses: t.expenses.map((e) => ({ ...e, paidBy: ids.has(e.paidBy) ? e.paidBy : fallback, splitWith: e.splitWith.filter((x) => ids.has(x)) })),
              };
            });
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${trip.name}"?`}
          message="The whole plan, bookings, expenses and attached tickets are deleted. You can undo for a few seconds (and it's kept on the PC for 3 days). Your photos and videos are not touched."
          action="Delete trip"
          onClose={() => setConfirmDelete(false)}
          onConfirm={deleteTrip}
        />
      )}
    </Shell>
  );
}

// Full-screen page for one trip (covers the bottom tabs; Back returns to the trip list).
function Shell({ onBack, title, subtitle, actions, tabs, children }) {
  return (
    <div className="anim-fade fixed inset-0 z-[45] flex flex-col bg-zinc-950">
      <div id="trip-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <header className="sticky top-0 z-20 short:static border-b border-white/[0.06] bg-zinc-950/90 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl">
          {/* Same width as the content below, so on big screens it lines up instead of stretching. */}
          <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-1 pb-2">
            <button onClick={onBack} aria-label="Back to trips" className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-200 active:bg-white/10">
              <ArrowLeftIcon size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-zinc-100">{title}</p>
              {subtitle}
            </div>
            {actions}
          </div>
          {tabs}
          </div>
        </header>
        <main className="mx-auto w-full max-w-2xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4">{children}</main>
      </div>
    </div>
  );
}
