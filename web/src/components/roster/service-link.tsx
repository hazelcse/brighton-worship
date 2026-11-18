"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { serviceLinkOptions, setServiceLink, type LinkState } from "@/app/(app)/roster/link-actions";
import { formatDate } from "@/lib/roster";

/**
 * Linking an ad hoc service to other teams' services on the same day (leads only), so root and the
 * observer see them as one service: e.g. Main Worship's band and session with Main Media's crew.
 * Standard services (Sunday, Saturday, PnP) are linked already, by their kind and date.
 */

const button = "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60";
const quiet = "rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-accent/50 disabled:opacity-60";

function useLinkOptions(sessionId: string | null, date: string, version = 0) {
  const [opts, setOpts] = useState<LinkState | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    serviceLinkOptions(sessionId, date)
      .then((o) => live && setOpts(o))
      .catch(() => live && setOpts(null));
    return () => {
      live = false;
    };
  }, [sessionId, date, version]);
  return opts;
}

/** The other teams' services that day, to pick one to link to (or not to link). */
function Chooser({
  sessionId,
  opts,
  currentId,
  onDone,
  cancelLabel,
}: {
  sessionId: string;
  opts: LinkState;
  /** The other team's session it's linked to now, if any. */
  currentId: string | null;
  onDone: (message: string | null) => void;
  cancelLabel: string;
}) {
  const [pick, setPick] = useState<string | null>(currentId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (target: string | null) =>
    start(async () => {
      setError(null);
      const r = await setServiceLink(sessionId, target);
      if (r.ok) onDone(r.message);
      else setError(r.message);
    });

  return (
    <div className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="sr-only">Service to link to</legend>
        {opts.candidates.map((c) => (
          <label
            key={c.id}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
              c.blocked ? "border-border opacity-50" : pick === c.id ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
            }`}
          >
            <input
              type="radio"
              name={`link-${sessionId}`}
              checked={pick === c.id}
              disabled={Boolean(c.blocked) || pending}
              onChange={() => setPick(c.id)}
              className="mt-1 accent-accent"
            />
            <span className="min-w-0">
              <span className="block font-medium">{c.name}</span>
              <span className="block text-xs text-muted">
                {c.teams.join(" + ")}
                {c.rosterStatus === "draft" ? " · on a draft roster" : ""}
                {c.blocked ? ` · ${c.blocked}` : ""}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!pick || pick === currentId || pending} onClick={() => save(pick)} className={button}>
          {pending ? "Linking…" : "Link"}
        </button>
        {currentId ? (
          <button type="button" disabled={pending} onClick={() => save(null)} className={quiet}>
            Unlink
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => onDone(null)} className={quiet}>
            {cancelLabel}
          </button>
        )}
        {currentId && (
          <button type="button" disabled={pending} onClick={() => onDone(null)} className="text-sm text-muted">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * After an ad hoc service is added: if other teams have ad hoc services that day, ask which one (if
 * any) it's the same service as. `message` (what happened when it was added) shows above. With
 * `stay` the step stays open with a Done button even when there's nothing to link to; otherwise it
 * closes itself.
 */
export function LinkAfterAdding({
  sessionId,
  date,
  message,
  stay = false,
  crew = false,
  onDone,
}: {
  sessionId: string;
  date: string;
  message: string | null;
  stay?: boolean;
  crew?: boolean;
  onDone: () => void;
}) {
  const opts = useLinkOptions(sessionId, date);
  const [result, setResult] = useState<string | null | undefined>(undefined);
  const nothing = opts !== undefined && (!opts || !opts.candidates.length);
  const closed = useRef(false);
  useEffect(() => {
    if (nothing && !stay && !closed.current) {
      closed.current = true;
      onDone();
    }
  }, [nothing, stay, onDone]);

  if (opts === undefined) return <p className="text-sm text-muted">{message ?? "Saved."} Checking for other teams&apos; services that day…</p>;
  if (nothing || result !== undefined) {
    return (
      <div className="space-y-4">
        <p className="text-sm">{[message, result].filter(Boolean).join(" ")}</p>
        <button type="button" onClick={onDone} className={button}>
          Done
        </button>
      </div>
    );
  }
  const n = opts!.candidates.length;
  return (
    <div className="space-y-4">
      {message && <p className="text-sm">{message}</p>}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Is this the same service as another team&apos;s?</h3>
        <p className="text-sm text-muted">
          {n === 1 ? "Another team has an ad hoc service" : `Other teams have ${n} ad hoc services`} on{" "}
          {formatDate(date, { weekday: "long", day: "numeric", month: "long" })}. Linking makes them one service, so root and the observer
          see your {crew ? "crew" : "band and session"} together with theirs. It takes the name of whichever team added it first.
        </p>
      </div>
      <Chooser sessionId={sessionId} opts={opts!} currentId={null} onDone={(m) => (stay ? setResult(m) : onDone())} cancelLabel="Do not link" />
    </div>
  );
}

/** In an ad hoc session's edit dialog: what it's linked to, with Link / Change / Unlink (saved straight away). */
export function LinkedServiceField({ sessionId, date }: { sessionId: string; date: string }) {
  const [version, setVersion] = useState(0);
  const opts = useLinkOptions(sessionId, date, version);
  const [choosing, setChoosing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!opts) return null; // loading, or not the lead
  if (!opts.note && !opts.linked.length && !opts.candidates.length) return null;
  const current = opts.candidates.find((c) => opts.linked.some((l) => l.id === c.id))?.id ?? opts.linked[0]?.id ?? null;

  return (
    <fieldset className="space-y-2 rounded-lg border border-border px-3 py-2.5">
      <legend className="px-1 text-sm font-medium">Linked service</legend>
      {opts.note ? (
        <p className="text-sm text-muted">{opts.note}</p>
      ) : choosing ? (
        <Chooser
          sessionId={sessionId}
          opts={opts}
          currentId={current}
          cancelLabel="Cancel"
          onDone={(m) => {
            setChoosing(false);
            setNote(m);
            setVersion((v) => v + 1);
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            {opts.linked.length ? (
              <>
                Same service as {opts.linked.map((l) => `${l.team}'s ${l.name}`).join(" and ")}.
              </>
            ) : (
              <span className="text-muted">Not linked to another team&apos;s service.</span>
            )}
            {note && <span className="text-muted"> {note}</span>}
          </p>
          {(opts.candidates.length > 0 || opts.linked.length > 0) && (
            <button type="button" onClick={() => setChoosing(true)} className="text-sm underline underline-offset-2 hover:text-accent">
              {opts.linked.length ? "Change" : "Link…"}
            </button>
          )}
        </div>
      )}
      {!choosing && !opts.note && <p className="text-xs text-muted">Changes here are saved straight away.</p>}
    </fieldset>
  );
}

/** A broken chain link: linking a service (Lucide's "unlink"). */
function LinkBreakIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
      <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
      <line x1="8" x2="8" y1="2" y2="5" />
      <line x1="2" x2="5" y1="8" y2="8" />
      <line x1="16" x2="16" y1="19" y2="22" />
      <line x1="19" x2="22" y1="16" y2="16" />
    </svg>
  );
}

/**
 * On a lead's service page (an ad hoc service), top right: a broken-chain button that opens a popup
 * to unlink their team's session or change what it's linked to. Only their own team's session
 * changes; the page reloads to show the teams now serving at it.
 */
export function ServiceLinkButton({ sessionId, date }: { sessionId: string; date: string }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const opts = useLinkOptions(sessionId, date, version);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  const close = () => setOpen(false);
  const current = opts ? (opts.candidates.find((c) => opts.linked.some((l) => l.id === c.id))?.id ?? opts.linked[0]?.id ?? null) : null;
  const ready = opts !== undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVersion((v) => v + 1);
          setOpen(true);
        }}
        aria-label="Unlink or change the linked service"
        title="Unlink or change the linked service"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:border-accent/50 hover:text-foreground"
      >
        <LinkBreakIcon />
      </button>
      <dialog ref={ref} onClose={close} aria-labelledby="link-title" className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl">
        {open && (
          <div className="space-y-4 p-6">
            <h2 id="link-title" className="text-lg font-semibold">
              Linked service
            </h2>
            {!ready ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : !opts ? (
              <p className="text-sm text-muted">Only the lead can link services.</p>
            ) : opts.note ? (
              <p className="text-sm text-muted">{opts.note}</p>
            ) : (
              <>
                <p className="text-sm">
                  {opts.linked.length ? (
                    <>Same service as {opts.linked.map((l) => `${l.team}'s ${l.name}`).join(" and ")}.</>
                  ) : (
                    <span className="text-muted">Not linked to another team&apos;s service.</span>
                  )}
                </p>
                {opts.candidates.length || opts.linked.length ? (
                  <Chooser
                    sessionId={sessionId}
                    opts={opts}
                    currentId={current}
                    cancelLabel="Close"
                    onDone={() => {
                      close();
                      router.refresh();
                    }}
                  />
                ) : (
                  <p className="text-sm text-muted">
                    No other team has an ad hoc service on {formatDate(date, { weekday: "long", day: "numeric", month: "long" })} to link to.
                  </p>
                )}
                <p className="text-xs text-muted">Only your team&apos;s session is linked or unlinked; the other teams&apos; stay as they are.</p>
              </>
            )}
            {(!ready || !opts || opts.note || !(opts.candidates.length || opts.linked.length)) && (
              <div className="flex justify-end">
                <button type="button" onClick={close} className={quiet}>
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
