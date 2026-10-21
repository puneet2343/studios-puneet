import {
  BedIcon,
  BikeIcon,
  BusIcon,
  CarIcon,
  FoodIcon,
  NoteIcon,
  PinIcon,
  PlaneIcon,
  ShipIcon,
  TrainIcon,
} from "@/components/icons";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "THB", "SGD", "IDR", "JPY", "AUD", "NPR", "LKR"];

export function money(amount, currency = "INR", { compact = false } = {}) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: compact || Number.isInteger(amount) ? 0 : 2,
      notation: compact && Math.abs(amount) >= 100000 ? "compact" : "standard",
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

// ----- Dates (always local, "YYYY-MM-DD", never shifted by time zones) -----
export const parseDay = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const toDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => toDay(new Date());
export const addDays = (s, n) => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return toDay(d);
};
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);

export function tripDays(trip) {
  if (!trip.startDate) return [];
  const end = trip.endDate && trip.endDate >= trip.startDate ? trip.endDate : trip.startDate;
  const out = [];
  for (let d = trip.startDate; d <= end && out.length < 120; d = addDays(d, 1)) out.push(d);
  return out;
}

export const fmtDay = (s, opts = { weekday: "short", day: "numeric", month: "short" }) => (s ? parseDay(s).toLocaleDateString("en-IN", opts) : "");

export function fmtRange(start, end) {
  if (!start) return "Dates not set";
  if (!end || end === start) return fmtDay(start, { day: "numeric", month: "short", year: "numeric" });
  const a = parseDay(start);
  const b = parseDay(end);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return sameMonth
    ? `${a.getDate()}–${b.getDate()} ${b.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`
    : `${fmtDay(start, { day: "numeric", month: "short" })} – ${fmtDay(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

export const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
};

// "In 12 days" / "Tomorrow" / "Day 3 of 5" / "Completed"
export function tripStatus(trip) {
  const t = today();
  if (!trip.startDate) return { label: "Dates not set", tone: "muted" };
  const end = trip.endDate || trip.startDate;
  if (t < trip.startDate) {
    const n = daysBetween(t, trip.startDate);
    return { label: n === 1 ? "Tomorrow" : `In ${n} days`, tone: "upcoming", days: n };
  }
  if (t <= end) return { label: `Day ${daysBetween(trip.startDate, t) + 1} of ${daysBetween(trip.startDate, end) + 1}`, tone: "live" };
  return { label: "Completed", tone: "done" };
}

// ----- Itinerary items -----
export const ITEM_TYPES = {
  transport: { label: "Transport", icon: PlaneIcon, tint: "text-sky-300 bg-sky-500/10" },
  stay: { label: "Stay", icon: BedIcon, tint: "text-violet-300 bg-violet-500/10" },
  activity: { label: "Place / activity", icon: PinIcon, tint: "text-emerald-300 bg-emerald-500/10" },
  food: { label: "Food", icon: FoodIcon, tint: "text-amber-200 bg-amber-400/10" },
  note: { label: "Note", icon: NoteIcon, tint: "text-zinc-300 bg-white/[0.06]" },
};

export const MODES = {
  flight: { label: "Flight", icon: PlaneIcon },
  train: { label: "Train", icon: TrainIcon },
  bus: { label: "Bus", icon: BusIcon },
  car: { label: "Car / cab", icon: CarIcon },
  ferry: { label: "Ferry", icon: ShipIcon },
  bike: { label: "Bike / scooty", icon: BikeIcon },
};

export const STATUSES = {
  idea: { label: "Idea", tone: "text-zinc-400 border-white/10" },
  tobook: { label: "To book", tone: "text-amber-200 border-amber-400/30 bg-amber-400/[0.06]" },
  booked: { label: "Booked", tone: "text-emerald-300 border-emerald-400/30 bg-emerald-500/[0.07]" },
  cancelled: { label: "Cancelled", tone: "text-red-300 border-red-400/30 bg-red-500/[0.06] line-through" },
};

export const iconFor = (item) => (item.type === "transport" ? MODES[item.mode]?.icon ?? PlaneIcon : ITEM_TYPES[item.type]?.icon ?? PinIcon);

export function itemTitle(item) {
  if (item.title) return item.title;
  if (item.type === "transport" && (item.from || item.to)) return `${item.from || "?"} → ${item.to || "?"}`;
  return ITEM_TYPES[item.type]?.label ?? "Item";
}

// Everything that happens on one day, in time order. A stay shows on every night:
// check-in on its first day, "staying" in between, check-out on its last.
export function itemsForDay(trip, day) {
  const out = [];
  for (const item of trip.items) {
    if (item.type === "stay" && item.day && item.endDay && item.endDay > item.day) {
      if (day === item.day) out.push({ item, role: "checkin", time: item.time || "14:00" });
      else if (day === item.endDay) out.push({ item, role: "checkout", time: item.endTime || "11:00" });
      else if (day > item.day && day < item.endDay) out.push({ item, role: "staying", time: "23:59" });
    } else if (item.day === day) {
      out.push({ item, role: null, time: item.time || "99:99" });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export const isBooking = (item) => item.type === "transport" || item.type === "stay";

export const mapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

// ----- Money -----
export const CATEGORIES = {
  transport: { label: "Transport", color: "#38bdf8" },
  stay: { label: "Stay", color: "#a78bfa" },
  food: { label: "Food & drinks", color: "#fbbf24" },
  activities: { label: "Activities", color: "#34d399" },
  shopping: { label: "Shopping", color: "#f472b6" },
  fuel: { label: "Fuel", color: "#fb923c" },
  other: { label: "Other", color: "#94a3b8" },
};

export const categoryForItem = (item) => ({ transport: "transport", stay: "stay", food: "food", activity: "activities" })[item.type] ?? "other";

export const METHODS = { upi: "UPI", cash: "Cash", card: "Card", other: "Other" };

export function totals(trip) {
  const planned = trip.items.filter((i) => i.status !== "cancelled" && i.cost).reduce((s, i) => s + i.cost, 0);
  const spent = trip.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const byCategory = {};
  for (const e of trip.expenses) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  const byDay = {};
  for (const e of trip.expenses) if (e.date) byDay[e.date] = (byDay[e.date] || 0) + e.amount;
  return { planned, spent, byCategory, byDay };
}

// Who owes whom: everyone's share vs what they paid, settled with the fewest payments.
export function settleUp(trip) {
  const people = trip.travellers;
  if (people.length < 2) return { balances: [], payments: [] };
  const bal = Object.fromEntries(people.map((p) => [p.id, 0]));
  for (const e of trip.expenses) {
    const share = (e.splitWith?.length ? e.splitWith : people.map((p) => p.id)).filter((id) => id in bal);
    if (!share.length || !(e.paidBy in bal)) continue;
    bal[e.paidBy] += e.amount;
    for (const id of share) bal[id] -= e.amount / share.length;
  }
  const balances = people.map((p) => ({ ...p, balance: Math.round(bal[p.id] * 100) / 100 }));
  const owe = balances.filter((b) => b.balance < -0.5).map((b) => ({ ...b, left: -b.balance })).sort((a, b) => b.left - a.left);
  const get = balances.filter((b) => b.balance > 0.5).map((b) => ({ ...b, left: b.balance })).sort((a, b) => b.left - a.left);
  const payments = [];
  for (const debtor of owe) {
    for (const creditor of get) {
      if (debtor.left < 0.5) break;
      if (creditor.left < 0.5) continue;
      const amount = Math.min(debtor.left, creditor.left);
      payments.push({ from: debtor, to: creditor, amount: Math.round(amount) });
      debtor.left -= amount;
      creditor.left -= amount;
    }
  }
  return { balances, payments };
}

// ----- Checklist starters -----
export const CHECKLIST_TEMPLATES = {
  Packing: ["Phone charger & power bank", "Clothes for each day", "Toiletries", "Medicines", "Sunglasses & sunscreen", "Comfortable shoes", "Camera / gimbal & batteries", "Memory cards", "Earphones"],
  "Before you go": ["Book transport", "Book stay", "Check weather", "Download offline maps", "Tell bank about travel", "Charge all devices", "Back up phone to Puneet Studios"],
  Documents: ["ID card (Aadhaar / passport)", "Tickets (saved offline)", "Hotel confirmations", "Driving licence", "Travel insurance", "Some cash"],
};
