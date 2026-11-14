"use client";

import { useState } from "react";

export type SongLink = { label: string; url: string };
type Link = SongLink;

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/** A song's reference links, to read: a row of the Details card's list (dt + dd). Edited in its edit mode. */
export function SongLinks({ links }: { links: Link[] }) {
  return (
    <div className="col-span-2">
      <dt className="text-muted">Reference links</dt>
      <dd className="mt-1">
        {links.length === 0 ? (
          <span className="font-medium">—</span>
        ) : (
          <ol className="space-y-1.5">
            {links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-accent underline-offset-2 hover:underline"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
                  </svg>
                  {l.label}
                </a>
              </li>
            ))}
          </ol>
        )}
      </dd>
    </div>
  );
}

const YOUTUBE_PATH =
  "M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z";

/**
 * The links being edited. Each shows as a plain link with a pencil beside it; the pencil opens it
 * as a card (name, address, move, remove, Done). New links open straight away.
 */
export function LinkRows({ rows, onChange }: { rows: Link[]; onChange: (rows: Link[]) => void }) {
  const setRows = onChange;
  // Which rows are open, by position (kept in step when rows move or go).
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number, on: boolean) =>
    setOpen((o) => {
      const n = new Set(o);
      if (on) n.add(i);
      else n.delete(i);
      return n;
    });

  function update(i: number, patch: Partial<Link>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
    setOpen((o) => new Set([...o].map((k) => (k === i ? j : k === j ? i : k))));
  }
  function remove(i: number) {
    setRows(rows.filter((_, j) => j !== i));
    setOpen((o) => new Set([...o].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k))));
  }

  return (
    <>
      {rows.map((r, i) =>
        open.has(i) ? (
          <div key={i} className="space-y-2 rounded-lg border border-border bg-surface p-3">
            <label className="block space-y-1.5 text-sm font-medium">
              <span className="block">Link title</span>
              <input value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="e.g. Official live video" className={`${input} font-normal`} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span className="block">Link</span>
              <input value={r.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" className={`${input} font-normal`} />
            </label>
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-foreground disabled:opacity-40">
                ↑ Up
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="text-muted hover:text-foreground disabled:opacity-40">
                ↓ Down
              </button>
              <button type="button" onClick={() => toggle(i, false)} className="ml-auto font-medium text-accent hover:underline">
                Done
              </button>
              <button type="button" onClick={() => remove(i)} className="text-danger">
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div key={i} className="flex items-center gap-2">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-accent underline-offset-2 hover:underline"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="shrink-0">
                <path d={YOUTUBE_PATH} />
              </svg>
              <span className="truncate">{r.label || r.url}</span>
            </a>
            <button
              type="button"
              onClick={() => toggle(i, true)}
              aria-label={`Edit link: ${r.label || r.url}`}
              title="Edit link"
              className="inline-flex shrink-0 items-center border-b border-transparent text-muted opacity-70 transition hover:border-current hover:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                <path d="m14.5 5.5 3 3" />
              </svg>
            </button>
          </div>
        ),
      )}
      <button
        type="button"
        onClick={() => {
          setRows([...rows, { label: "", url: "" }]);
          toggle(rows.length, true);
        }}
        className="text-sm text-accent underline underline-offset-2"
      >
        + Add link
      </button>
    </>
  );
}
