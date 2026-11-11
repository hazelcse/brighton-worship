"use client";

import { useEffect, useRef, useState } from "react";
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
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            // Keep at least one option on in each group.
            onClick={() => onChange(on ? (value.length > 1 ? value.filter((v) => v !== o.value) : value) : [...value, o.value])}
            className={`h-8 rounded-full border px-3 text-sm font-medium ${on ? "border-ink bg-ink text-ink-foreground" : "border-border bg-surface text-muted hover:border-accent/50"}`}
          >
            {o.label}
          </button>
        );
      })}
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
  const [ministries, setMinistries] = useState<Ministry[]>(["em", "cm"]);
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
  const [types, setTypes] = useState<Type[]>(["sunday", "pnp", "adhoc"]);
  const shown = sessions.filter(
    (s) => (s.ministry === "any" || ministries.includes(s.ministry)) && types.includes(typeOf(s)),
  );
  const ids = new Set(shown.map((s) => s.id));
  const active = shown.filter((s) => !s.cancelled).length;

  return (
    // Clicks inside the roster keep a rule highlight; clicks elsewhere clear it.
    <div className="space-y-3" data-keep-highlight>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Chips label="Ministry" options={[{ value: "em", label: "EM" }, { value: "cm", label: "CM" }]} value={ministries} onChange={setMinistries} />
        <Chips
          label="Service"
          options={[
            { value: "sunday", label: "Sunday service" },
            { value: "pnp", label: "P&P" },
            { value: "adhoc", label: "Ad-hoc" },
          ]}
          value={types}
          onChange={setTypes}
        />
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
