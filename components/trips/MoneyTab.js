"use client";

import { ClipIcon, PlusIcon } from "@/components/icons";
import { CATEGORIES, METHODS, fmtDay, money, settleUp, totals, tripDays } from "@/components/trips/tripUtils";
import { SectionTitle } from "@/components/trips/ui";

function Bar({ value, max, color }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} />
    </div>
  );
}

/** Budget, spending breakdowns, who owes whom, and every expense. */
export default function MoneyTab({ trip, onAdd, onOpen }) {
  const c = trip.currency;
  const { planned, spent, byCategory, byDay } = totals(trip);
  const budget = trip.budget;
  const pct = budget ? spent / budget : 0;
  const days = tripDays(trip);
  const daysWithSpend = Object.keys(byDay).length;
  const { balances, payments } = settleUp(trip);
  const nameOf = (id) => trip.travellers.find((p) => p.id === id)?.name ?? "Someone";
  const expensesByDate = [...trip.expenses].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const groups = [];
  for (const e of expensesByDate) {
    const key = e.date ?? "No date";
    if (groups.at(-1)?.key === key) groups.at(-1).items.push(e);
    else groups.push({ key, items: [e] });
  }
  const catMax = Math.max(1, ...Object.values(byCategory));
  const dayMax = Math.max(1, ...Object.values(byDay));

  return (
    <div className="pb-6">
      <section className="rounded-3xl border border-white/[0.07] bg-gradient-to-br from-violet-500/[0.10] to-sky-500/[0.06] p-4">
        <p className="text-xs font-medium text-zinc-400">Spent so far</p>
        <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular-nums text-zinc-50">{money(spent, c)}</p>
        {budget ? (
          <>
            <p className={`mt-1 text-sm ${pct > 1 ? "text-red-300" : pct > 0.8 ? "text-amber-200" : "text-zinc-400"}`}>
              {pct > 1 ? `${money(spent - budget, c)} over the ${money(budget, c)} budget` : `${money(budget - spent, c)} left of ${money(budget, c)}`}
            </p>
            <div className="mt-3">
              <Bar value={spent} max={budget} color={pct > 1 ? "#f87171" : pct > 0.8 ? "#fbbf24" : "linear-gradient(90deg,#a78bfa,#38bdf8)"} />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-zinc-500">No budget set · add one in Trip details</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-white/[0.05] px-3 py-2">
            <p className="text-zinc-500">Planned (bookings & plans)</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums text-zinc-100">{money(planned, c)}</p>
          </div>
          <div className="rounded-xl bg-white/[0.05] px-3 py-2">
            <p className="text-zinc-500">Per day (avg)</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums text-zinc-100">{daysWithSpend ? money(spent / daysWithSpend, c) : "—"}</p>
          </div>
        </div>
      </section>

      <button onClick={() => onAdd()} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-zinc-950 transition-transform active:scale-[0.98]">
        <PlusIcon size={16} strokeWidth={2.4} />
        Add expense
      </button>

      {spent > 0 && (
        <>
          <SectionTitle>By category</SectionTitle>
          <ul className="space-y-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            {Object.entries(byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, amount]) => (
                <li key={cat}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="flex items-center gap-2 text-zinc-200">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORIES[cat]?.color ?? "#94a3b8" }} />
                      {CATEGORIES[cat]?.label ?? cat}
                    </span>
                    <span className="tabular-nums text-zinc-300">
                      {money(amount, c)} <span className="text-xs text-zinc-500">{Math.round((amount / spent) * 100)}%</span>
                    </span>
                  </div>
                  <Bar value={amount} max={catMax} color={CATEGORIES[cat]?.color ?? "#94a3b8"} />
                </li>
              ))}
          </ul>

          {days.length > 1 && (
            <>
              <SectionTitle>By day</SectionTitle>
              <div className="no-scrollbar flex h-32 items-end gap-1.5 overflow-x-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 pb-2 pt-3">
                {days.map((d, i) => (
                  <div key={d} className="flex min-w-7 flex-1 flex-col items-center justify-end gap-1" title={`${fmtDay(d)}: ${money(byDay[d] ?? 0, c)}`}>
                    <div className="w-full max-w-8 rounded-t-md bg-gradient-to-t from-violet-500/70 to-sky-400/70" style={{ height: `${((byDay[d] ?? 0) / dayMax) * 80}px`, minHeight: byDay[d] ? 3 : 0 }} />
                    <span className="text-[10px] tabular-nums text-zinc-500">D{i + 1}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {trip.travellers.length > 1 && trip.expenses.length > 0 && (
        <>
          <SectionTitle>Settle up</SectionTitle>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            {payments.length ? (
              <ul className="space-y-2">
                {payments.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-zinc-200">
                      <b className="font-semibold">{p.from.name}</b> pays <b className="font-semibold">{p.to.name}</b>
                    </span>
                    <span className="font-semibold tabular-nums text-violet-300">{money(p.amount, c)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-emerald-300">All square — nobody owes anything.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-xs text-zinc-500">
              {balances.map((b) => (
                <span key={b.id}>
                  {b.name}: <span className={b.balance >= 0 ? "text-emerald-300" : "text-red-300"}>{b.balance >= 0 ? "+" : ""}{money(b.balance, c)}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <SectionTitle>Expenses</SectionTitle>
      {!trip.expenses.length && <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-600">Add what you spend as you go — food, fuel, tickets, shopping.</p>}
      {groups.map((g) => (
        <section key={g.key} className="mb-3">
          <p className="mb-1.5 flex justify-between px-0.5 text-xs text-zinc-500">
            <span>{g.key === "No date" ? g.key : fmtDay(g.key)}</span>
            <span className="tabular-nums">{money(g.items.reduce((s, e) => s + e.amount, 0), c)}</span>
          </p>
          <ul className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            {g.items.map((e) => (
              <li key={e.id} className="border-b border-white/[0.05] last:border-0">
                <button onClick={() => onOpen(e)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-white/[0.04]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORIES[e.category]?.color ?? "#94a3b8" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-100">{e.title}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {[CATEGORIES[e.category]?.label, METHODS[e.method], trip.travellers.length > 1 ? `${nameOf(e.paidBy)} paid` : null, e.itemId ? "from plan" : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {e.receipt && <ClipIcon size={13} className="shrink-0 text-zinc-500" />}
                  <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-100">{money(e.amount, c)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
