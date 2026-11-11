"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { syncFromDrive, type DriveSyncSummary } from "@/app/(app)/songs/actions";
import { useCloseOnLeave } from "@/lib/use-close-on-leave";

const RESULT_LABEL = {
  added: { text: "Added", style: "bg-emerald-100 text-emerald-800" },
  updated: { text: "Updated", style: "bg-sky-100 text-sky-800" },
  replaced: { text: "Replaced library copy", style: "bg-violet-100 text-violet-800" },
  unchanged: { text: "Already in library", style: "bg-stone-100 text-muted" },
  failed: { text: "Failed", style: "bg-red-100 text-red-800" },
  removed: { text: "Gone from Drive", style: "bg-amber-100 text-amber-800" },
} as const;

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "Sync from Drive": pulls new and changed songsheets from the shared Google Drive folder. */
export function DriveSyncButton({ lastSyncedAt, everyMinutes, running = false }: { lastSyncedAt: string | null; everyMinutes: number; running?: boolean }) {
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState<DriveSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A sync was already running when clicked: spin until the page says it has finished.
  const [waiting, setWaiting] = useState(false);
  const router = useRouter();
  const spinning = pending || running || waiting;
  useEffect(() => {
    if (!waiting && !running) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [waiting, running, router]);
  // The refreshed page shows the sync is done (a newer finished time): stop spinning.
  const [seenSyncedAt, setSeenSyncedAt] = useState(lastSyncedAt);
  if (lastSyncedAt !== seenSyncedAt) {
    setSeenSyncedAt(lastSyncedAt);
    if (!running) setWaiting(false);
  }
  const dialogRef = useRef<HTMLDialogElement>(null);
  useCloseOnLeave(dialogRef);

  function run() {
    setError(null);
    start(async () => {
      const r = await syncFromDrive();
      if (r.busy) {
        setWaiting(true);
        return;
      }
      if (!r.ok || !r.summary) {
        setError(r.message ?? "Couldn't sync.");
        return;
      }
      setSummary(r.summary);
      dialogRef.current?.showModal();
    });
  }

  const changes = summary ? summary.items.filter((i) => i.result !== "unchanged") : [];

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={spinning}
        aria-label="Sync from Google Drive"
        title={everyMinutes ? `Sync from Google Drive (also every ${everyMinutes} minutes)` : "Sync from Google Drive"}
        className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-accent/10 hover:text-accent disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={spinning ? "animate-spin" : ""}>
          <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8" />
          <path d="M21 3v5h-5M3 21v-5h5" />
        </svg>
      </button>
      <span className="hidden whitespace-nowrap text-xs text-muted lg:inline" aria-live="polite">
        {spinning ? "Syncing from Drive…" : error ? <span className="text-danger">{error}</span> : lastSyncedAt ? `Synced ${ago(lastSyncedAt)}` : "Not synced yet"}
      </span>

      <dialog
        ref={dialogRef}
        aria-labelledby="drive-sync-title"
        onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        {summary && (
          <div className="max-h-[85vh] space-y-4 overflow-y-auto p-6">
            <h2 id="drive-sync-title" className="font-display text-2xl font-semibold">
              Synced from Drive
            </h2>
            <p className="text-sm text-muted">
              {summary.files} {summary.files === 1 ? "songsheet" : "songsheets"} in the folder · {summary.added} added · {summary.updated} updated
              {summary.replaced ? ` · ${summary.replaced} replaced` : ""} · {summary.unchanged} unchanged
              {summary.failed ? ` · ${summary.failed} failed` : ""}
              {summary.removed ? ` · ${summary.removed} gone from Drive` : ""}
            </p>
            {summary.files === 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                The Drive folder is empty. Add .docx songsheets (or Google Docs) to it, then sync again.
              </p>
            )}
            {changes.length > 0 && (
              <ul className="divide-y divide-border text-sm">
                {changes.map((i, n) => (
                  <li key={n} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_LABEL[i.result].style}`}>{RESULT_LABEL[i.result].text}</span>
                    {i.song_id && i.result !== "failed" ? (
                      <Link href={`/songs/${i.song_id}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                        {i.title || i.name}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-medium">{i.title || i.name}</span>
                    )}
                    {i.error && <span className="w-full text-xs text-danger">{i.error}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end border-t border-border pt-4">
              <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground">
                Done
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
