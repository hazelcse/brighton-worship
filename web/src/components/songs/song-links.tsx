"use client";

import { useActionState, useState } from "react";
import { saveLinks, type SaveState } from "@/app/(app)/songs/actions";

type Link = { label: string; url: string };

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export function SongLinks({ songId, links, canEdit }: { songId: string; links: Link[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Link[]>(links);
  const [state, action, pending] = useActionState(saveLinks.bind(null, songId), { ok: false, message: null } as SaveState);

  // Leave edit mode once saved.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.ok) setEditing(false);
  }

  function update(i: number, patch: Partial<Link>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  }

  return (
    <section aria-labelledby="links-title" className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 id="links-title" className="text-lg font-semibold">
          Reference links
        </h2>
        {canEdit && !editing && (
          <button type="button" onClick={() => { setRows(links); setEditing(true); }} className="text-sm text-accent underline underline-offset-2">
            Edit
          </button>
        )}
      </div>

      {!editing ? (
        links.length === 0 ? (
          <p className="text-sm text-muted">No links yet.</p>
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
        )
      ) : (
        <form action={action} className="space-y-3">
          <input type="hidden" name="links" value={JSON.stringify(rows)} />
          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <input aria-label="Link name" value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Name shown, e.g. Official live video" className={input} />
              <input aria-label="Link address" value={r.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" className={input} />
              <div className="flex gap-3 text-xs">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-foreground disabled:opacity-40">
                  ↑ Up
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="text-muted hover:text-foreground disabled:opacity-40">
                  ↓ Down
                </button>
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="ml-auto text-danger">
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setRows([...rows, { label: "", url: "" }])} className="text-sm text-accent underline underline-offset-2">
            + Add link
          </button>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="submit" disabled={pending} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60">
              {pending ? "Saving…" : "Save links"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-muted">
              Cancel
            </button>
            {state.message && !state.ok && (
              <p role="alert" className="text-sm text-danger">
                {state.message}
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
