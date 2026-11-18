"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "@/lib/roster";
import type { CrewRecord } from "@/lib/tracking-data";
import { deleteCrewRecords } from "@/app/(app)/sessions/tracking/actions";
import { BinIcon, CheckList, Chevron, ConfirmDelete } from "@/components/tracking/tracking-view";

/**
 * A media lead's Tracking (Services › Tracking): who served at each session that has happened, by
 * role. Table only, with the worship team's Tracking's Filters (crew member, service, dates),
 * search, Columns menu, and ticking rows to delete them from tracking.
 */

type Filters = { people: string[]; services: string[]; from: string; to: string };
const NO_FILTERS: Filters = { people: [], services: [], from: "", to: "" };

const sorted = (xs: Iterable<string>) => [...new Set([...xs].map((x) => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const peopleOf = (r: CrewRecord) => Object.values(r.crew).flat();
const norm = (s: string) => s.trim().toLowerCase();

function matches(r: CrewRecord, f: Filters, q: string, roleLabel: (role: string) => string): boolean {
  if (f.from && r.date < f.from) return false;
  if (f.to && r.date > f.to) return false;
  if (f.people.length) {
    const want = new Set(f.people.map(norm));
    if (!peopleOf(r).some((p) => want.has(norm(p)))) return false;
  }
  if (f.services.length && !f.services.includes(r.service)) return false;
  if (q) {
    const hay = [
      r.date,
      formatDate(r.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" }),
      r.service,
      ...Object.entries(r.crew).flatMap(([role, names]) => [roleLabel(role), ...names]),
      r.cancelReason ?? "",
    ]
      .join("\n")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Close a dropdown on a click outside it or Escape. */
function useDismiss(open: boolean, setOpen: (o: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open, setOpen]);
  return ref;
}

const toolbarButton = (active: boolean) =>
  `flex h-10 items-center gap-2 rounded-lg border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${active ? "border-accent/60" : "border-border"}`;

/** One "Filters" dropdown: crew member, service and dates (as the worship team's). */
function FilterDropdown({ records, filters, setFilters }: { records: CrewRecord[]; filters: Filters; setFilters: (f: Filters) => void }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const ref = useDismiss(open, setOpen);
  const options = useMemo(() => ({ people: sorted(records.flatMap(peopleOf)), services: sorted(records.map((r) => r.service)) }), [records]);
  const dateText = filters.from || filters.to ? `${filters.from ? formatDate(filters.from) : "…"} – ${filters.to ? formatDate(filters.to) : "…"}` : "Any";
  const sections = [
    {
      id: "people",
      label: "Crew member",
      summary: filters.people.length ? `${filters.people.length} picked` : "Any",
      body: <CheckList label="Crew members" options={options.people} value={filters.people} onChange={(people) => setFilters({ ...filters, people })} />,
    },
    {
      id: "service",
      label: "Service",
      summary: filters.services.length ? `${filters.services.length} picked` : "Any",
      body: <CheckList label="Services" options={options.services} value={filters.services} onChange={(services) => setFilters({ ...filters, services })} />,
    },
    {
      id: "dates",
      label: "Date range",
      summary: dateText,
      body: (
        <div className="grid grid-cols-2 gap-2 px-3 py-2">
          <label className="space-y-1">
            <span className="text-xs text-muted">From</span>
            <input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="h-8 w-full rounded-md border border-border bg-surface px-1.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted">To</span>
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="h-8 w-full rounded-md border border-border bg-surface px-1.5 text-sm"
            />
          </label>
        </div>
      ),
    },
  ];
  const count = filters.people.length + filters.services.length + (filters.from || filters.to ? 1 : 0);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={count ? `Filters (${count})` : "Filters"}
        onClick={() => {
          setOpen(!open);
          setSection(null);
        }}
        className={toolbarButton(count > 0)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="text-muted">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        <span className="hidden sm:inline">Filters</span>
        {count > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-5 text-white">{count}</span>}
        <Chevron open={open} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
          {sections.map((s) => {
            const expanded = section === s.id;
            return (
              <div key={s.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setSection(expanded ? null : s.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-background"
                >
                  <span className="font-medium">{s.label}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-muted">
                    <span className="truncate">{s.summary}</span>
                    <Chevron dir="right" open={expanded} />
                  </span>
                </button>
                {expanded && <div className="border-y border-border bg-background/60">{s.body}</div>}
              </div>
            );
          })}
          {count > 0 && (
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="w-full border-t border-border px-3 py-2.5 text-left text-sm text-muted hover:bg-background hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const COLS_KEY = "crew-tracking-hidden-columns";

/** Which columns are hidden (Service and the roles; Date always shows), remembered on this device. */
function useHiddenColumns(all: string[]) {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_KEY) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after hydration
      if (Array.isArray(saved)) setHidden(saved.filter((k): k is string => typeof k === "string"));
    } catch {}
  }, []);
  const update = (next: string[]) => {
    setHidden(next);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(next));
    } catch {}
  };
  return [hidden.filter((k) => all.includes(k)), update] as const;
}

/** The Columns dropdown: Service, then a "Crew" group with each role. */
function ColumnPicker({ roles, hidden, setHidden }: { roles: { key: string; label: string }[]; hidden: string[]; setHidden: (h: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const groups = [
    { label: "Session", cols: [{ key: "service", label: "Service" }] },
    { label: "Crew", cols: roles },
  ];
  const total = 1 + roles.length;
  const shown = total - hidden.length;
  // Hang from the button's right edge, unless that runs off the left of the screen.
  const [fromLeft, setFromLeft] = useState(false);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const menu = ref.current.querySelector<HTMLElement>("[data-columns-menu]");
    setFromLeft(ref.current.getBoundingClientRect().right - (menu?.offsetWidth ?? 240) < 16);
  }, [open, ref]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={hidden.length ? `Columns (${shown} of ${total} shown)` : "Columns"}
        onClick={() => setOpen(!open)}
        className={toolbarButton(hidden.length > 0)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="text-muted">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        <span className="hidden sm:inline">Columns</span>
        {hidden.length > 0 && (
          <span className="hidden text-xs text-muted sm:inline">
            {shown}/{total}
          </span>
        )}
        <Chevron open={open} />
      </button>
      {open && (
        <div
          data-columns-menu
          className={`absolute ${fromLeft ? "left-0" : "right-0"} top-full z-30 mt-1.5 max-h-[70vh] w-60 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg`}
        >
          {groups.map((g) => {
            const keys = g.cols.map((c) => c.key);
            const allOn = keys.every((k) => !hidden.includes(k));
            return (
              <div key={g.label} className="border-b border-border py-1 last:border-b-0">
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted hover:bg-background">
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = !allOn && keys.some((k) => !hidden.includes(k));
                    }}
                    onChange={() => setHidden(allOn ? [...new Set([...hidden, ...keys])] : hidden.filter((k) => !keys.includes(k)))}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  {g.label}
                </label>
                {g.cols.length > 1 &&
                  g.cols.map((c) => {
                    const on = !hidden.includes(c.key);
                    return (
                      <label key={c.key} className="flex cursor-pointer items-center gap-2 py-1.5 pl-8 pr-3 text-sm hover:bg-background">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setHidden(on ? [...hidden, c.key] : hidden.filter((k) => k !== c.key))}
                          className="h-4 w-4 accent-[var(--color-accent)]"
                        />
                        {c.label}
                      </label>
                    );
                  })}
              </div>
            );
          })}
          {hidden.length > 0 && (
            <button type="button" onClick={() => setHidden([])} className="w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-background hover:text-foreground">
              Show all columns
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Same cells as the worship team's Tracking table.
const th = "whitespace-nowrap border-b border-border bg-background px-3 py-2 text-left text-xs font-semibold";
const td = "whitespace-nowrap border-b border-border px-3 py-1.5 align-top";
const tick = "w-10 min-w-10 max-w-10";
const box = "h-4 w-4 cursor-pointer align-middle accent-[var(--color-accent)]";
/** "No session" rows come from roster setup: they aren't ticked or deleted. */
const deletable = (r: CrewRecord) => r.cancelReason === undefined;

export function CrewTrackingView({ records, roles }: { records: CrewRecord[]; roles: { key: string; label: string }[] }) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  const allCols = useMemo(() => ["service", ...roles.map((r) => r.key)], [roles]);
  const [hidden, setHidden] = useHiddenColumns(allCols);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<string[] | null>(null);

  const roleLabel = useMemo(() => {
    const labels = new Map(roles.map((r) => [r.key, r.label]));
    return (k: string) => labels.get(k) ?? k;
  }, [roles]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => records.filter((r) => matches(r, filters, q, roleLabel)), [records, filters, q, roleLabel]);
  const tickable = shown.filter(deletable);
  // Only ticked rows still showing count (a filter or search can hide ticked rows).
  const ticked = tickable.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allTicked = tickable.length > 0 && ticked.length === tickable.length;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const showService = !hidden.includes("service");
  const cols = roles.filter((r) => !hidden.includes(r.key));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Tracking</h1>
          <p className="text-sm text-muted">Sessions that have happened: who served and on what role.</p>
        </div>
        {ticked.length > 0 && (
          <button
            type="button"
            onClick={() => setToDelete(ticked)}
            aria-label={`Delete ${ticked.length} ticked session${ticked.length === 1 ? "" : "s"}`}
            title={`Delete ${ticked.length} session${ticked.length === 1 ? "" : "s"}`}
            className="grid h-10 w-10 place-items-center rounded-lg border border-red-300 text-danger hover:bg-red-50"
          >
            <BinIcon size={18} />
          </button>
        )}
      </div>
      {toDelete && (
        <ConfirmDelete
          ids={toDelete}
          remove={deleteCrewRecords}
          note="They're taken out of tracking for good. The roster keeps them as they are."
          onClose={() => setToDelete(null)}
          onDeleted={(ids) => {
            const next = new Set(selected);
            for (const id of ids) next.delete(id);
            setSelected(next);
          }}
        />
      )}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown records={records} filters={filters} setFilters={setFilters} />
          <div className="relative min-w-0 flex-1 sm:min-w-48">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people, roles, services…"
              aria-label="Search sessions"
              className="h-10 w-full rounded-lg border border-border bg-surface pl-3 pr-11 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <span aria-hidden className="pointer-events-none absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-muted">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </span>
          </div>
          <ColumnPicker roles={roles} hidden={hidden} setHidden={setHidden} />
        </div>
        <p className="text-xs text-muted">{shown.length === records.length ? `${records.length} sessions` : `${shown.length} of ${records.length} sessions`}</p>

        {records.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">No sessions have happened yet on a published roster.</p>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">No sessions match.</p>
        ) : (
          // The white is on the table, not the box, so the scrollbars' strip shows the page behind it.
          <div className="mb-10 overflow-hidden rounded-xl border border-border">
            <div className="scroll-quiet max-h-[65vh] overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 bg-surface text-xs">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={`${th} ${tick} sticky left-0 z-10`}>
                      <input
                        type="checkbox"
                        aria-label={allTicked ? "Untick all sessions" : "Tick all sessions"}
                        checked={allTicked}
                        disabled={!tickable.length}
                        ref={(el) => {
                          if (el) el.indeterminate = ticked.length > 0 && !allTicked;
                        }}
                        onChange={() => setSelected(allTicked ? new Set() : new Set(tickable.map((r) => r.id)))}
                        className={box}
                      />
                    </th>
                    <th className={`${th} sticky left-10 z-10`}>Date</th>
                    {showService && <th className={th}>Service</th>}
                    {cols.map((c) => (
                      <th key={c.key} className={th}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const isTicked = selected.has(r.id);
                    return (
                      <tr key={r.id} className={isTicked ? "bg-accent/5" : "hover:bg-background/60"}>
                        <td className={`${td} ${tick} sticky left-0 bg-surface`}>
                          {deletable(r) && (
                            <input
                              type="checkbox"
                              aria-label={`Tick ${r.service} on ${formatDate(r.date)}`}
                              checked={isTicked}
                              onChange={() => toggle(r.id)}
                              className={box}
                            />
                          )}
                        </td>
                        <td className={`${td} sticky left-10 bg-surface font-medium`}>{formatDate(r.date, { day: "numeric", month: "short", year: "numeric" })}</td>
                        {showService && <td className={td}>{r.service}</td>}
                        {r.cancelReason !== undefined ? (
                          // Didn't happen: the reason across the role columns.
                          cols.length > 0 && (
                            <td colSpan={cols.length} className={td}>
                              <span className="font-semibold">{r.cancelReason}</span>
                            </td>
                          )
                        ) : (
                          cols.map((c) => (
                            <td key={c.key} className={td}>
                              {r.crew[c.key]?.length ? r.crew[c.key].join(", ") : <span className="text-muted">-</span>}
                            </td>
                          ))
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* The row count, under the table (outside the scrolling, so it's always in view). */}
            <p className="border-t border-border bg-background px-3 py-2 text-right text-xs text-muted">
              {shown.length === records.length ? `${shown.length} row${shown.length === 1 ? "" : "s"}` : `${shown.length} of ${records.length} rows`}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
