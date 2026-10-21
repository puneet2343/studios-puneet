"use client";

import { useState } from "react";
import { CheckIcon, CloseIcon, PlusIcon } from "@/components/icons";
import { CHECKLIST_TEMPLATES, uid } from "@/components/trips/tripUtils";
import { inputClass } from "@/components/trips/ui";

const GROUPS = Object.keys(CHECKLIST_TEMPLATES);

function AddRow({ onAdd, placeholder }) {
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  };
  return (
    <div className="mt-2 flex gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={placeholder} maxLength={200} className={inputClass} />
      <button onClick={add} aria-label="Add" className="flex h-[2.875rem] w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 text-zinc-300 active:bg-white/5">
        <PlusIcon size={18} />
      </button>
    </div>
  );
}

/** Packing / before-you-go / documents lists with one-tap starter items. */
export default function ChecklistTab({ trip, update }) {
  const groups = [...new Set([...GROUPS, ...trip.checklist.map((c) => c.group)])];
  const done = trip.checklist.filter((c) => c.done).length;
  const total = trip.checklist.length;

  const setItems = (fn) => update((t) => ({ ...t, checklist: fn(t.checklist) }));
  const add = (group, text) => setItems((list) => [...list, { id: uid(), text, group, done: false }]);
  const addStarter = (group) =>
    setItems((list) => {
      const have = new Set(list.filter((c) => c.group === group).map((c) => c.text.toLowerCase()));
      return [...list, ...CHECKLIST_TEMPLATES[group].filter((t) => !have.has(t.toLowerCase())).map((text) => ({ id: uid(), text, group, done: false }))];
    });

  return (
    <div className="pb-6">
      {total > 0 && (
        <div className="mb-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-zinc-200">{done === total ? "All done — have a great trip!" : `${done} of ${total} done`}</span>
            <span className="tabular-nums text-zinc-500">{Math.round((done / total) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-[width] duration-500" style={{ width: `${(done / total) * 100}%` }} />
          </div>
        </div>
      )}
      {groups.map((group) => {
        const list = trip.checklist.filter((c) => c.group === group);
        const left = list.filter((c) => !c.done).length;
        return (
          <section key={group} className="mb-6">
            <div className="mb-2 flex items-center justify-between px-0.5">
              <h3 className="text-sm font-semibold text-zinc-100">
                {group} {list.length > 0 && <span className="font-normal text-zinc-500">{left ? `${left} left` : "done"}</span>}
              </h3>
              {CHECKLIST_TEMPLATES[group] && (
                <button onClick={() => addStarter(group)} className="h-9 rounded-lg px-2.5 text-xs font-medium text-violet-300 active:bg-white/5">
                  {list.length ? "Add suggestions" : "Use starter list"}
                </button>
              )}
            </div>
            {list.length > 0 && (
              <ul className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center gap-1 border-b border-white/[0.05] last:border-0">
                    <button
                      onClick={() => setItems((all) => all.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left active:bg-white/[0.04]"
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${c.done ? "border-emerald-400/60 bg-emerald-500 text-[#fff]" : "border-white/20"}`}>
                        {c.done && <CheckIcon size={13} strokeWidth={3} />}
                      </span>
                      <span className={`min-w-0 flex-1 text-[15px] ${c.done ? "text-zinc-500 line-through" : "text-zinc-100"}`}>{c.text}</span>
                    </button>
                    <button onClick={() => setItems((all) => all.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.text}`} className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 active:bg-white/5">
                      <CloseIcon size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <AddRow onAdd={(text) => add(group, text)} placeholder={`Add to ${group.toLowerCase()}`} />
          </section>
        );
      })}
    </div>
  );
}
