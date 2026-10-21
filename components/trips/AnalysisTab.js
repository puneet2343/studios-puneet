"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORIES, METHODS, categoryForItem, daysBetween, fmtDay, money, today, tripDays, tripStatus } from "@/components/trips/tripUtils";
import { SectionTitle } from "@/components/trips/ui";

// Chart colours come from globals.css (--chart-1 spent, --chart-2 planned / fair share),
// validated for colour-blind separation and contrast in both themes.
const S1 = "var(--chart-1)";
const S2 = "var(--chart-2)";
const GRID = "var(--chart-grid)";

// Width of a box, kept up to date (charts draw at real pixels so text never stretches).
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Column with a 4px rounded top, square on the baseline.
const colPath = (x, y, w, h, r = 4) => {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};

// Short money for axes and chart labels: ₹50K, ₹1.5L.
const short = (v, currency) => {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(v);
  } catch {
    return money(v, currency);
  }
};

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
};

function Legend({ items }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
      {items.map(({ label, color, line, dashed }) => (
        <span key={label} className="flex items-center gap-1.5">
          {line ? (
            <svg width="16" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="15" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} />
            </svg>
          ) : (
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
          )}
          {label}
        </span>
      ))}
    </div>
  );
}

function Card({ children, className = "" }) {
  return <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 ${className}`}>{children}</div>;
}

// The readout above a chart: value first, then what it is.
function Readout({ value, label }) {
  return (
    <p className="mb-2 flex min-h-5 items-baseline gap-2 text-sm" aria-live="polite">
      <span className="font-semibold text-zinc-100">{value}</span>
      <span className="truncate text-xs text-zinc-500">{label}</span>
    </p>
  );
}

// ----- Spending pace vs the budget -----
function PaceChart({ trip, days, byDay, upTo, projected }) {
  const [ref, width] = useWidth();
  const [pick, setPick] = useState(null);
  const c = trip.currency;
  const H = 168;
  const pad = { l: 44, r: 12, t: 10, b: 22 };
  const cum = [];
  let run = 0;
  days.forEach((d, i) => {
    run += byDay[d] ?? 0;
    if (i <= upTo) cum.push(run);
  });
  const top = niceMax(Math.max(trip.budget ?? 0, projected ?? 0, run));
  const n = days.length;
  const w = Math.max(0, width - pad.l - pad.r);
  const h = H - pad.t - pad.b;
  const x = (i) => pad.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
  const y = (v) => pad.t + h - (v / top) * h;
  const line = cum.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
  const area = cum.length ? `${line}L${x(cum.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const sel = pick ?? cum.length - 1;
  const ticks = [0, top / 2, top];

  const onPoint = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - pad.l) / w) * (n - 1));
    setPick(Math.max(0, Math.min(cum.length - 1, i)));
  };

  return (
    <div ref={ref}>
      <Readout value={money(cum[sel] ?? 0, c)} label={`spent by end of Day ${sel + 1} · ${fmtDay(days[sel])}`} />
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Running total of spending compared with an even pace to the budget" onPointerDown={onPoint} onPointerMove={(e) => e.buttons && onPoint(e)} className="touch-pan-y select-none">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-zinc-500 text-[11px] tabular-nums">
                {short(t, c)}
              </text>
            </g>
          ))}
          {trip.budget > 0 && <line x1={x(0)} y1={y(0)} x2={x(n - 1)} y2={y(trip.budget)} stroke={S2} strokeWidth="2" strokeLinecap="round" />}
          {projected != null && cum.length > 0 && cum.length < n && (
            <line x1={x(cum.length - 1)} y1={y(run)} x2={x(n - 1)} y2={y(projected)} stroke={S1} strokeWidth="2" strokeLinecap="round" strokeDasharray="4 4" opacity="0.8" />
          )}
          <path d={area} fill={S1} opacity="0.1" />
          <path d={line} fill="none" stroke={S1} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {cum.length > 0 && (
            <>
              <line x1={x(sel)} x2={x(sel)} y1={pad.t} y2={pad.t + h} stroke={GRID} strokeWidth="1" />
              <circle cx={x(sel)} cy={y(cum[sel])} r="5" fill={S1} stroke="var(--background)" strokeWidth="2" />
            </>
          )}
          {[0, n - 1].filter((i, k, a) => a.indexOf(i) === k).map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : "end"} className="fill-zinc-500 text-[11px]">
              Day {i + 1}
            </text>
          ))}
        </svg>
      )}
      <Legend
        items={[
          { label: "Spent so far", color: S1, line: true },
          ...(projected != null && cum.length < n ? [{ label: "At this pace", color: S1, line: true, dashed: true }] : []),
          ...(trip.budget > 0 ? [{ label: "Even pace to budget", color: S2, line: true }] : []),
        ]}
      />
    </div>
  );
}

// ----- Spend per day -----
function DayChart({ trip, days, byDay, countByDay }) {
  const [ref, width] = useWidth();
  const c = trip.currency;
  const [pick, setPick] = useState(null);
  const H = 150;
  const pad = { l: 4, r: 4, t: 18, b: 22 };
  const values = days.map((d) => byDay[d] ?? 0);
  const max = Math.max(...values, 1);
  const top = niceMax(max);
  const peak = values.indexOf(Math.max(...values));
  const slot = (width - pad.l - pad.r) / days.length;
  const bw = Math.min(24, Math.max(4, slot - 2));
  const h = H - pad.t - pad.b;
  const sel = pick ?? peak;
  const avgDays = values.filter((v) => v > 0).length;
  const avg = avgDays ? values.reduce((s, v) => s + v, 0) / avgDays : 0;

  return (
    <div ref={ref}>
      <Readout value={money(values[sel], c)} label={`Day ${sel + 1} · ${fmtDay(days[sel])} · ${countByDay[days[sel]] ?? 0} expenses${sel === peak && values[sel] > 0 ? " · highest day" : ""}`} />
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Money spent on each day of the trip">
          <line x1={pad.l} x2={width - pad.r} y1={pad.t + h} y2={pad.t + h} stroke={GRID} strokeWidth="1" />
          {avg > 0 && (
            <>
              <line x1={pad.l} x2={width - pad.r} y1={pad.t + h - (avg / top) * h} y2={pad.t + h - (avg / top) * h} stroke="currentColor" className="text-zinc-600" strokeWidth="1" />
              <text x={width - pad.r} y={pad.t + h - (avg / top) * h - 4} textAnchor="end" className="fill-zinc-500 text-[11px]">
                avg {short(Math.round(avg), c)}
              </text>
            </>
          )}
          {values.map((v, i) => {
            const bh = (v / top) * h;
            const cx = pad.l + slot * i + slot / 2;
            return (
              <g key={days[i]}>
                <path d={colPath(cx - bw / 2, pad.t + h - bh, bw, bh)} fill={S1} opacity={i === sel ? 1 : 0.55} />
                {/* Tap target: the whole column slot, not just the bar. */}
                <rect
                  x={pad.l + slot * i}
                  y={0}
                  width={slot}
                  height={H}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`Day ${i + 1}, ${money(v, c)}`}
                  onClick={() => setPick(i)}
                  onFocus={() => setPick(i)}
                  className="cursor-pointer outline-none"
                />
                {(days.length <= 10 || i % Math.ceil(days.length / 8) === 0) && (
                  <text x={cx} y={H - 6} textAnchor="middle" className={`text-[11px] tabular-nums ${i === sel ? "fill-zinc-200" : "fill-zinc-500"}`}>
                    D{i + 1}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// Two bars per row: a value against a reference (planned, fair share).
function PairBars({ rows, currency, labels }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  return (
    <>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-zinc-200">
                {r.dot && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.dot }} />}
                <span className="truncate">{r.label}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                <span className="font-medium text-zinc-100">{money(Math.round(r.a), currency)}</span> / {money(Math.round(r.b), currency)}
              </span>
            </div>
            <svg width="100%" height="14" className="block" aria-hidden="true">
              <rect x="0" y="0" width={`${(r.a / max) * 100}%`} height="6" rx="3" fill={S1} />
              <rect x="0" y="8" width={`${(r.b / max) * 100}%`} height="6" rx="3" fill={S2} />
            </svg>
            {r.note && <p className="mt-1 text-xs text-zinc-500">{r.note}</p>}
          </li>
        ))}
      </ul>
      <Legend items={[{ label: labels[0], color: S1 }, { label: labels[1], color: S2 }]} />
    </>
  );
}

/** Everything about a trip's money and progress, in plain words and a few charts. Works offline. */
export default function AnalysisTab({ trip }) {
  const [table, setTable] = useState(false);
  const c = trip.currency;
  const days = tripDays(trip);
  const t = today();
  const st = tripStatus(trip);
  const expenses = trip.expenses;
  const spent = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const people = Math.max(1, trip.travellers.length);
  const byDay = {};
  const countByDay = {};
  for (const e of expenses) if (e.date) (byDay[e.date] = (byDay[e.date] || 0) + e.amount), (countByDay[e.date] = (countByDay[e.date] || 0) + 1);

  // Days so far: all of them once the trip is over, up to today while it's on.
  const upTo = st.tone === "live" ? daysBetween(trip.startDate, t) : st.tone === "done" ? days.length - 1 : -1;
  const daysSoFar = upTo + 1;
  const perDay = daysSoFar > 0 ? spent / daysSoFar : 0;
  // Projection: one-off bookings (flights, stays — expenses from the plan) don't repeat, so only
  // day-to-day spending is extended over the days left, plus planned bookings not paid yet.
  const daysLeft = Math.max(0, days.length - daysSoFar);
  const dayToDay = expenses.filter((e) => !e.itemId).reduce((s, e) => s + (e.amount || 0), 0);
  const dailyRate = daysSoFar > 0 ? dayToDay / daysSoFar : 0;
  // Still to pay: bookings/plans not marked paid or done that haven't happened yet (past ones are usually logged already).
  const unpaidPlanned = trip.items.filter((i) => i.status !== "cancelled" && i.cost && !i.paid && !i.done && (i.endDay ?? i.day ?? t) >= t).reduce((s, i) => s + i.cost, 0);
  const projected = st.tone === "live" && days.length ? Math.round(spent + dailyRate * daysLeft + unpaidPlanned) : null;

  // Planned (bookings & plan costs) vs actually spent, per category.
  const plannedBy = {};
  for (const i of trip.items) if (i.status !== "cancelled" && i.cost) plannedBy[categoryForItem(i)] = (plannedBy[categoryForItem(i)] || 0) + i.cost;
  const actualBy = {};
  for (const e of expenses) actualBy[e.category] = (actualBy[e.category] || 0) + e.amount;
  const catRows = Object.keys({ ...plannedBy, ...actualBy })
    .map((k) => ({ key: k, label: CATEGORIES[k]?.label ?? k, dot: CATEGORIES[k]?.color, a: actualBy[k] ?? 0, b: plannedBy[k] ?? 0 }))
    .sort((x, y) => y.a - x.a || y.b - x.b);

  // Who paid vs each person's fair share.
  const paid = {};
  const share = {};
  for (const e of expenses) {
    const split = (e.splitWith?.length ? e.splitWith : trip.travellers.map((p) => p.id)).filter((id) => trip.travellers.some((p) => p.id === id));
    paid[e.paidBy] = (paid[e.paidBy] || 0) + e.amount;
    for (const id of split) share[id] = (share[id] || 0) + e.amount / split.length;
  }
  const personRows = trip.travellers.map((p) => {
    const diff = Math.round((paid[p.id] ?? 0) - (share[p.id] ?? 0));
    return { key: p.id, label: p.name, a: paid[p.id] ?? 0, b: share[p.id] ?? 0, note: diff > 0 ? `Gets back ${money(diff, c)}` : diff < 0 ? `Owes ${money(-diff, c)}` : "Settled" };
  });

  const byMethod = {};
  for (const e of expenses) byMethod[e.method || "other"] = (byMethod[e.method || "other"] || 0) + e.amount;
  const top5 = [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5);

  // Done vs planned
  const places = trip.items.filter((i) => (i.type === "activity" || i.type === "food") && i.day && i.status !== "cancelled");
  const bookings = trip.items.filter((i) => (i.type === "transport" || i.type === "stay") && i.status !== "cancelled");

  // The findings, in plain words.
  const insights = [];
  if (spent > 0) {
    const topCat = Object.entries(actualBy).sort((a, b) => b[1] - a[1])[0];
    if (topCat) insights.push(`${CATEGORIES[topCat[0]]?.label ?? topCat[0]} is the biggest cost — ${Math.round((topCat[1] / spent) * 100)}% of everything spent.`);
    const peakDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
    if (peakDay && days.length > 1) {
      const peakTop = expenses.filter((e) => e.date === peakDay[0]).sort((a, b) => b.amount - a.amount)[0];
      insights.push(`Most expensive day: Day ${days.indexOf(peakDay[0]) + 1} (${fmtDay(peakDay[0])}) with ${money(peakDay[1], c)}${peakTop ? `, mostly ${peakTop.title}` : ""}.`);
    }
    if (trip.budget && projected != null) {
      const diff = projected - trip.budget;
      insights.push(diff > 0 ? `At this pace you'll spend about ${money(projected, c)} — ${money(diff, c)} over budget. ${trip.budget - spent - unpaidPlanned > 0 && daysLeft > 0 ? `Keep day-to-day spending under ${money(Math.round((trip.budget - spent - unpaidPlanned) / daysLeft), c)} a day to stay on budget.` : unpaidPlanned > 0 ? `Bookings still to pay (${money(unpaidPlanned, c)}) are part of that.` : ""}` : `At this pace you'll finish around ${money(projected, c)}, ${money(-diff, c)} under budget.`);
    } else if (trip.budget && st.tone === "done") {
      insights.push(spent > trip.budget ? `Finished ${money(spent - trip.budget, c)} over the ${money(trip.budget, c)} budget.` : `Finished ${money(trip.budget - spent, c)} under the ${money(trip.budget, c)} budget.`);
    }
    const cash = byMethod.cash ?? 0;
    if (cash > 0 && daysSoFar > 0) insights.push(`Cash: ${money(Math.round(cash / daysSoFar), c)} a day on average (${Math.round((cash / spent) * 100)}% of spends) — handy for planning ATM stops.`);
    if (people > 1) insights.push(`That's ${money(Math.round(spent / people), c)} per person${daysSoFar > 0 ? `, or ${money(Math.round(spent / people / daysSoFar), c)} per person per day` : ""}.`);
  }

  if (!expenses.length && !trip.items.some((i) => i.cost)) {
    return (
      <div className="px-2 py-16 text-center">
        <p className="text-[15px] font-medium text-zinc-200">Nothing to analyse yet</p>
        <p className="mt-1.5 text-sm text-zinc-500">Add booking costs or log expenses — the analysis fills in as you go.</p>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <section className="rounded-3xl border border-white/[0.07] bg-gradient-to-br from-violet-500/[0.10] to-sky-500/[0.06] p-4">
        <p className="text-xs font-medium text-zinc-400">Total spent</p>
        <p className="mt-0.5 break-words text-[2.5rem] font-semibold leading-tight tracking-tight text-zinc-50 max-[359px]:text-[2rem]">{money(spent, c)}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          {[
            ["Per day", daysSoFar > 0 ? money(Math.round(perDay), c) : "—"],
            ["Per person", money(Math.round(spent / people), c)],
            ["Budget left", trip.budget ? money(trip.budget - spent, c) : "—"],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-xl bg-white/[0.05] px-2.5 py-2">
              <p className="truncate text-zinc-500">{k}</p>
              <p className={`mt-0.5 truncate text-sm font-medium ${k === "Budget left" && trip.budget && spent > trip.budget ? "text-red-300" : "text-zinc-100"}`}>{v}</p>
            </div>
          ))}
        </div>
      </section>

      {insights.length > 0 && (
        <>
          <SectionTitle>What stands out</SectionTitle>
          <ul className="space-y-2">
            {insights.map((s) => (
              <li key={s} className="flex gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-sm leading-relaxed text-zinc-200">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300" />
                {s}
              </li>
            ))}
          </ul>
        </>
      )}

      {days.length > 1 && daysSoFar > 0 && (
        <>
          <SectionTitle>Spending pace</SectionTitle>
          <Card>
            <PaceChart trip={trip} days={days} byDay={byDay} upTo={Math.min(upTo, days.length - 1)} projected={projected} />
          </Card>
        </>
      )}

      {days.length > 1 && spent > 0 && (
        <>
          <SectionTitle action={<button onClick={() => setTable((v) => !v)} className="-my-2 flex min-h-9 items-center text-xs font-medium text-violet-300">{table ? "Show chart" : "Show as table"}</button>}>Day by day</SectionTitle>
          <Card>
            {table ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="pb-2 font-medium">Day</th>
                    <th className="pb-2 text-right font-medium">Expenses</th>
                    <th className="pb-2 text-right font-medium">Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d, i) => (
                    <tr key={d} className="border-t border-white/[0.05]">
                      <td className="py-2 text-zinc-200">
                        D{i + 1} <span className="text-xs text-zinc-500">{fmtDay(d)}</span>
                      </td>
                      <td className="py-2 text-right tabular-nums text-zinc-400">{countByDay[d] ?? 0}</td>
                      <td className="py-2 text-right tabular-nums text-zinc-100">{money(byDay[d] ?? 0, c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <DayChart trip={trip} days={days} byDay={byDay} countByDay={countByDay} />
            )}
          </Card>
        </>
      )}

      {catRows.length > 0 && (
        <>
          <SectionTitle>Planned vs spent</SectionTitle>
          <Card>
            <PairBars rows={catRows} currency={c} labels={["Spent", "Planned"]} />
          </Card>
        </>
      )}

      {trip.travellers.length > 1 && spent > 0 && (
        <>
          <SectionTitle>Who paid</SectionTitle>
          <Card>
            <PairBars rows={personRows} currency={c} labels={["Paid", "Fair share"]} />
          </Card>
        </>
      )}

      {spent > 0 && (
        <>
          <SectionTitle>How you paid</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(METHODS)
              .filter(([k]) => k !== "other" || byMethod.other)
              .map(([k, label]) => (
                <div key={k} className="min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className="mt-0.5 truncate text-[15px] font-semibold text-zinc-100">{money(byMethod[k] ?? 0, c, { compact: true })}</p>
                  <p className="text-xs text-zinc-500">{Math.round(((byMethod[k] ?? 0) / spent) * 100)}%</p>
                </div>
              ))}
          </div>

          <SectionTitle>Biggest spends</SectionTitle>
          <ol className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            {top5.map((e, i) => (
              <li key={e.id} className="flex items-center gap-3 border-b border-white/[0.05] px-3.5 py-2.5 last:border-0">
                <span className="w-4 shrink-0 text-xs tabular-nums text-zinc-500">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-100">{e.title}</span>
                  <span className="block truncate text-xs text-zinc-500">{[CATEGORIES[e.category]?.label, e.date ? fmtDay(e.date) : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-100">{money(e.amount, c)}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      <SectionTitle>Trip progress</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Places & food", places.length ? `${places.filter((i) => i.done).length}/${places.length}` : "—", "done"],
          ["Bookings", bookings.length ? `${bookings.filter((i) => i.status === "booked").length}/${bookings.length}` : "—", "booked"],
          ["Checklist", trip.checklist.length ? `${trip.checklist.filter((i) => i.done).length}/${trip.checklist.length}` : "—", "ticked"],
        ].map(([k, v, sub]) => (
          <div key={k} className="min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <p className="truncate text-xs text-zinc-500">{k}</p>
            <p className="mt-0.5 text-[15px] font-semibold text-zinc-100">{v}</p>
            <p className="text-xs text-zinc-500">{sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
