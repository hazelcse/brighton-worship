"use client";

import { createContext, useContext, useEffect, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { refreshAfterEdit } from "@/app/(app)/roster/actions";
import { CellEditor, applyCellEdit, type CellEdit, type EditPerson } from "./cell-editor";
import { isHighlighted, useHighlight } from "./highlight";
import { hhmm, usesMinistry } from "@/lib/roster";
import type { TeamConfig } from "@/lib/team-config";
import type { AssignmentRow, SessionRow } from "@/lib/roster-data";
import { RosterTable } from "./roster-results";
import { SessionDialog } from "./session-planner";

type Ministry = "em" | "cm";
type Type = "sunday" | "saturday" | "pnp" | "adhoc";
const ALL_TYPES: Type[] = ["sunday", "saturday", "pnp", "adhoc"];

/** Sunday services, Saturday (Youth) services, P&Ps, or ad-hoc events (anything added by hand, e.g. Christmas Eve). */
const typeOf = (s: SessionRow): Type =>
  s.kind.endsWith("_pnp") ? "pnp" : s.kind === "custom" ? "adhoc" : s.kind === "saturday" ? "saturday" : "sunday";

/** The Service chips this roster needs: its regular kinds (e.g. Youth: Saturday service), then Ad-hoc. */
const typeOptions = (sessions: SessionRow[]) => {
  const has = new Set(sessions.map(typeOf));
  return TYPE_OPTIONS.filter((o) => o.value === "adhoc" || has.has(o.value));
};

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
            onClick={() => onChange(toggle(value, o.value, options.map((x) => x.value)))}
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
  { value: "saturday", label: "Saturday service" },
  { value: "pnp", label: "P&P" },
  { value: "adhoc", label: "Ad-hoc" },
];

/**
 * Root and developers: tick people to see only the sessions they're serving at (nothing ticked =
 * every session). A chip-sized dropdown with a search box, shown at every width.
 */
function PeopleFilter({ people, value, onChange }: { people: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
  const q = query.trim().toLowerCase();
  const list = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";
  const summary = value.length === 0 ? "Everyone" : value.length === 1 ? nameOf(value[0]) : `${value.length} people`;
  return (
    <div ref={ref} role="group" aria-label="People" className="relative flex min-w-0 items-center gap-1.5">
      {/* Phones: just the dropdown, without the word. */}
      <span className="hidden text-xs font-medium uppercase tracking-wide text-muted sm:inline">People</span>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`People: ${value.length ? value.map(nameOf).join(", ") : "everyone"}`}
        onClick={() => setOpen((v) => !v)}
        // Phones: the squarer 40px button, like the Filter dropdown beside it. From 640px: a chip like the others.
        className={`flex h-10 min-w-0 max-w-48 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink/20 sm:h-8 sm:gap-1.5 sm:rounded-full sm:font-medium ${
          value.length ? "sm:border-ink sm:bg-ink sm:text-ink-foreground" : "sm:text-muted sm:hover:border-accent/50"
        }`}
      >
        {/* Phones: a person icon stands in for the "People" label. */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted sm:hidden">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
        <span className="truncate">{summary}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <div className="p-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people"
              aria-label="Search people"
              autoFocus
              className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="max-h-64 overflow-y-auto border-t border-border py-1">
            {list.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">No one matches.</p>
            ) : (
              list.map((p) => {
                const on = value.includes(p.id);
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-background">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onChange(on ? value.filter((v) => v !== p.id) : [...value, p.id])}
                      className="size-4 accent-ink"
                    />
                    {p.name}
                  </label>
                );
              })
            )}
          </div>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
              className="w-full border-t border-border px-3 py-2.5 text-left text-sm text-muted hover:bg-background hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Shows or hides the orange box around the viewer's own cells (remembered in this browser). */
function MineToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const label = on ? "Hide the box around your cells" : "Show a box around your cells";
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={`flex size-8 items-center justify-center rounded-full border ${on ? "border-ink bg-ink text-ink-foreground" : "border-ink bg-surface text-ink"}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
        {!on && <path d="m3 3 18 18" />}
      </svg>
    </button>
  );
}

// Whether the viewer has turned the box off, in this browser's localStorage (a per-viewer convenience).
const MINE_KEY = "roster.showMine";
const mineListeners = new Set<() => void>();
function subscribeMine(l: () => void) {
  mineListeners.add(l);
  return () => mineListeners.delete(l);
}
function readMine(): boolean {
  try {
    return localStorage.getItem(MINE_KEY) !== "0";
  } catch {
    return true;
  }
}

type Filters = {
  ministries: Ministry[];
  setMinistries: (v: Ministry[]) => void;
  types: Type[];
  setTypes: (v: Type[]) => void;
  /** The Service options this roster offers (e.g. Youth: Saturday service and Ad-hoc). */
  serviceOptions: { value: Type; label: string }[];
  /** Offer the Ministry filter (not when no session is EM or CM, e.g. Youth). */
  showMinistry?: boolean;
};
const FilterContext = createContext<Filters | null>(null);

/**
 * Shares the roster filters between the table and a dropdown elsewhere on the page: the roster editor
 * puts that dropdown (`MobileRosterFilter`) in the header's button row on phones, in place of the chips.
 */
export function RosterFilterProvider({
  children,
  showMinistry = true,
  sessions,
}: {
  children: React.ReactNode;
  showMinistry?: boolean;
  /** The roster's sessions, for which Service options to offer. */
  sessions: SessionRow[];
}) {
  const [ministries, setMinistries] = useState<Ministry[]>(["em", "cm"]);
  const [types, setTypes] = useState<Type[]>(ALL_TYPES);
  const serviceOptions = typeOptions(sessions);
  return <FilterContext.Provider value={{ ministries, setMinistries, types, setTypes, showMinistry, serviceOptions }}>{children}</FilterContext.Provider>;
}

/** Turn one option on or off, keeping at least one of the offered ones on in its group. */
function toggle<T>(value: T[], v: T, offered: T[] = value): T[] {
  const onOffered = value.filter((x) => offered.includes(x)).length;
  return value.includes(v) ? (onOffered > 1 ? value.filter((x) => x !== v) : value) : [...value, v];
}

/** Phones only, on the roster editor: the shared filters' dropdown, at the left of the header's button row. */
export function MobileRosterFilter() {
  const f = useContext(FilterContext);
  if (!f) return null;
  // mr-auto: the filter sits at the left of the header's button row, the buttons stay right-aligned.
  return <FilterDropdown {...f} className="mr-auto sm:hidden" />;
}

/** Phones only: the Ministry and Service filters as one dropdown of checkboxes, the same size as the header buttons. */
function FilterDropdown({ className, showMinistry = true, ...f }: Filters & { className: string }) {
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
  const off =
    (showMinistry ? MINISTRY_OPTIONS.length - f.ministries.length : 0) + f.serviceOptions.filter((o) => !f.types.includes(o.value)).length;
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
            onChange={() => set(toggle(value, o.value, options.map((x) => x.value)))}
            className="size-4 accent-ink"
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
  return (
    <div ref={ref} className={`relative ${className}`} data-keep-highlight>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        aria-label={off ? "Filters: some sessions hidden" : "Filters: all sessions"}
        // Looks like the shared FilterMenu button (which only does one choice per group).
        className="flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
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
          {showMinistry && group("Ministry", MINISTRY_OPTIONS, f.ministries, f.setMinistries)}
          {group("Service", f.serviceOptions, f.types, f.setTypes)}
        </div>
      )}
    </div>
  );
}

/** The roster table with EM/CM and Sunday/P&P/ad-hoc filters (any combination; at least one of each). */
export function FilteredRosterTable({
  sessions,
  assignments: saved,
  peopleFilter,
  meId,
  edit,
  serveStatus,
  thisWeekOf,
  locked,
  toolbarEnd,
  splitsMinistry = true,
  teamConfig,
}: {
  /** The team's config, for the session settings dialog (a media team: its crew, not the band). */
  teamConfig?: TeamConfig;
  sessions: SessionRow[];
  assignments: AssignmentRow[];
  /** Whether the team splits EM and CM (its config); a media team doesn't: no Ministry filter or EM/CM column. */
  splitsMinistry?: boolean;
  /** This quarter's roster only: "sessionId|memberId" -> whether they've confirmed. */
  serveStatus?: Record<string, "pending" | "accepted" | "declined">;
  /** Mark out the week containing this day ("YYYY-MM-DD"), e.g. today on this quarter's roster. */
  thisWeekOf?: string;
  /** With `edit`: keep the edit highlights but don't open cells (editing a published roster before the pencil is pressed). */
  locked?: boolean;
  /** Shown at the right end of the filter row (e.g. the edited / published toggle). */
  toolbarEnd?: React.ReactNode;
  /** Root and developers: a People filter, to see only the sessions the people ticked are serving at. */
  peopleFilter?: boolean;
  /** Everyone else: the viewer, whose date and part cells get an orange box. */
  meId?: string;
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
  const [ownTypes, setOwnTypes] = useState<Type[]>(ALL_TYPES);
  // Only this roster's kinds of session, then Ad-hoc (Youth: Saturday service and Ad-hoc).
  const serviceOptions = typeOptions(sessions);
  const { ministries, setMinistries, types, setTypes } = shared ?? {
    ministries: ownMinistries,
    setMinistries: setOwnMinistries,
    types: ownTypes,
    setTypes: setOwnTypes,
  };
  const hl = useHighlight();
  // A cell edit shows in the table as soon as it's saved; the roster is then re-checked and the page
  // re-rendered in the background (refreshAfterEdit), which brings the server's version back.
  const [assignments, showEdit] = useOptimistic(saved, (rows: AssignmentRow[], e: CellEdit) => applyCellEdit(rows, e, edit?.people ?? []));
  const [checking, startCheck] = useTransition();
  const [checkError, setCheckError] = useState<string | null>(null);
  const onSaved = (e: CellEdit) => {
    if (!edit) return;
    setCheckError(null);
    startCheck(async () => {
      showEdit(e);
      const r = await refreshAfterEdit(edit.rosterId);
      if (!r.ok) setCheckError(r.message);
    });
  };
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
  const [picked, setPicked] = useState<string[]>([]);
  // The box around the viewer's own cells, on unless they've turned it off in this browser.
  const showMine = useSyncExternalStore(subscribeMine, readMine, () => true);
  const toggleMine = (v: boolean) => {
    try {
      localStorage.setItem(MINE_KEY, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    mineListeners.forEach((l) => l());
  };
  const hasMine = Boolean(meId) && assignments.some((a) => a.member_id === meId);
  // Everyone on this roster, for the People filter.
  const people = [...new Map(assignments.map((a) => [a.member_id, { id: a.member_id, name: a.name }])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  // Sessions with any of the ticked people on them (only while the filter is shown).
  const withPicked =
    peopleFilter && picked.length ? new Set(assignments.filter((a) => picked.includes(a.member_id)).map((a) => a.session_id)) : null;
  const shown = sessions.filter(
    (s) => (s.ministry === "any" || ministries.includes(s.ministry)) && types.includes(typeOf(s)) && (!withPicked || withPicked.has(s.id)),
  );
  const ids = new Set(shown.map((s) => s.id));
  const active = shown.filter((s) => !s.cancelled).length;
  // No EM or CM sessions (e.g. Youth), or a team without the split (media): no Ministry filter or EM/CM column.
  const showMinistry = splitsMinistry && usesMinistry(sessions);

  return (
    // Clicks inside the roster keep a rule highlight; clicks elsewhere clear it.
    <div className="space-y-3" data-keep-highlight>
      {/* Phones: one line (8px apart); the session count gives way when it doesn't fit. */}
      <div className="flex items-center gap-x-2 gap-y-2 sm:flex-wrap sm:gap-x-5">
        {/* Phones: one Ministry + Service dropdown instead of the chips (the roster editor has it in its header). */}
        {!shared && <FilterDropdown ministries={ministries} setMinistries={setMinistries} types={types} setTypes={setTypes} serviceOptions={serviceOptions} showMinistry={showMinistry} className="shrink-0 sm:hidden" />}
        {showMinistry && <Chips label="Ministry" options={MINISTRY_OPTIONS} value={ministries} onChange={setMinistries} phonesHidden />}
        <Chips label="Service" options={serviceOptions} value={types} onChange={setTypes} phonesHidden />
        {peopleFilter && <PeopleFilter people={people} value={picked} onChange={setPicked} />}
        {/* Phones: a 0-wide first item keeps line one, so a count too wide for the space left drops to a
            second line that's clipped away. From 640px the row wraps as usual and the count always shows. */}
        <div className="flex h-10 min-w-0 flex-1 flex-wrap items-center overflow-hidden sm:h-auto sm:flex-none sm:overflow-visible">
          <span aria-hidden className="h-10 w-0 sm:hidden" />
          <span className="whitespace-nowrap text-xs text-muted">
            {active} sessions{checking && <span role="status"> · checking…</span>}
          </span>
        </div>
        {/* Right end of the row: the eye (only when the viewer is on this roster; every width), then e.g. the edited / published toggle. */}
        {(hasMine || toolbarEnd) && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {hasMine && <MineToggle on={showMine} onChange={toggleMine} />}
            {toolbarEnd}
          </div>
        )}
      </div>
      {checkError && (
        <p role="status" className="text-sm text-danger">
          {checkError}
        </p>
      )}
      {active === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">No sessions match these filters.</p>
      ) : (
        <RosterTable
          sessions={shown}
          showMinistry={showMinistry}
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
          meId={showMine ? meId : undefined}
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
                onSaved={onSaved}
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
                teamConfig={teamConfig}
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
