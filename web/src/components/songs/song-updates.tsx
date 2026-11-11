"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { markSongUpdatesSeen } from "@/app/(app)/songs/actions";
import type { SongUpdate, SongUpdateKind } from "@/lib/song-updates";
import { useCloseOnLeave } from "@/lib/use-close-on-leave";

const KIND: Record<SongUpdateKind, { label: string; dot: string }> = {
  issue_raised: { label: "Issue raised", dot: "bg-red-500" },
  song_added: { label: "New song", dot: "bg-emerald-500" },
  songsheet_reuploaded: { label: "Songsheet re-uploaded", dot: "bg-sky-500" },
  issues_flagged: { label: "Scanner issues", dot: "bg-amber-500" },
  songsheet_missing: { label: "Missing from Drive", dot: "bg-stone-500" },
};
const ORDER = Object.keys(KIND) as SongUpdateKind[];

type Filter = "all" | SongUpdateKind;

function when(at: string) {
  return new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function how(u: SongUpdate) {
  if (u.kind === "songsheet_missing") return "No longer in the Google Drive folder. The app still has its copy.";
  if (u.how) return u.how.charAt(0).toUpperCase() + u.how.slice(1);
  if (u.source === "drive") return "From Google Drive";
  return u.by ? `Uploaded by ${u.by}` : "Uploaded in the app";
}

function SongName({ u }: { u: SongUpdate }) {
  if (!u.songId) return <span>{u.title || "Untitled"} (deleted)</span>;
  return (
    <Link href={`/songs/${u.songId}`} className="text-accent underline-offset-2 hover:underline">
      {u.title || "Untitled"}
    </Link>
  );
}

const New = () => <span className="ml-2 rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold uppercase text-accent">New</span>;

/** "(person) raised an issue with (song)": opens to show what they said and a link to the songsheet. */
function RaisedIssue({ u }: { u: SongUpdate }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 flex-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-full space-y-0.5 text-left">
        <p className="text-sm">
          <span className="font-medium">{u.by ?? "Someone"}</span> raised an issue with <span className="font-medium">{u.title || "a song"}</span>
          {u.unseen && <New />}
        </p>
        <p className="text-xs text-muted">
          {when(u.at)} · {open ? "Hide" : "Show"} reason
        </p>
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3">
          <p className="whitespace-pre-line text-sm">{u.message}</p>
          {u.songId ? (
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href={`/songs/${u.songId}?sheet=1`} className="font-medium text-accent underline-offset-2 hover:underline">
                Open the songsheet →
              </Link>
              <Link href={`/songs/${u.songId}`} className="text-muted underline-offset-2 hover:underline">
                Song page
              </Link>
            </div>
          ) : (
            <p className="text-xs text-muted">The song has since been deleted.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Songs page: recent song library updates, for people with songs.library_updates or songs.issue_reports. */
export function SongUpdatesButton({ updates, kinds }: { updates: SongUpdate[]; kinds: SongUpdateKind[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  useCloseOnLeave(ref);
  const [filter, setFilter] = useState<Filter>("all");
  const [unseen, setUnseen] = useState(() => updates.filter((u) => u.unseen).length);
  const shown = filter === "all" ? updates : updates.filter((u) => u.kind === filter);
  const filters: Filter[] = ["all", ...ORDER.filter((k) => kinds.includes(k))];

  function open() {
    ref.current?.showModal();
    if (unseen) {
      setUnseen(0);
      void markSongUpdatesSeen();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={unseen > 0 ? `Updates, ${unseen} new` : "Updates"}
        title="Updates"
        className="relative inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface text-sm font-medium hover:border-accent/50 md:w-auto md:px-4"
      >
        {/* Phones: a bell, with an orange dot in the corner when there are new updates. */}
        <svg className="md:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unseen > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface md:hidden" aria-hidden />}
        <span className="hidden md:inline">Updates</span>
        {unseen > 0 && (
          <span className="hidden rounded-full bg-accent px-1.5 text-xs font-semibold leading-5 text-white md:inline" aria-hidden>
            {unseen}
          </span>
        )}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="song-updates-title"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="space-y-3 border-b border-border p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="song-updates-title" className="font-display text-2xl font-semibold">
                  Song library updates
                </h2>
                <p className="text-sm text-muted">The last 60 days.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="-mr-2 rounded-full p-2 text-muted hover:bg-background">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {filters.length > 2 && (
              <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
                {filters.map((f) => {
                  const n = f === "all" ? updates.length : updates.filter((u) => u.kind === f).length;
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                      className="rounded-full border border-border px-3 py-1 text-xs font-medium aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-foreground"
                    >
                      {f === "all" ? "All" : KIND[f].label} ({n})
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {shown.length ? (
            <ul className="divide-y divide-border overflow-y-auto">
              {shown.map((u) => (
                <li key={u.id} className={`flex gap-3 px-5 py-3 ${u.unseen ? "bg-accent/[0.05]" : ""}`}>
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND[u.kind].dot}`} />
                  {u.kind === "issue_raised" ? (
                    <RaisedIssue u={u} />
                  ) : (
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm">
                        <span className="font-medium">{KIND[u.kind].label}: </span>
                        <SongName u={u} />
                        {u.unseen && <New />}
                      </p>
                      <p className="text-xs text-muted">
                        {how(u)}
                        {u.file && ` · ${u.file}`} · {when(u.at)}
                      </p>
                      {u.issues.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {u.issues.map((i, n) => (
                            <li key={n} className={`text-xs ${i.severity === "error" ? "text-danger" : "text-amber-800"}`}>
                              {i.severity === "error" ? "✕ " : "! "}
                              {i.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-8 text-center text-sm text-muted">Nothing here yet.</p>
          )}
        </div>
      </dialog>
    </>
  );
}
