"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { keepDriveSongsheet } from "@/app/(app)/songs/actions";
import { PdfSheetPreview } from "@/components/songs/pdf-viewer-dialog";
import { NoteLoader } from "@/components/note-loader";
import { useCloseOnLeave } from "@/lib/use-close-on-leave";
import type { DriveDuplicate } from "@/lib/worker";

function when(at: string | null) {
  if (!at) return null;
  return new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Song page: "Compare songsheets" for a song with two or more songsheets in the Google Drive folder.
 * A popup shows them side by side (stacked on phones); keeping one makes it the app's songsheet and
 * moves the others to the Drive bin. `openNow` opens it straight away (the Updates link, ?duplicates=1).
 */
export function DuplicateSongsheetsButton({ songId, title, openNow = false }: { songId: string; title: string; openNow?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useCloseOnLeave(ref);
  const router = useRouter();
  const [files, setFiles] = useState<DriveDuplicate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<DriveDuplicate | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string | null } | null>(null);
  const [pending, start] = useTransition();

  // Loads the list (state is only set once the answer comes back).
  const load = useCallback(() => {
    fetch(`/api/songs/${songId}/drive-duplicates`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Google Drive couldn't be reached.");
        setError(null);
        setFiles(json.files);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [songId]);

  function open() {
    setChoice(null);
    setResult(null);
    ref.current?.showModal();
    if (!files) load();
  }

  // Arriving from a "Compare and keep one" link (?duplicates=1): open straight away.
  useEffect(() => {
    if (!openNow) return;
    ref.current?.showModal();
    load();
  }, [openNow, load]);

  function keep(f: DriveDuplicate) {
    start(async () => {
      const r = await keepDriveSongsheet(songId, f.id);
      setResult(r);
      setChoice(null);
      if (r.ok) {
        setFiles(null);
        router.refresh();
      }
    });
  }

  const others = files && choice ? files.filter((f) => f.id !== choice.id) : [];
  const cols = files?.length ?? 2;

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-ink-foreground hover:bg-ink/90"
      >
        Compare songsheets
      </button>
      <dialog
        ref={ref}
        aria-labelledby="duplicates-title"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-6xl rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div>
              <h2 id="duplicates-title" className="font-display text-2xl font-semibold">
                Compare songsheets
              </h2>
              <p className="text-sm text-muted">
                {title} has {files ? `${files.length} songsheets` : "more than one songsheet"} in the Google Drive folder. Keep one: it becomes the
                app&apos;s songsheet, and the others go to the Drive bin (Drive keeps them there for 30 days).
              </p>
            </div>
            <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="-mr-2 shrink-0 rounded-full p-2 text-muted hover:bg-background">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {result && (
            <p role="status" className={`border-b border-border px-5 py-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-danger"}`}>
              {result.message}
            </p>
          )}

          {choice && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-accent/[0.06] px-5 py-3">
              <p className="text-sm">
                Keep <span className="font-medium">{choice.name}</span>? {others.map((o) => o.name).join(", ")}{" "}
                {others.length === 1 ? "goes" : "go"} to the Google Drive bin.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setChoice(null)} disabled={pending} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent/50 disabled:opacity-60">
                  Cancel
                </button>
                <button type="button" onClick={() => keep(choice)} disabled={pending} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60">
                  {pending ? "Keeping…" : "Keep this one"}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-y-auto p-5">
            {result?.ok ? (
              <div className="flex justify-end">
                <button type="button" onClick={() => ref.current?.close()} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground">
                  Done
                </button>
              </div>
            ) : error ? (
              <p className="rounded-lg bg-background p-4 text-sm text-muted">{error}</p>
            ) : !files ? (
              <div className="flex items-center justify-center py-16">
                <NoteLoader label="Getting the songsheets from Google Drive" />
              </div>
            ) : files.length < 2 ? (
              <p className="rounded-lg bg-background p-4 text-sm text-muted">
                This song has only one songsheet in Google Drive now. The warning clears at the next sync.
              </p>
            ) : (
              <ul className={`grid gap-5 md:grid-cols-2 ${cols >= 3 ? "lg:grid-cols-3" : ""}`}>
                {files.map((f) => (
                  <li key={f.id} className="min-w-0 space-y-3">
                    <div className="space-y-1">
                      <p className="break-words font-medium">{f.name}</p>
                      <p className="text-xs text-muted">
                        {f.google_doc ? "Google Doc" : ".docx"}
                        {f.modified_time && ` · changed ${when(f.modified_time)}`}
                        {f.modified_by && ` by ${f.modified_by}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {f.in_app && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">In the app now</span>}
                        {f.same_as && <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-700">Same file as {f.same_as}</span>}
                        {f.link && (
                          <a href={f.link} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
                            Open in Drive ↗
                          </a>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setResult(null);
                        setChoice(f);
                      }}
                      disabled={pending}
                      aria-pressed={choice?.id === f.id}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:border-accent/50 disabled:opacity-60 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-foreground"
                    >
                      Keep this one
                    </button>
                    <PdfSheetPreview src={`/api/songs/${songId}/drive-duplicates/${encodeURIComponent(f.id)}`} title={f.name} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
