"use client";

import { useRef, useState, useTransition } from "react";
import { clearMissingFromDrive, raiseSongIssue } from "@/app/(app)/songs/actions";

function FlagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 22V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  );
}

/** Song page: report a problem with the song or its songsheet. */
export function RaiseIssueButton({ songId, title }: { songId: string; title: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string | null } | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    ref.current?.close();
    if (result?.ok) {
      setText("");
      setResult(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label="Raise an issue with this song"
        title="Raise an issue"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted hover:border-danger/60 hover:text-danger"
      >
        <FlagIcon />
      </button>
      <dialog
        ref={ref}
        aria-labelledby="raise-issue-title"
        onClick={(e) => e.target === ref.current && close()}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => setResult(await raiseSongIssue(songId, text)));
          }}
        >
          <div>
            <h2 id="raise-issue-title" className="font-display text-2xl font-semibold">
              Raise an issue
            </h2>
            <p className="text-sm text-muted">{title}</p>
          </div>
          {result?.ok ? (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {result.message}
            </p>
          ) : (
            <label className="block space-y-1 text-sm font-medium">
              What&apos;s wrong with the song or its songsheet?
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                maxLength={2000}
                required
                autoFocus
                placeholder="e.g. The bridge chords are wrong on page 2, should be G/B not G"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>
          )}
          {result && !result.ok && (
            <p role="alert" className="text-sm text-danger">
              {result.message}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {!result?.ok && (
              <button type="submit" disabled={pending || !text.trim()} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-50">
                {pending ? "Sending…" : "Send"}
              </button>
            )}
            <button type="button" onClick={close} className="text-sm text-muted">
              {result?.ok ? "Close" : "Cancel"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Editors: dismiss the "missing from Drive" flag. */
export function ClearMissingButton({ songId }: { songId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await clearMissingFromDrive(songId);
            if (!r.ok) setError(r.message);
          })
        }
        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent/50 disabled:opacity-60"
      >
        {pending ? "Clearing…" : "Clear flag"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
