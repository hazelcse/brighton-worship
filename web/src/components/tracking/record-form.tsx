"use client";

import { useId, useState, useTransition } from "react";
import type { BankSong } from "@/components/sessions/song-bank-panel";
import { MAJOR_KEYS, majorKey } from "@/lib/session-plan";
import { BAND_COLUMNS, MAX_LINKS, MAX_MAIN_SET, MAX_SONGS, isSunday, type Band, type BandKey, type RecordInput, type TrackedSong } from "@/lib/tracking";
import type { TrackingResult } from "@/app/(app)/sessions/tracking/actions";

/** A song being edited: its key split into the first key and, for a key change, the second. */
type Row = TrackedSong & {
  uid: number;
  include: boolean;
  to: string;
  closing: boolean;
};

const input = "h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

let nextUid = 1;
const blankSong = (closing: boolean): Row => ({
  uid: nextUid++,
  title: "",
  artist: "",
  key: "",
  to: "",
  lead: "",
  include: true,
  closing,
});

/** The song lists of the form: a Sunday service has a main set and a closing song; others one list. */
type Group = {
  closing: boolean;
  label: string | null;
  max: number;
  first: number;
};
const groupsFor = (kind: string): Group[] =>
  isSunday(kind)
    ? [
        { closing: false, label: "Main set", max: MAX_MAIN_SET, first: 1 },
        {
          closing: true,
          label: "Closing song",
          max: 1,
          first: MAX_MAIN_SET + 1,
        },
      ]
    : [{ closing: false, label: null, max: MAX_SONGS, first: 1 }];

/** "F -> G" (or "F→G") into its keys; a first key that isn't one of the twelve stays as typed. */
function splitKey(raw: string): { key: string; to: string } {
  const [a = "", b = ""] = raw.split(/\s*(?:->|→)\s*/);
  return { key: majorKey(a) ?? a.trim(), to: majorKey(b) ?? "" };
}
const joinKey = (r: Row) => (r.key && r.to && r.to !== r.key ? `${r.key} -> ${r.to}` : r.key);

function KeySelect({ value, onChange, label, className }: { value: string; onChange: (k: string) => void; label: string; className: string }) {
  const known = (MAJOR_KEYS as readonly string[]).includes(value);
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">Key</option>
      {/* An old key that isn't one of the twelve stays selectable. */}
      {value && !known && <option value={value}>{value}</option>}
      {MAJOR_KEYS.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}

/** The key, and + Transpose for a song that changes key partway (F -> G), like the session builder. */
function KeyField({ row, onChange }: { row: Row; onChange: (patch: Partial<Row>) => void }) {
  const [adding, setAdding] = useState(false);
  const transposing = adding || Boolean(row.to);
  const small = "h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <div className="space-y-1">
      {transposing ? (
        <div className="flex items-center gap-1">
          <KeySelect label="From key" value={row.key} onChange={(key) => onChange({ key, ...(key === row.to ? { to: "" } : {}) })} className={small} />
          <span aria-hidden className="text-muted">
            →
          </span>
          <KeySelect label="To key" value={row.to} onChange={(to) => onChange({ to: to === row.key ? "" : to })} className={small} />
        </div>
      ) : (
        <KeySelect label="Key" value={row.key} onChange={(key) => onChange({ key })} className={input} />
      )}
      <button
        type="button"
        disabled={!row.key && !transposing}
        title={row.key ? undefined : "Choose the key first"}
        onClick={() => {
          if (transposing) {
            setAdding(false);
            onChange({ to: "" });
          } else setAdding(true);
        }}
        className="text-xs font-medium text-accent hover:underline disabled:text-muted disabled:no-underline"
      >
        {transposing ? "Remove key change" : "+ Transpose"}
      </button>
    </div>
  );
}

/** The title box doubles as a song bank search: picking a song fills in its title, artist and key. */
function SongSearch({ row, bank, onChange }: { row: Row; bank: BankSong[]; onChange: (patch: Partial<Row>) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const q = row.title.trim().toLowerCase();
  const hits = q
    ? bank
        .filter((s) => s.title.toLowerCase().includes(q) || (s.artist ?? "").toLowerCase().includes(q))
        // Titles starting with what's typed come first.
        .sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)) || a.title.localeCompare(b.title))
        .slice(0, 8)
    : [];
  const show = open && hits.length > 0;
  const pick = (s: BankSong) => {
    onChange({
      title: s.title,
      artist: s.artist ?? "",
      key: majorKey(s.key) ?? "",
      to: "",
    });
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-label="Title"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder="Title (searches the song bank)"
        value={row.title}
        onChange={(e) => {
          onChange({ title: e.target.value });
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % hits.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + hits.length) % hits.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(hits[active] ?? hits[0]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className={input}
      />
      {show && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {hits.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              // Keep focus in the box so the pick lands before blur closes the list.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
              onMouseEnter={() => setActive(i)}
              className="flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm aria-selected:bg-background"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{s.title}</span>
                {s.artist && <span className="text-muted"> · {s.artist}</span>}
              </span>
              {(s.keyDisplay ?? s.key) && <span className="shrink-0 rounded bg-background px-1.5 text-xs font-medium">{s.keyDisplay ?? s.key}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Root's form for one session in tracking: who played, which songs (at most five: for a Sunday
 * service, four from the main set and one closing song; with more, root ticks the ones to keep),
 * up to two links and a comment. Used to confirm a pending session
 * and to edit one already in tracking.
 */
export function RecordForm({
  kind,
  band,
  songs,
  links,
  comments,
  bank,
  submitLabel,
  onSubmit,
  onCancel,
  onSaved,
}: {
  /** The roster session's kind (em_sunday, ...): Sunday services get a closing song. */
  kind: string;
  band: Band;
  songs: TrackedSong[];
  links: string[];
  comments: string;
  /** The song library, searched from each song's title box. */
  bank: BankSong[];
  submitLabel: string;
  onSubmit: (input: RecordInput) => Promise<TrackingResult>;
  onCancel?: () => void;
  onSaved?: () => void;
}) {
  const id = useId();
  const [names, setNames] = useState<Record<BandKey, string>>(
    () => Object.fromEntries(BAND_COLUMNS.map((c) => [c.key, (band[c.key] ?? []).join(", ")])) as Record<BandKey, string>,
  );
  const groups = groupsFor(kind);
  // With more songs than fit in a list, the first ones start ticked.
  const [rows, setRows] = useState<Row[]>(() => {
    const seen = new Map<boolean, number>();
    return songs.map((s) => {
      const closing = groups.length > 1 && s.closing === true;
      const n = seen.get(closing) ?? 0;
      seen.set(closing, n + 1);
      const max = groups.find((g) => g.closing === closing)!.max;
      return {
        ...s,
        ...splitKey(s.key),
        uid: nextUid++,
        closing,
        include: n < max,
      };
    });
  });
  const [linkVals, setLinkVals] = useState<string[]>(() => Array.from({ length: MAX_LINKS }, (_, i) => links[i] ?? ""));
  const [note, setNote] = useState(comments);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [pending, start] = useTransition();

  const inGroup = (g: Group) => rows.filter((r) => r.closing === g.closing);
  const tickedIn = (g: Group) => inGroup(g).filter((r) => r.include).length;
  const overLimit = groups.some((g) => tickedIn(g) > g.max);
  const singers = [...new Set([names.wl, names.vox].flatMap((v) => v.split(",").map((n) => n.trim())).filter(Boolean))];
  const setRow = (uid: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: RecordInput = {
      band: Object.fromEntries(
        BAND_COLUMNS.map((c) => [
          c.key,
          names[c.key]
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
        ]),
      ),
      // Main set first, then the closing song.
      songs: groups.flatMap((g) =>
        inGroup(g)
          .filter((r) => r.include && r.title.trim())
          .map((r) => ({
            title: r.title,
            artist: r.artist,
            key: joinKey(r),
            lead: r.lead,
            ...(r.closing ? { closing: true } : {}),
          })),
      ),
      links: linkVals,
      comments: note,
    };
    start(async () => {
      const r = await onSubmit(payload);
      setResult(r);
      if (r.ok) onSaved?.();
    });
  };

  return (
    // A faint wash of the accent, so the white boxes to fill in stand out.
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-accent/15 bg-accent/[0.04] p-4 sm:p-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Band</legend>
        <p className="text-xs text-muted">Separate several people with commas.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BAND_COLUMNS.map((c) => (
            <label key={c.key} className="space-y-1">
              <span className="text-xs font-medium text-muted">{c.long}</span>
              <input value={names[c.key]} onChange={(e) => setNames((n) => ({ ...n, [c.key]: e.target.value }))} className={input} placeholder="—" />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Songs</legend>
        <datalist id={`${id}-singers`}>
          {singers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {rows.length === 0 && <p className="text-sm text-muted">No songs. Add them below.</p>}
        {groups.map((g) => {
          const list = inGroup(g);
          const ticked = tickedIn(g);
          const choosing = list.length > g.max;
          return (
            <div key={String(g.closing)} className="space-y-2">
              {g.label && (
                <h3 className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  {g.label}
                  <span className="ml-1.5 font-normal normal-case tracking-normal">({g.max === 1 ? `Song ${g.first}` : `Songs ${g.first}–${g.first + g.max - 1}`})</span>
                </h3>
              )}
              {choosing && (
                <p className={`text-xs ${ticked > g.max ? "text-danger" : "text-muted"}`}>
                  {list.length} songs here. Tick {g.max === 1 ? "one" : `the ${g.max}`} to keep ({ticked} ticked).
                </p>
              )}
              {list.length > 0 && (
                <ol className="space-y-2">
                  {list.map((r, i) => (
                    <li
                      key={r.uid}
                      className={`grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-lg border p-2 ${r.include ? "border-border" : "border-dashed border-border opacity-60"}`}
                    >
                      {choosing ? (
                        <input
                          type="checkbox"
                          aria-label={`Keep ${r.title || `song ${i + 1}`}`}
                          checked={r.include}
                          disabled={!r.include && ticked >= g.max}
                          onChange={(e) => setRow(r.uid, { include: e.target.checked })}
                          className="mt-2.5 h-4 w-4 accent-[var(--color-accent)]"
                        />
                      ) : (
                        <span className="mt-2 w-4 text-right text-xs text-muted">{g.first + i}</span>
                      )}
                      <div className="grid items-start gap-2 sm:grid-cols-[2fr_1.4fr_9.5rem_1.2fr]">
                        <SongSearch row={r} bank={bank} onChange={(patch) => setRow(r.uid, patch)} />
                        <input aria-label="Artist" placeholder="Artist" value={r.artist} onChange={(e) => setRow(r.uid, { artist: e.target.value })} className={input} />
                        <KeyField row={r} onChange={(patch) => setRow(r.uid, patch)} />
                        <input
                          aria-label="Lead vox"
                          placeholder="Lead vox"
                          list={`${id}-singers`}
                          value={r.lead}
                          onChange={(e) => setRow(r.uid, { lead: e.target.value })}
                          className={input}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${r.title || `song ${i + 1}`}`}
                        onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}
                        className="mt-1 rounded-md px-2 py-1 text-muted hover:bg-background hover:text-danger"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {ticked < g.max && (
                <button type="button" onClick={() => setRows((rs) => [...rs, blankSong(g.closing)])} className="text-sm font-medium text-accent hover:underline">
                  {g.closing ? "+ Add closing song" : "+ Add song"}
                </button>
              )}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Livestream links</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {linkVals.map((l, i) => (
            <label key={i} className="space-y-1">
              <span className="text-xs font-medium text-muted">Link {i + 1}</span>
              <input
                type="url"
                inputMode="url"
                placeholder="https://youtube.com/…"
                value={l}
                onChange={(e) => setLinkVals((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))}
                className={input}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-1">
        <span className="text-sm font-semibold">Comments</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || overLimit}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground transition hover:bg-ink/90 disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background">
            Cancel
          </button>
        )}
        {result?.message && (
          <p role="status" className={`text-sm ${result.ok ? "text-emerald-700" : "text-danger"}`}>
            {result.message}
          </p>
        )}
      </div>
    </form>
  );
}
