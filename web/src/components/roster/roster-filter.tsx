"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { CellEditor, type EditPerson } from "./cell-editor";
import { isHighlighted, useHighlight } from "./highlight";
import { hhmm } from "@/lib/roster";
import type { AssignmentRow, SessionRow } from "@/lib/roster-data";
import { RosterTable } from "./roster-results";
import { SessionDialog } from "./session-planner";

type Ministry = "em" | "cm";
type Type = "sunday" | "pnp" | "adhoc";

/** Sunday services, P&Ps, or ad-hoc events (anything added by hand, e.g. Christmas Eve). */
const typeOf = (s: SessionRow): Type => (s.kind.endsWith("_pnp") ? "pnp" : s.kind === "custom" ? "adhoc" : "sunday");

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  phonesHidden,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  /** Below 640px, when MobileRosterFilter shows these instead. */
  phonesHidden?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={`${phonesHidden ? "hidden sm:flex" : "flex"} items-center gap-1.5`}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            // Keep at least one option on in each group.
            onClick={() => onChange(toggle(value, o.value))}
            className={`h-8 rounded-full border px-3 text-sm font-medium ${on ? "border-ink bg-ink text-ink-foreground" : "border-border bg-surface text-muted hover:border-accent/50"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const MINISTRY_OPTIONS: { value: Ministry; label: string }[] = [
  { value: "em", label: "EM" },
  { value: "cm", label: "CM" },
];
const TYPE_OPTIONS: { value: Type; label: string }[] = [
  { value: "sunday", label: "Sunday service" },
  { value: "pnp", label: "P&P" },
  { value: "adhoc", label: "Ad-hoc" },
];

type Filters = {
  ministries: Ministry[];
  setMinistries: (v: Ministry[]) => void;
  types: Type[];
  setTypes: (v: Type[]) => void;
};
const FilterContext = createContext<Filters | null>(null);

/**
 * Shares the roster filters between the table and a dropdown elsewhere on the page: the roster editor
 * puts that dropdown (`MobileRosterFilter`) in the header's button row on phones, in place of the chips.
 */
export function RosterFilterProvider({ children }: { children: React.ReactNode }) {
  const [ministries, setMinistries] = useState<Ministry[]>(["em", "cm"]);
  const [types, setTypes] = useState<Type[]>(["sunday", "pnp", "adhoc"]);
  return <FilterContext.Provider value={{ ministries, setMinistries, types, setTypes }}>{children}</FilterContext.Provider>;
}

/** Turn one option on or off, keeping at least one on in its group. */
function toggle<T>(value: T[], v: T): T[] {
  return value.includes(v) ? (value.length > 1 ? value.filter((x) => x !== v) : value) : [...value, v];
}

/** Phones only: the Ministry and Service filters as one dropdown of checkboxes, the same size as the header buttons. */
export function MobileRosterFilter() {
  const f = useContext(FilterContext);
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
  if (!f) return null;
  const off = MINISTRY_OPTIONS.length - f.ministries.length + TYPE_OPTIONS.length - f.types.length;
  const group = <T extends string>(label: string, options: { value: T; label: string }[], value: T[], set: (v: T[]) => void) => (
    <fieldset className="space-y-0.5">
      <legend className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-background">
          <input
            type="checkbox"
            checked={value.includes(o.value)}
            // The last one on in a group can't be turned off.
            disabled={value.length === 1 && value.includes(o.value)}
            onChange={() => set(toggle(value, o.value))}
            className="size-4 accent-ink"
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
  return (
    // mr-auto: the filter sits at the left of the header's button row, the buttons stay right-aligned.
    <div ref={ref} className="relative mr-auto sm:hidden" data-keep-highlight>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        aria-label={off ? "Filters: some sessions hidden" : "Filters: all sessions"}
        // Looks like the shared FilterMenu button (which only does one choice per group).
        className={`flex h-10 items-center gap-2 rounded-lg border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
          off ? "border-accent/60" : "border-border"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        Filter
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-52 space-y-3 rounded-xl border border-border bg-surface p-2 shadow-lg">
          {group("Ministry", MINISTRY_OPTIONS, f.ministries, f.setMinistries)}
          {group("Service", TYPE_OPTIONS, f.types, f.setTypes)}
        </div>
      )}
    </div>
  );
}

/** The roster table with EM/CM and Sunday/P&P/ad-hoc filters (any combination; at least one of each). */
export function FilteredRosterTable({
  sessions,
  assignments,
  edit,
  serveStatus,
  thisWeekOf,
  locked,
  toolbarEnd,
}: {
  sessions: SessionRow[];
  assignments: AssignmentRow[];
  /** This quarter's roster only: "sessionId|memberId" -> whether they've confirmed. */
  serveStatus?: Record<string, "pending" | "accepted" | "declined">;
  /** Mark out the week containing this day ("YYYY-MM-DD"), e.g. today on this quarter's roster. */
  thisWeekOf?: string;
  /** With `edit`: keep the edit highlights but don't open cells (editing a published roster before the pencil is pressed). */
  locked?: boolean;
  /** Shown at the right end of the filter row (e.g. the edited / published toggle). */
  toolbarEnd?: React.ReactNode;
  /** Root on a generated draft: click a cell to change who's in it. */
  edit?: {
    rosterId: string;
    people: EditPerson[];
    editedCells: string[];
    /** "sessionId|role|memberId" as generated, to bold names changed by hand. */
    generatedKeys?: string[];
    shares: Record<string, number>;
    /** "sessionId|role" -> hard problem in that cell, shown red. */
    problemCells?: Record<string, string>;
    /** The roster's dates: with this, clicking a session's date or name opens its settings. */
    quarter?: { start: string; end: string };
  };
}) {
  // Inside a RosterFilterProvider the filters are shared with MobileRosterFilter, which replaces the chips on phones.
  const shared = useContext(FilterContext);
  const [ownMinistries, setOwnMinistries] = useState<Ministry[]>(["em", "cm"]);
  const [ownTypes, setOwnTypes] = useState<Type[]>(["sunday", "pnp", "adhoc"]);
  const { ministries, setMinistries, types, setTypes } = shared ?? {
    ministries: ownMinistries,
    setMinistries: setOwnMinistries,
    types: ownTypes,
    setTypes: setOwnTypes,
  };
  const hl = useHighlight();
  const [cell, setCell] = useState<{ sessionId: string; role: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (cell && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [cell]);
  const close = () => {
    dialogRef.current?.close();
    setCell(null);
  };
  const editingSession = cell ? sessions.find((s) => s.id === cell.sessionId) : undefined;
  // The session whose settings (band, who can serve, times…) are open.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (sessionId && !sessionRef.current?.open) sessionRef.current?.showModal();
  }, [sessionId]);
  const closeSession = () => {
    sessionRef.current?.close();
    setSessionId(null);
  };
  const settingsOf = sessionId ? sessions.find((s) => s.id === sessionId) : undefined;
  // With `thisWeekOf`: sessions in earlier weeks start folded away (the triangle beside the table shows them).
  const [showPast, setShowPast] = useState(false);
  const shown = sessions.filter(
    (s) => (s.ministry === "any" || ministries.includes(s.ministry)) && types.includes(typeOf(s)),
  );
  const ids = new Set(shown.map((s) => s.id));
  const active = shown.filter((s) => !s.cancelled).length;

  return (
    // Clicks inside the roster keep a rule highlight; clicks elsewhere clear it.
    <div className="space-y-3" data-keep-highlight>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Chips label="Ministry" options={MINISTRY_OPTIONS} value={ministries} onChange={setMinistries} phonesHidden={!!shared} />
        <Chips label="Service" options={TYPE_OPTIONS} value={types} onChange={setTypes} phonesHidden={!!shared} />
        <span className="text-xs text-muted">{active} sessions</span>
        {toolbarEnd && <div className="ml-auto">{toolbarEnd}</div>}
      </div>
      {active === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">No sessions match these filters.</p>
      ) : (
        <RosterTable
          sessions={shown}
          assignments={assignments.filter((a) => ids.has(a.session_id))}
          onCellClick={edit && !locked ? (sessionId, role) => setCell({ sessionId, role }) : undefined}
          onSessionClick={edit?.quarter && !locked ? setSessionId : undefined}
          edited={edit ? new Set(edit.editedCells) : undefined}
          generated={edit?.generatedKeys?.length ? new Set(edit.generatedKeys) : undefined}
          nameOf={edit ? (id) => edit.people.find((p) => p.id === id)?.name ?? "Someone" : undefined}
          problems={edit?.problemCells ? new Map(Object.entries(edit.problemCells)) : undefined}
          serveStatus={serveStatus}
          thisWeekOf={thisWeekOf}
          pastHidden={!showPast}
          onTogglePast={thisWeekOf ? () => setShowPast((v) => !v) : undefined}
          isMarked={hl?.highlight ? (memberId, date) => isHighlighted(hl.highlight, memberId, date) : undefined}
        />
      )}
      {edit && (
        <dialog
          ref={dialogRef}
          onClose={() => setCell(null)}
          aria-label="Change who's serving"
          className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
        >
          <div className="max-h-[88vh] overflow-y-auto p-6">
            {cell && editingSession && (
              <CellEditor
                key={`${cell.sessionId}|${cell.role}`}
                rosterId={edit.rosterId}
                session={editingSession}
                role={cell.role}
                sessions={sessions}
                assignments={assignments}
                people={edit.people}
                shares={edit.shares}
                onClose={close}
              />
            )}
          </div>
        </dialog>
      )}
      {edit?.quarter && (
        <dialog
          ref={sessionRef}
          onClose={() => setSessionId(null)}
          aria-label="Change this session"
          className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
        >
          <div className="max-h-[88vh] overflow-y-auto p-6">
            {settingsOf && (
              <SessionDialog
                key={settingsOf.id}
                rosterId={edit.rosterId}
                quarter={edit.quarter}
                onClose={closeSession}
                band={assignments
                  .filter((a) => a.session_id === settingsOf.id)
                  .map((a) => ({ member_id: a.member_id, name: a.name, role: a.role, also_roles: a.also_roles }))}
                draft={{
                  id: settingsOf.id,
                  kind: settingsOf.kind,
                  date: settingsOf.date,
                  name: settingsOf.name,
                  ministry: settingsOf.ministry,
                  weight: settingsOf.weight,
                  composition: settingsOf.composition,
                  cancelled: settingsOf.cancelled,
                  cancel_reason: settingsOf.cancel_reason ?? "",
                  note: settingsOf.note,
                  rehearsal_date: settingsOf.rehearsal_date,
                  start_time: hhmm(settingsOf.start_time),
                  rehearsal_time: hhmm(settingsOf.rehearsal_time),
                }}
              />
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
