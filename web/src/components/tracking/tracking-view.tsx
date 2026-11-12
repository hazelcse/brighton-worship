"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatDate, todayYmd } from "@/lib/roster";
import { downloadTrackingCsv } from "@/lib/tracking-csv";
import { BAND_COLUMNS, MAX_SONGS, MINISTRY_TEXT, linkLabel, serviceType, songSlots, type BandKey, type SessionRecord } from "@/lib/tracking";
import { deleteRecords, updateRecord } from "@/app/(app)/sessions/tracking/actions";
import { RecordForm } from "@/components/tracking/record-form";
import { QUERY_COLUMNS, parseQuery, runQuery } from "@/lib/tracking-query";
import type { BankSong } from "@/components/sessions/song-bank-panel";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type Filters = {
  artists: string[];
  musicians: string[];
  ministries: string[];
  services: string[];
  from: string;
  to: string;
};
const NO_FILTERS: Filters = {
  artists: [],
  musicians: [],
  ministries: [],
  services: [],
  from: "",
  to: "",
};

const norm = (s: string) => s.trim().toLowerCase();
const sorted = (xs: Iterable<string>) => [...new Set([...xs].map((x) => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const musiciansOf = (r: SessionRecord) => BAND_COLUMNS.flatMap((c) => r.band[c.key] ?? []);

function matches(r: SessionRecord, f: Filters, q: string): boolean {
  if (f.from && r.date < f.from) return false;
  if (f.to && r.date > f.to) return false;
  if (f.artists.length) {
    const want = new Set(f.artists.map(norm));
    if (!r.songs.some((s) => want.has(norm(s.artist)))) return false;
  }
  if (f.musicians.length) {
    const want = new Set(f.musicians.map(norm));
    if (!musiciansOf(r).some((m) => want.has(norm(m)))) return false;
  }
  // A session for both ministries counts as EM and as CM.
  if (f.ministries.length && r.ministry !== "any" && !f.ministries.includes(r.ministry)) return false;
  if (f.services.length && !f.services.includes(serviceType(r.kind, r.serviceName))) return false;
  if (q) {
    const hay = [
      r.date,
      formatDate(r.date, {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      r.serviceName,
      MINISTRY_TEXT[r.ministry],
      ...musiciansOf(r),
      ...r.songs.flatMap((s) => [s.title, s.artist, s.key, s.lead]),
      ...r.links,
      r.comments,
      r.cancelReason ?? "",
    ]
      .join("\n")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function Chevron({ open, dir = "down" }: { open?: boolean; dir?: "down" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 transition ${dir === "right" ? (open ? "rotate-90" : "") : open ? "rotate-180" : ""}`}
    >
      {dir === "right" ? <path d="m9 6 6 6-6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

/** One section of the filter menu: a list of checkboxes (with a search box when it's long). */
function CheckList({ options, value, onChange, label }: { options: string[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  const [find, setFind] = useState("");
  const shown = find ? options.filter((o) => o.toLowerCase().includes(find.toLowerCase())) : options;
  if (!options.length) return <p className="px-6 py-2 text-sm text-muted">Nothing to choose yet.</p>;
  return (
    <div className="py-1">
      {options.length > 8 && (
        <div className="px-3 pb-1 pt-1">
          <input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder={`Find ${label.toLowerCase()}…`}
            aria-label={`Find ${label.toLowerCase()}`}
            className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-accent"
          />
        </div>
      )}
      <div className="max-h-56 overflow-y-auto">
        {shown.map((o) => {
          const on = value.includes(o);
          return (
            <label key={o} className="flex cursor-pointer items-center gap-2 py-1.5 pl-6 pr-3 text-sm hover:bg-background">
              <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])} className="h-4 w-4 accent-[var(--color-accent)]" />
              <span className="truncate">{o}</span>
            </label>
          );
        })}
        {!shown.length && <p className="px-6 py-1.5 text-sm text-muted">No matches.</p>}
      </div>
    </div>
  );
}

/** One "Filters" dropdown with every filter in it: artist, musician, EM/CM, service and dates. */
function FilterDropdown({ records, filters, setFilters }: { records: SessionRecord[]; filters: Filters; setFilters: (f: Filters) => void }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<string | null>(null);
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
  }, [open]);

  const options = useMemo(
    () => ({
      artists: sorted(records.flatMap((r) => r.songs.map((s) => s.artist))),
      musicians: sorted(records.flatMap(musiciansOf)),
      services: sorted(records.map((r) => serviceType(r.kind, r.serviceName))),
    }),
    [records],
  );

  const dateText = filters.from || filters.to ? `${filters.from ? formatDate(filters.from) : "…"} – ${filters.to ? formatDate(filters.to) : "…"}` : "Any";
  const sections: {
    id: string;
    label: string;
    summary: string;
    body: React.ReactNode;
  }[] = [
    {
      id: "artist",
      label: "Artist",
      summary: filters.artists.length ? `${filters.artists.length} picked` : "Any",
      body: <CheckList label="Artists" options={options.artists} value={filters.artists} onChange={(artists) => setFilters({ ...filters, artists })} />,
    },
    {
      id: "musician",
      label: "Musician",
      summary: filters.musicians.length ? `${filters.musicians.length} picked` : "Any",
      body: <CheckList label="Musicians" options={options.musicians} value={filters.musicians} onChange={(musicians) => setFilters({ ...filters, musicians })} />,
    },
    {
      id: "ministry",
      label: "EM / CM",
      summary: filters.ministries.length ? filters.ministries.map((m) => m.toUpperCase()).join(", ") : "Both",
      body: (
        <div className="py-1">
          {(["em", "cm"] as const).map((m) => {
            const on = filters.ministries.includes(m);
            return (
              <label key={m} className="flex cursor-pointer items-center gap-2 py-1.5 pl-6 pr-3 text-sm hover:bg-background">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setFilters({
                      ...filters,
                      ministries: on ? filters.ministries.filter((x) => x !== m) : [...filters.ministries, m],
                    })
                  }
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                {MINISTRY_TEXT[m]}
              </label>
            );
          })}
        </div>
      ),
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

  const count = filters.artists.length + filters.musicians.length + filters.ministries.length + filters.services.length + (filters.from || filters.to ? 1 : 0);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setSection(null);
        }}
        className={`flex h-10 items-center gap-2 rounded-lg border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
          count ? "border-accent/60" : "border-border"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="text-muted">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        Filters
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

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------

const th = "whitespace-nowrap border-b border-border bg-background px-3 py-2 text-left text-xs font-semibold";
const td = "whitespace-nowrap border-b border-border px-3 py-1.5 align-top";
/** The checkbox column: 40px, so the sticky Date column sits right after it (`left-10`). */
const tick = "w-10 min-w-10 max-w-10";

/** Columns root can show or hide (Date always shows). Song fields apply to all five songs. */
const SONG_FIELDS = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "key", label: "Key" },
  { key: "lead", label: "Lead Vox" },
] as const;
type SongField = (typeof SONG_FIELDS)[number]["key"];
type ColKey = "service" | (typeof BAND_COLUMNS)[number]["key"] | SongField | "link1" | "link2";

const COLUMN_GROUPS: {
  label: string;
  cols: { key: ColKey; label: string }[];
}[] = [
  { label: "Session", cols: [{ key: "service", label: "Service" }] },
  {
    label: "Band",
    cols: BAND_COLUMNS.map((c) => ({ key: c.key, label: c.label })),
  },
  {
    label: "Songs 1–5",
    cols: SONG_FIELDS.map((f) => ({ key: f.key, label: f.label })),
  },
  {
    label: "Links",
    cols: [
      { key: "link1", label: "Link 1" },
      { key: "link2", label: "Link 2" },
    ],
  },
];
const ALL_COLS = COLUMN_GROUPS.flatMap((g) => g.cols.map((c) => c.key));
const COLS_KEY = "tracking-hidden-columns";

/** Which table columns are hidden, remembered on this device. */
function useHiddenColumns() {
  const [hidden, setHidden] = useState<ColKey[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_KEY) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after hydration
      if (Array.isArray(saved)) setHidden(saved.filter((k): k is ColKey => ALL_COLS.includes(k)));
    } catch {}
  }, []);
  const update = (next: ColKey[]) => {
    setHidden(next);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(next));
    } catch {}
  };
  return [hidden, update] as const;
}

/** A dropdown of checkboxes choosing which table columns show. */
function ColumnPicker({ hidden, setHidden }: { hidden: ColKey[]; setHidden: (h: ColKey[]) => void }) {
  const [open, setOpen] = useState(false);
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
  }, [open]);
  const shown = ALL_COLS.length - hidden.length;
  // The menu hangs from the button's right edge, unless that would push it off the left of the
  // screen (on phones the button wraps to the start of a row): then it hangs from the left edge.
  const [fromLeft, setFromLeft] = useState(false);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const menu = ref.current.querySelector<HTMLElement>("[data-columns-menu]");
    const right = ref.current.getBoundingClientRect().right;
    setFromLeft(right - (menu?.offsetWidth ?? 240) < 16);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-2 rounded-lg border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
          hidden.length ? "border-accent/60" : "border-border"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="text-muted">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        Columns
        {hidden.length > 0 && (
          <span className="text-xs text-muted">
            {shown}/{ALL_COLS.length}
          </span>
        )}
        <Chevron open={open} />
      </button>
      {open && (
        <div data-columns-menu className={`absolute ${fromLeft ? "left-0" : "right-0"} top-full z-30 mt-1.5 max-h-[70vh] w-60 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg`}>
          {COLUMN_GROUPS.map((g) => {
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

/** Band columns that show only the first names until opened, so they don't make the table wide. */
const SHORTENED = new Set<BandKey>(["wl", "vox"]);
const SHOWN_NAMES = 2;

/** Sessions root can delete: confirmed ones, not "no session" rows (those come from roster setup). */
const deletable = (r: SessionRecord) => r.cancelReason === undefined;

/**
 * `total`: sessions before filtering, for the row count. `selected`: ticked rows (checkbox column
 * on the left, like an inbox); the header box ticks or clears every deletable row shown.
 */
function TableView({
  records,
  total,
  hidden,
  selected,
  setSelected,
}: {
  records: SessionRecord[];
  total: number;
  hidden: ColKey[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
}) {
  const on = (k: ColKey) => !hidden.includes(k);
  const tickable = records.filter(deletable);
  const ticked = tickable.filter((r) => selected.has(r.id)).length;
  const allTicked = tickable.length > 0 && ticked === tickable.length;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const band = BAND_COLUMNS.filter((c) => on(c.key));
  // WL and Vox columns opened to show every name (clicking a cell opens or closes its column).
  const [opened, setOpened] = useState<BandKey[]>([]);
  const toggleColumn = (k: BandKey) => setOpened((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));
  const fields = SONG_FIELDS.filter((f) => on(f.key));
  const links = (["link1", "link2"] as const).map((k, i) => ({ k, i })).filter(({ k }) => on(k));
  // A light divider where each song starts and where the links start.
  const first = (i: number) => (i === 0 ? "border-l" : "");

  return (
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
                  if (el) el.indeterminate = ticked > 0 && !allTicked;
                }}
                onChange={() => setSelected(allTicked ? new Set() : new Set(tickable.map((r) => r.id)))}
                className="h-4 w-4 cursor-pointer align-middle accent-[var(--color-accent)]"
              />
            </th>
            <th className={`${th} sticky left-10 z-10`}>Date</th>
            {on("service") && <th className={th}>Service</th>}
            {band.map((c) => (
              <th key={c.key} className={th}>
                {c.label}
              </th>
            ))}
            {Array.from({ length: MAX_SONGS }, (_, i) =>
              fields.map((f, j) => (
                <th key={`${i}-${f.key}`} className={`${th} ${first(j)}`}>
                  Song {i + 1} {f.label}
                </th>
              )),
            )}
            {links.map(({ k, i }, j) => (
              <th key={k} className={`${th} ${first(j)}`}>
                Link {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            // Sunday services: main set in Songs 1–4, closing song in Song 5.
            const slots = songSlots(r.songs);
            const isTicked = selected.has(r.id);
            return (
              <tr key={r.id} className={isTicked ? "bg-accent/5" : "hover:bg-background/60"}>
                <td className={`${td} ${tick} sticky left-0 bg-surface`}>
                  {deletable(r) && (
                    <input
                      type="checkbox"
                      aria-label={`Tick ${r.serviceName} on ${formatDate(r.date)}`}
                      checked={isTicked}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 cursor-pointer align-middle accent-[var(--color-accent)]"
                    />
                  )}
                </td>
                <td className={`${td} sticky left-10 bg-surface font-medium`}>
                  {formatDate(r.date, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
                {on("service") && <td className={td}>{r.serviceName}</td>}
                {r.cancelReason !== undefined ? (
                  // Didn't happen: the reason from roster setup across the band, song and link columns.
                  band.length + MAX_SONGS * fields.length + links.length > 0 && (
                    <td colSpan={band.length + MAX_SONGS * fields.length + links.length} className={`${td} text-muted`}>
                      <span className="font-semibold text-foreground">{r.cancelReason}</span>
                    </td>
                  )
                ) : (
                <>
                {band.map((c) => {
                  const people = r.band[c.key] ?? [];
                  if (!people.length)
                    return (
                      <td key={c.key} className={td}>
                        <span className="text-muted">-</span>
                      </td>
                    );
                  // WL and Vox: two names then "…" until the column is opened.
                  const cut = !opened.includes(c.key);
                  if (!SHORTENED.has(c.key) || people.length <= SHOWN_NAMES)
                    return (
                      <td key={c.key} className={td}>
                        {people.join(", ")}
                      </td>
                    );
                  return (
                    <td key={c.key} className={td}>
                      <button
                        type="button"
                        onClick={() => toggleColumn(c.key)}
                        title={cut ? people.join(", ") : undefined}
                        aria-expanded={!cut}
                        className="w-full cursor-pointer text-left hover:text-accent"
                      >
                        {cut ? `${people.slice(0, SHOWN_NAMES).join(", ")}, …` : people.join(", ")}
                      </button>
                    </td>
                  );
                })}
                {Array.from({ length: MAX_SONGS }, (_, i) =>
                  fields.map((f, j) => {
                    const v = slots[i]?.[f.key] ?? "";
                    const wide = f.key === "title" ? "max-w-56 truncate" : f.key === "artist" ? "max-w-44 truncate" : "";
                    return (
                      <td key={`${i}-${f.key}`} className={`${td} ${wide} ${first(j)}`} title={wide && v ? v : undefined}>
                        {v}
                      </td>
                    );
                  }),
                )}
                {links.map(({ k, i }, j) => (
                  <td key={k} className={`${td} ${first(j)}`}>
                    {r.links[i] && (
                      <a href={r.links[i]} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {linkLabel(r.links[i])}
                      </a>
                    )}
                  </td>
                ))}
                </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {/* The row count, under the table (outside the scrolling, so it's always in view). */}
      <p className="border-t border-border bg-background px-3 py-2 text-right text-xs text-muted">
        {records.length === total ? `${records.length} row${records.length === 1 ? "" : "s"}` : `${records.length} of ${total} rows`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function BinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

/** "Are you sure you want to delete 3 sessions?" with Cancel / Delete. */
function ConfirmDelete({ ids, onClose, onDeleted }: { ids: string[]; onClose: () => void; onDeleted: (ids: string[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const n = ids.length;
  return (
    <dialog
      ref={ref}
      aria-labelledby="delete-sessions-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && !pending && ref.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <div className="space-y-4 p-5">
        <h2 id="delete-sessions-title" className="text-base font-semibold">
          Are you sure you want to delete {n} session{n === 1 ? "" : "s"}?
        </h2>
        <p className="text-sm text-muted">They&apos;re removed from tracking. Sessions from a roster go back to Pending.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => ref.current?.close()}
            className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-background disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteRecords(ids);
                if (!res.ok) return setError(res.message);
                onDeleted(ids);
                ref.current?.close();
              })
            }
            className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** A session's details: band, songs, links and comments. */
export function RecordDetails({ r }: { r: Pick<SessionRecord, "band" | "songs" | "links" | "comments"> }) {
  const band = BAND_COLUMNS.filter((c) => r.band[c.key]?.length);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Band</h3>
        {band.length ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {band.map((c) => (
              <div key={c.key} className="contents">
                <dt className="text-muted">{c.long}</dt>
                <dd>{r.band[c.key]!.join(", ")}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">No band recorded.</p>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Songs</h3>
        {r.songs.length ? (
          <ol className="space-y-1.5 text-sm">
            {songSlots(r.songs).map((s, i) =>
              !s ? null : (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="w-4 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{s.title}</span>
                    {s.closing && <span className="ml-1.5 rounded-full bg-accent/10 px-1.5 text-[11px] font-medium text-accent">Closing</span>}
                    {s.artist && <span className="text-muted"> · {s.artist}</span>}
                    {s.lead && <span className="block text-xs text-muted">Lead: {s.lead}</span>}
                  </span>
                  {s.key && <span className="shrink-0 rounded bg-background px-1.5 text-xs font-medium">{s.key}</span>}
                </li>
              ),
            )}
          </ol>
        ) : (
          <p className="text-sm text-muted">No songs recorded.</p>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Livestream</h3>
        {r.links.length ? (
          <ul className="space-y-1 text-sm">
            {r.links.map((l, i) => (
              <li key={i} className="truncate">
                <a href={l} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {l}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No links.</p>
        )}
      </section>
      {r.comments && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Comments</h3>
          <p className="whitespace-pre-wrap text-sm">{r.comments}</p>
        </section>
      )}
    </div>
  );
}

/** A session that didn't happen: why, from roster setup (changed there, not here). */
function NoSessionItem({ r }: { r: SessionRecord }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-4 py-3">
      <span aria-hidden className="w-4 shrink-0" />
      <span className="w-28 shrink-0 text-sm font-medium sm:w-36">
        {formatDate(r.date, {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </span>
      <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-semibold">{MINISTRY_TEXT[r.ministry]}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted line-through">{r.serviceName}</span>
      <span className="shrink-0 text-sm font-semibold">{r.cancelReason}</span>
    </li>
  );
}

function ListItem({ r, bank, onDelete }: { r: SessionRecord; bank: BankSong[]; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <li className={`overflow-hidden rounded-xl border bg-surface ${editing ? "border-accent/60" : "border-border"}`}>
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
            if (open) setEditing(false);
          }}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-background/60"
        >
          <Chevron dir="right" open={open} />
          <span className="w-28 shrink-0 text-sm font-medium sm:w-36">
            {formatDate(r.date, {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-semibold">{MINISTRY_TEXT[r.ministry]}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{r.serviceName}</span>
        </button>
        <button
          type="button"
          aria-label={`Edit ${r.serviceName} on ${formatDate(r.date)}`}
          aria-pressed={editing}
          onClick={() => {
            setEditing((e) => !e);
            setOpen(true);
          }}
          className="rounded-lg p-2 text-muted hover:bg-background hover:text-foreground aria-pressed:text-accent"
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          aria-label={`Delete ${r.serviceName} on ${formatDate(r.date)}`}
          title="Delete"
          onClick={onDelete}
          className="mr-2 rounded-lg p-2 text-muted hover:bg-red-50 hover:text-danger"
        >
          <BinIcon />
        </button>
      </div>
      {open && (
        <div className="border-t border-border px-4 py-4">
          {editing ? (
            <RecordForm
              kind={r.kind}
              band={r.band}
              songs={r.songs}
              links={r.links}
              comments={r.comments}
              bank={bank}
              submitLabel="Save changes"
              onSubmit={(input) => updateRecord(r.id, input)}
              onCancel={() => setEditing(false)}
              onSaved={() => setEditing(false)}
            />
          ) : (
            <RecordDetails r={r} />
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// The page body
// ---------------------------------------------------------------------------

const VIEW_KEY = "tracking-view";

/**
 * The page: header row (`heading` left; bin for ticked rows, then `add` (the +) right), toolbar,
 * then the table or list.
 */
export function TrackingView({
  records,
  bank,
  heading,
  add,
}: {
  records: SessionRecord[];
  bank: BankSong[];
  heading: React.ReactNode;
  add: React.ReactNode;
}) {
  const [view, setView] = useState<"table" | "list">("table");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  // "text": plain search across everything. "query": [WL = "Vanessa"] and ![AG = "Chong Han"]…
  const [searchMode, setSearchMode] = useState<"text" | "query">("text");
  const joinClip = useId();
  const [hidden, setHidden] = useHiddenColumns();
  // Ticked table rows, and the sessions waiting on the "Are you sure…?" popup.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<string[] | null>(null);

  // Remember the last view on this device.
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after hydration
      if (v === "list" || v === "table") setView(v);
    } catch {}
  }, []);
  const pick = (v: "table" | "list") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  const q = searchMode === "text" ? query.trim().toLowerCase() : "";
  const parsed = useMemo(() => (searchMode === "query" ? parseQuery(query) : null), [searchMode, query]);
  const shown = useMemo(
    () => records.filter((r) => matches(r, filters, q) && (!parsed?.ok || runQuery(parsed.node, r))),
    [records, filters, q, parsed],
  );
  // Only ticked rows still showing count (a filter or search can hide ticked rows).
  const ticked = view === "table" ? shown.filter((r) => deletable(r) && selected.has(r.id)).map((r) => r.id) : [];

  return (
    <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      {heading}
      <div className="flex items-center gap-2">
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
        <button
          type="button"
          onClick={() => downloadTrackingCsv(shown, todayYmd())}
          disabled={!shown.length}
          title={`Download the ${shown.length} session${shown.length === 1 ? "" : "s"} shown (after filters and search) as a CSV file`}
          className="flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-muted">
            <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
          </svg>
          Export CSV
        </button>
        {add}
      </div>
    </div>
    {toDelete && (
      <ConfirmDelete
        ids={toDelete}
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
        <div className="relative min-w-48 flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchMode === "text" ? "Search songs, people, services, comments…" : '[WL = "Vanessa"] and [Song Title = "Praise"]'}
            aria-label={searchMode === "text" ? "Search sessions" : "Query sessions"}
            aria-invalid={parsed && !parsed.ok && parsed.error ? true : undefined}
            aria-describedby={searchMode === "query" ? "tracking-query-help" : undefined}
            spellCheck={searchMode === "text"}
            autoCapitalize="off"
            autoCorrect="off"
            className={`h-10 w-full rounded-lg border bg-surface pl-3 pr-11 text-sm outline-none focus:ring-2 ${
              parsed && !parsed.ok && parsed.error ? "border-danger focus:border-danger focus:ring-danger/20" : "border-border focus:border-accent focus:ring-accent/20"
            }`}
          />
          <button
            type="button"
            onClick={() => setSearchMode((m) => (m === "text" ? "query" : "text"))}
            aria-pressed={searchMode === "query"}
            aria-label={searchMode === "text" ? "Switch to query search" : "Switch to plain search"}
            title={searchMode === "text" ? "Query search, e.g. [WL = \"Vanessa\"] and [Song Title = \"Praise\"]" : "Plain search"}
            className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {searchMode === "text" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            ) : (
              // A right join: two overlapping circles, the left one empty, the right one filled (the
              // left circle's edge runs across the fill as a light line, so both circles show).
              <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden>
                <defs>
                  <clipPath id={joinClip}>
                    <circle cx="17.5" cy="8" r="6" />
                  </clipPath>
                </defs>
                <circle cx="8.5" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="17.5" cy="8" r="6" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8.5" cy="8" r="6" fill="none" stroke="var(--color-surface)" strokeWidth="1.25" clipPath={`url(#${joinClip})`} />
              </svg>
            )}
          </button>
        </div>
        {view === "table" && <ColumnPicker hidden={hidden} setHidden={setHidden} />}
        <div role="tablist" aria-label="View" className="flex h-10 rounded-lg border border-border bg-surface p-0.5">
          {(["table", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => pick(v)}
              className="rounded-md px-3 text-sm capitalize text-muted aria-selected:bg-ink aria-selected:text-ink-foreground"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {searchMode === "query" && (
        <p id="tracking-query-help" className={`text-xs ${parsed && !parsed.ok && parsed.error ? "text-danger" : "text-muted"}`}>
          {parsed && !parsed.ok && parsed.error ? (
            parsed.error
          ) : (
            <>
              Each test in [ ], e.g. [WL = &quot;Caleb&quot;] or [Vox = &quot;Caleb&quot;]. = exact, != not, ~ contains; join with and, or,
              ! (not) and ( ). Columns: {QUERY_COLUMNS}.
            </>
          )}
        </p>
      )}
      <p className="text-xs text-muted">{shown.length === records.length ? `${records.length} sessions` : `${shown.length} of ${records.length} sessions`}</p>

      {records.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          No sessions in tracking yet. Use + to confirm sessions that have happened.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">No sessions match.</p>
      ) : view === "table" ? (
        <TableView records={shown} total={records.length} hidden={hidden} selected={selected} setSelected={setSelected} />
      ) : (
        <ul className="space-y-2">
          {shown.map((r) =>
            r.cancelReason !== undefined ? <NoSessionItem key={r.id} r={r} /> : <ListItem key={r.id} r={r} bank={bank} onDelete={() => setToDelete([r.id])} />,
          )}
        </ul>
      )}
    </div>
    </>
  );
}
