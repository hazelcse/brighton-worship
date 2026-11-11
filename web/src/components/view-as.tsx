"use client";

import { useState, useTransition } from "react";
import { setViewAs } from "@/app/actions/dev";

const label = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

const PERSON = "person:";

/**
 * Account menu section for developers: switch which permissions you're using, or see the app as
 * one person (acting as them). viewAs is the current choice ("root", a group, "person:<id>" or null).
 */
export function ViewAsMenu({
  viewAs,
  groups,
  people,
  onPicked,
}: {
  viewAs: string | null;
  groups: string[];
  people: { id: string; name: string }[];
  onPicked?: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pick = (value: string | null) =>
    start(async () => {
      setError(null);
      const r = await setViewAs(value);
      if (!r.ok) setError(r.message);
      else onPicked?.(); // close the account menu so the page (and banner) are visible
    });
  const personId = viewAs?.startsWith(PERSON) ? viewAs.slice(PERSON.length) : "";
  const options: { value: string | null; text: string; hint: string }[] = [
    { value: null, text: "Developer", hint: "everything" },
    { value: "root", text: "Root", hint: "root's view" },
    ...groups.map((g) => ({ value: g, text: label(g), hint: "group" })),
  ];
  return (
    <div className="border-b border-border px-2 py-2" role="group" aria-label="View or act as">
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">View or act as</p>
      {options.map((o) => {
        const on = viewAs === o.value;
        return (
          <button
            key={o.text}
            type="button"
            role="menuitemradio"
            aria-checked={on}
            disabled={pending}
            onClick={() => pick(o.value)}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-background disabled:opacity-60 ${on ? "font-medium text-accent" : ""}`}
          >
            <span>
              {on ? "● " : "○ "}
              {o.text}
            </span>
            <span className="text-xs text-muted">{o.hint}</span>
          </button>
        );
      })}
      {people.length > 0 && (
        <label className="mt-1 block px-2">
          <span className={`block pb-1 text-sm ${personId ? "font-medium text-accent" : ""}`}>{personId ? "● " : "○ "}A person (act as them)</span>
          <select
            value={personId}
            disabled={pending}
            onChange={(e) => e.target.value && pick(PERSON + e.target.value)}
            aria-label="Act as a person"
            className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-accent"
          >
            <option value="">Choose someone…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="px-2 pt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
