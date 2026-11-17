"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setNoRosterRoles } from "@/app/(app)/team/actions";
/** "Keys, Bass and Drums". */
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Tick boxes in a dropdown: the parts they play, ticked = not to be rostered for. */
function RolePicker({
  options,
  value,
  onChange,
  label,
  none,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  label: (r: string) => string;
  /** Shown when nothing's ticked. */
  none: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const picked = options.filter((o) => value.includes(o));
  return (
    <div ref={ref} className="relative w-full sm:w-72">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-left text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        <span className={`truncate ${picked.length ? "" : "text-muted"}`}>{picked.length ? picked.map(label).join(", ") : none}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div role="group" aria-label="Don't roster for" className="absolute left-0 top-full z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
          {options.map((o) => {
            const on = value.includes(o);
            return (
              <label key={o} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-background">
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])} className="size-4 accent-ink" />
                {label(o)}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Root and developers: a person's own rule. They can serve the parts on their card, but shouldn't be
 * rostered for the ones picked here (the roster generator leaves them out of those parts).
 */
export function PersonalRule({
  id,
  name,
  instruments,
  noRosterRoles,
  labels,
  noun = "instruments",
}: {
  id: string;
  name: string;
  instruments: string[];
  noRosterRoles: string[];
  /** Instrument labels (lib/team can't be imported here: it reads the database). */
  labels: Record<string, string>;
  /** What the team calls them: "instruments" (worship teams) or "roles" (media teams). */
  noun?: string;
}) {
  const label = (r: string) => labels[r] ?? r;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(noRosterRoles);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Only parts they still play (one taken off their card drops out of the rule).
  const off = instruments.filter((i) => noRosterRoles.includes(i));

  const save = () =>
    start(async () => {
      const r = await setNoRosterRoles(id, draft);
      if (r.ok) {
        setEditing(false);
        setError(null);
      } else setError(r.message);
    });

  return (
    <section aria-labelledby="personal-rule-title" className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="personal-rule-title" className="text-lg font-semibold">
          Personal rule
        </h2>
        {!editing && instruments.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraft(off);
              setEditing(true);
            }}
            className="h-9 rounded-lg border border-border px-3 text-sm font-medium hover:bg-background"
          >
            Edit
          </button>
        )}
      </div>
      {instruments.length === 0 ? (
        <p className="text-sm text-muted">
          {name} has no {noun} on their card yet.
        </p>
      ) : !editing ? (
        <p className="text-sm">
          {name} can serve {list(instruments.map(label))}
          {off.length ? (
            <>
              , but should not be rostered for <span className="font-medium text-accent">{list(off.map(label))}</span>.
            </>
          ) : (
            ". No parts are held back."
          )}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            {name} can serve {list(instruments.map(label))}, but should not be rostered for:
          </p>
          <RolePicker
            options={instruments}
            value={draft}
            onChange={setDraft}
            label={label}
            none={noun === "roles" ? "Nothing: all roles they do" : "Nothing: any part they play"}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="h-9 rounded-lg bg-ink px-4 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={pending}
              className="h-9 rounded-lg border border-border px-4 text-sm font-medium hover:bg-background"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted">The roster generator won&apos;t put {name} on these parts. You can still place them there by hand.</p>
        </div>
      )}
    </section>
  );
}
