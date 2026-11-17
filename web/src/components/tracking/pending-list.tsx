"use client";

import { useState } from "react";
import { formatDate } from "@/lib/roster";
import { MAX_MAIN_SET, MAX_SONGS, MINISTRY_TEXT, isSunday, type PendingSession } from "@/lib/tracking";
import { confirmSession, deletePending } from "@/app/(app)/sessions/tracking/actions";
import { RecordForm } from "@/components/tracking/record-form";
import type { BankSong } from "@/components/sessions/song-bank-panel";

function Chevron({ open }: { open: boolean }) {
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
      className={`shrink-0 transition ${open ? "rotate-90" : ""}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** The plan has more songs than the table keeps, so root picks. */
function tooMany(s: PendingSession) {
  if (!isSunday(s.kind)) return s.songs.length > MAX_SONGS;
  const closing = s.songs.filter((x) => x.closing).length;
  return s.songs.length - closing > MAX_MAIN_SET || closing > 1;
}

/** Sessions waiting for root to confirm them into tracking, oldest first; one open at a time. */
export function PendingList({ sessions, bank }: { sessions: PendingSession[]; bank: BankSong[] }) {
  const [open, setOpen] = useState<string | null>(sessions[0]?.rosterSessionId ?? null);

  if (!sessions.length) {
    return <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">Nothing pending: every session that has happened is in tracking.</p>;
  }

  return (
    <ul className="space-y-2">
      {sessions.map((s, i) => {
        const isOpen = open === s.rosterSessionId;
        return (
          <li key={s.rosterSessionId} className={`overflow-hidden rounded-xl border bg-surface ${isOpen ? "border-accent/60" : "border-border"}`}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : s.rosterSessionId)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-background/60"
            >
              <Chevron open={isOpen} />
              <span className="w-28 shrink-0 text-sm font-medium sm:w-36">
                {formatDate(s.date, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-semibold">{MINISTRY_TEXT[s.ministry]}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{s.serviceName}</span>
              <span className="hidden shrink-0 text-xs text-muted sm:inline">
                {!s.hasPlan ? "No plan" : `${s.songs.length} song${s.songs.length === 1 ? "" : "s"}`}
                {tooMany(s) && " · pick songs"}
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-border px-4 py-4">
                {!s.hasPlan && <p className="mb-4 text-sm text-muted">The worship leaders didn&apos;t make a plan for this session, so add its songs yourself.</p>}
                <RecordForm
                  kind={s.kind}
                  band={s.band}
                  songs={s.songs}
                  links={[]}
                  comments=""
                  bank={bank}
                  submitLabel="Save to tracking"
                  onSubmit={(input) => confirmSession(s.rosterSessionId, input)}
                  // Not wanted in tracking: off Pending for good (the next one opens as it leaves).
                  onDelete={async () => {
                    const r = await deletePending(s.rosterSessionId);
                    if (r.ok) setOpen(sessions[i + 1]?.rosterSessionId ?? null);
                    return r;
                  }}
                  // Saved: it leaves this list; open the next one.
                  onSaved={() => setOpen(sessions[i + 1]?.rosterSessionId ?? null)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
