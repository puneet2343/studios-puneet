"use client";

import { useCallback, useEffect, useState } from "react";
import Dialog from "@/components/Dialog";
import { NameDialog } from "@/components/media/Folders";
import useBackClose from "@/components/useBackClose";

// People found in your photos (on the PC, see lib/ai.js).
export const faceUrl = (cover) => (cover ? `/api/face?key=${cover.key}&i=${cover.i}` : null);

export function usePeople() {
  const [people, setPeople] = useState(null);
  const load = useCallback(async () => {
    const d = await fetch("/api/people", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (d) setPeople(d.people);
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 30000);
    return () => {
      clearTimeout(t);
      clearInterval(timer);
    };
  }, [load]);
  return { people, reload: load };
}

export async function updatePerson(id, change) {
  const res = await fetch("/api/people", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...change }) }).catch(() => null);
  return Boolean(res?.ok);
}

export function Face({ person, size = 72, className = "" }) {
  const [failed, setFailed] = useState(false);
  const url = faceUrl(person.cover);
  return (
    <span className={`block shrink-0 overflow-hidden rounded-full bg-surface-2 ${className}`} style={{ width: size, height: size }}>
      {url && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
    </span>
  );
}

export function NamePersonDialog({ person, onClose, onDone }) {
  return (
    <NameDialog
      title={person.name ? "Rename" : "Who is this?"}
      action="Save"
      initial={person.name}
      onClose={onClose}
      submit={async (name) => {
        if (!(await updatePerson(person.id, { name }))) return "Couldn't save. Check the connection.";
        onDone();
      }}
    />
  );
}

/** "Same person as…": pick who this person really is; their photos join together. */
export function MergeDialog({ person, people, onClose, onDone }) {
  useBackClose(true, onClose);
  const others = (people ?? []).filter((p) => p.id !== person.id);
  return (
    <Dialog title="Same person as…" onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-500">Pick who this really is. Their photos are put together under one person.</p>
      <div className="grid grid-cols-3 gap-3 pb-2 sm:grid-cols-4">
        {others.map((p) => (
          <button
            key={p.id}
            onClick={async () => {
              if (await updatePerson(person.id, { mergeInto: p.id })) onDone(p);
            }}
            className="flex flex-col items-center gap-1.5 rounded-2xl p-2 hover:bg-white/5"
          >
            <Face person={p} size={64} />
            <span className="w-full truncate text-center text-xs text-zinc-300">{p.name || `${p.count} photos`}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
