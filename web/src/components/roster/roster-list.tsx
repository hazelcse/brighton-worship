"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { createRoster, deleteRoster } from "@/app/(app)/roster/actions";
import { useCloseOnLeave } from "@/lib/use-close-on-leave";

export type RosterItem = {
  id: string;
  label: string; // "Q1 2027"
  range: string; // "1 Jan 2027 → 31 Mar 2027"
  stage: "start" | "draft" | "published";
  href: string;
};

const STAGE = {
  start: { label: "Start", style: "bg-sky-100 text-sky-800", hint: "Not generated yet" },
  draft: { label: "Draft", style: "bg-orange-100 text-orange-800", hint: "Generated, not published" },
  published: { label: "Published", style: "bg-emerald-100 text-emerald-800", hint: "Live for the quarter" },
} as const;

const QUARTER_MONTHS = ["Jan – Mar", "Apr – Jun", "Jul – Sep", "Oct – Dec"];

/** Current rosters as bars (click to open), each deletable; + opens a quarter/year picker. */
export function RosterList({
  rosters,
  isRoot,
  existing,
  defaultQuarter,
}: {
  rosters: RosterItem[];
  isRoot: boolean;
  /** "YYYY-Qn" -> what already exists for that quarter, to warn in the picker. */
  existing: Record<string, "start" | "draft" | "published">;
  defaultQuarter: { year: number; q: number };
}) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Clicking a roster selects it and shows its open (pencil) and delete (bin) buttons.
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useCloseOnLeave(dialogRef);
  const [year, setYear] = useState(String(defaultQuarter.year));
  const [q, setQ] = useState(defaultQuarter.q);
  const y = Number(year);
  const validYear = Number.isInteger(y) && y >= 2000 && y <= 2100;
  const already = validYear ? existing[`${y}-Q${q}`] : undefined;

  function remove(r: RosterItem) {
    const msg =
      r.stage === "published"
        ? `Delete the published ${r.label} roster? Everyone will lose it and this can't be undone.`
        : `Delete the ${r.label} ${r.stage === "draft" ? "draft" : "roster"}? Its sessions and assignments are removed. This can't be undone.`;
    if (!window.confirm(msg)) return;
    setError(null);
    setBusyId(r.id);
    start(async () => {
      const res = await deleteRoster(r.id);
      if (!res.ok) setError(res.message);
      setBusyId(null);
    });
  }

  function create() {
    if (!validYear) return;
    setError(null);
    const startDate = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
    start(async () => {
      const res = await createRoster(startDate); // redirects to the planning page
      if (res && !res.ok) setError(res.message);
    });
  }

  return (
    <div className="space-y-3">
      {rosters.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">No current rosters. Add one below.</p>
      ) : (
        <ul className="space-y-2">
          {rosters.map((r) => {
            const s = STAGE[r.stage];
            const canDelete = r.stage !== "published" || isRoot;
            return (
              <li key={r.id} className={`flex items-stretch gap-2 ${busyId === r.id ? "opacity-50" : ""}`}>
                <button
                  type="button"
                  aria-expanded={selected === r.id}
                  onClick={() => setSelected((x) => (x === r.id ? null : r.id))}
                  className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-surface px-4 py-3 text-left transition hover:border-accent/50 hover:shadow-sm ${selected === r.id ? "border-accent/60 shadow-sm" : "border-border"}`}
                >
                  <span className="font-medium">{r.label}</span>
                  <span className="text-sm text-muted">{r.range}</span>
                  <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.style}`} title={s.hint}>
                    {s.label}
                  </span>
                </button>
                {selected === r.id && (
                  <>
                    <Link
                      href={r.href}
                      aria-label={`Open ${r.label} roster`}
                      title="Open"
                      className="grid w-10 shrink-0 place-items-center rounded-xl border border-border/40 bg-surface/30 text-muted hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </Link>
                    {canDelete && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => remove(r)}
                        aria-label={`Delete ${r.label} roster`}
                        title="Delete"
                        className="grid w-10 shrink-0 place-items-center rounded-xl border border-border/40 bg-surface/30 text-muted hover:border-red-200/70 hover:bg-red-50/50 hover:text-danger disabled:opacity-40"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label="Add a roster"
        title="Add a roster"
        className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-dashed border-border text-2xl text-muted transition hover:border-accent/50 hover:text-accent"
      >
        +
      </button>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="new-roster-title"
        onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <div className="space-y-5 p-6">
          <h2 id="new-roster-title" className="font-display text-2xl font-semibold">
            New roster
          </h2>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Quarter</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[1, 2, 3, 4].map((n) => (
                <label
                  key={n}
                  className="cursor-pointer rounded-lg border border-border px-3 py-2 text-center has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:text-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
                >
                  <input
                    type="radio"
                    name="quarter"
                    aria-label={`Q${n}, ${QUARTER_MONTHS[n - 1]}`}
                    checked={q === n}
                    onChange={() => setQ(n)}
                    className="sr-only"
                  />
                  <span className="block font-semibold">Q{n}</span>
                  <span className="block text-xs text-muted">{QUARTER_MONTHS[n - 1]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1 text-sm font-medium">
            Year
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          {already && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {already === "published"
                ? `Q${q} ${y} is already published. This starts a new draft version; publishing it later replaces the current one.`
                : `Q${q} ${y} already has a ${already === "draft" ? "draft" : "roster that hasn't been generated"}. You'll carry on with it.`}
            </p>
          )}
          <p className="text-xs text-muted">Every EM and CM Sunday service and P&amp;P in the quarter is added for you.</p>
          <div className="flex justify-end gap-3 border-t border-border pt-4">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-lg px-4 py-2 text-sm text-muted">
              Cancel
            </button>
            <button
              type="button"
              disabled={!validYear || pending}
              onClick={create}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-50"
            >
              {pending ? "Setting up…" : already && already !== "published" ? `Open Q${q} ${validYear ? y : ""}` : `Create Q${q} ${validYear ? y : ""}`}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
