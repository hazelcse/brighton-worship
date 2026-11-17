"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { publishRoster, resetToGenerated } from "@/app/(app)/roster/actions";
import { useCloseOnLeave } from "@/lib/use-close-on-leave";

/** Opens "Everyone's load" in a popup. */
export function LoadsButton({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useCloseOnLeave(ref);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="h-10 rounded-full border border-orange-400 bg-surface px-4 text-sm font-medium text-orange-700 hover:border-orange-500 hover:bg-orange-50"
      >
        Load
      </button>
      <dialog
        ref={ref}
        aria-labelledby="loads-title"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[calc(100%-1rem)] max-w-3xl rounded-2xl bg-surface p-0 text-foreground shadow-2xl sm:w-[calc(100%-2rem)]"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 id="loads-title" className="font-display text-2xl font-semibold">
              Everyone&apos;s load
            </h2>
            <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="-mr-2 rounded-full p-2 text-muted hover:bg-background">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      </dialog>
    </>
  );
}

/** Back to planning · Reset (after hand edits) · Save draft · Publish. */
export function GeneratedActions({
  rosterId,
  isLead,
  edited,
  problems,
}: {
  rosterId: string;
  isLead: boolean;
  /** Changed by hand since generating (and a snapshot exists to go back to). */
  edited: boolean;
  /** Hard problems: publishing is allowed, but asks first and they stay listed. */
  problems: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/roster/${rosterId}/plan`}
        className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50"
      >
        ← Back to planning
      </Link>
      {isLead && edited && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Undo every change made by hand and go back to the roster as it was generated?")) return;
            setError(null);
            start(async () => {
              const r = await resetToGenerated(rosterId);
              if (!r.ok) setError(r.message ?? "Couldn't reset.");
            });
          }}
          className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50 disabled:opacity-50"
        >
          Reset to generated
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => router.push("/roster/new")}
        className="h-10 rounded-lg border border-ink px-4 text-sm font-medium text-ink hover:bg-ink hover:text-ink-foreground disabled:opacity-50"
        title="The roster is already saved as a draft. You can come back and publish it later."
      >
        Save draft
      </button>
      <button
        type="button"
        disabled={pending}
        title="Make this the live roster for the quarter"
        onClick={() => {
          const msg = problems
            ? `This roster still has ${problems} ${problems === 1 ? "problem" : "problems"} (see the red box). They'll stay listed on the roster after publishing.

Publish anyway? It becomes the live roster for the quarter and everyone can see it.`
            : "Publish this roster? It becomes the live roster for the quarter and everyone can see it.";
          if (!window.confirm(msg)) return;
          setError(null);
          start(async () => {
            const r = await publishRoster(rosterId);
            if (r && !r.ok) setError(r.message ?? "Couldn't publish.");
          });
        }}
        className={`h-10 rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${problems ? "bg-red-700 text-white hover:bg-red-800" : "bg-ink text-ink-foreground hover:bg-ink/90"}`}
      >
        {pending ? "Working…" : problems ? "Publish with problems" : "Publish roster"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
