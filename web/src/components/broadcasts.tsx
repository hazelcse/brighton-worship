"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createBroadcast, deleteBroadcast, respondToBroadcast } from "@/app/(app)/home/broadcast-actions";
import type { Broadcast, BroadcastStatus } from "@/lib/broadcasts";

const field =
  "w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** A modal <dialog> that opens on mount and calls onClose when it closes. */
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return ref;
}

/** Root: write a broadcast to the whole team (from the roster page's + menu). */
export function NewBroadcastDialog({ onClose }: { onClose: () => void }) {
  const ref = useModal();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [ackMessage, setAckMessage] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="broadcast-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <div className="max-h-[88vh] space-y-4 overflow-y-auto p-6">
        <h2 id="broadcast-title" className="font-display text-2xl font-semibold">
          New broadcast
        </h2>
        {done ? (
          <>
            <p className="text-sm">{done}</p>
            <button type="button" onClick={() => ref.current?.close()} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground">
              Done
            </button>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(null);
                const r = await createBroadcast({ title, message, requiresAck, ackMessage });
                if (r.ok) setDone(r.message);
                else setError(r.message);
              });
            }}
          >
            <p className="text-sm text-muted">Shows on the whole team&apos;s landing page.</p>
            <label className="block space-y-1 text-sm">
              <span className="text-xs font-medium text-muted">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} className={`${field} h-10`} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-xs font-medium text-muted">Message</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={5000} rows={4} className={field} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} className="size-4 accent-accent" />
              Require acknowledgement
            </label>
            {requiresAck && (
              <label className="block space-y-1 text-sm">
                <span className="text-xs font-medium text-muted">Acknowledgement message</span>
                <textarea
                  value={ackMessage}
                  onChange={(e) => setAckMessage(e.target.value)}
                  required
                  maxLength={2000}
                  rows={2}
                  placeholder="e.g. I declare I have filled in my absences for the next quarter"
                  className={field}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => ref.current?.close()} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:border-accent/50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                aria-busy={pending}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60"
              >
                {pending ? "Sending…" : "Broadcast"}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

/** A broadcast on someone's landing page: an X to dismiss it, or a tick to acknowledge it. */
function BroadcastCard({ b }: { b: Broadcast }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const respond = (acknowledge: boolean) =>
    start(async () => {
      setError(null);
      const r = await respondToBroadcast(b.id, acknowledge);
      if (!r.ok) setError(r.message);
    });

  return (
    <section aria-label={b.title} className="overflow-hidden rounded-xl border border-border bg-surface text-sm">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{b.title}</h2>
          <p className="mt-1 whitespace-pre-line">{b.message}</p>
          <p className="mt-1 text-xs text-muted">{stamp(b.createdAt)}</p>
        </div>
        {!b.requiresAck && (
          <button
            type="button"
            disabled={pending}
            aria-label={`Dismiss ${b.title}`}
            title="Dismiss"
            onClick={() => respond(false)}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground disabled:opacity-60"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {b.requiresAck && (
        <div className="flex items-center gap-3 border-t border-accent/30 bg-accent/10 px-4 py-3">
          <p className="min-w-0 flex-1 whitespace-pre-line">{b.ackMessage}</p>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            aria-label={`Acknowledge: ${b.ackMessage}`}
            title="Tick to acknowledge"
            onClick={() => respond(true)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-accent bg-surface text-accent transition hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
          >
            <Tick />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="px-4 pb-3 text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** Landing page: broadcasts still waiting on this person. */
export function BroadcastList({ items }: { items: Broadcast[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.map((b) => (
        <BroadcastCard key={b.id} b={b} />
      ))}
    </div>
  );
}

/** Root: who has acknowledged a broadcast and who hasn't, with a button to delete it. */
function StatusDialog({ b, onClose }: { b: BroadcastStatus; onClose: () => void }) {
  const ref = useModal();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`broadcast-${b.id}`}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <div className="max-h-[88vh] space-y-4 overflow-y-auto p-6 text-sm">
        <div className="flex items-start justify-between gap-3">
          <h2 id={`broadcast-${b.id}`} className="font-display text-2xl font-semibold">
            {b.title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => ref.current?.close()}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <p className="whitespace-pre-line">{b.message}</p>
        <p className="rounded-lg bg-accent/10 px-3 py-2 whitespace-pre-line">{b.ackMessage}</p>
        <p className="text-xs text-muted">Sent {stamp(b.createdAt)}</p>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Acknowledged ({b.acknowledged.length} / {b.total})
          </h3>
          {b.acknowledged.length ? (
            <ul className="mt-1 divide-y divide-border">
              {b.acknowledged.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-1.5">
                  <span>{p.name}</span>
                  <span className="text-muted">{stamp(p.at!)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted">Nobody yet.</p>
          )}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Not yet ({b.pending.length})</h3>
          {b.pending.length ? (
            <ul className="mt-1 divide-y divide-border">
              {b.pending.map((p) => (
                <li key={p.id} className="py-1.5">
                  {p.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted">Everyone has acknowledged.</p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="border-t border-border pt-4">
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => {
              if (!confirm(`Delete "${b.title}"? It goes from everyone's landing page.`)) return;
              start(async () => {
                setError(null);
                const r = await deleteBroadcast(b.id);
                if (r.ok) ref.current?.close();
                else setError(r.message);
              });
            }}
            className="w-full rounded-lg border border-danger/40 px-4 py-2 font-medium text-danger hover:bg-danger/10 disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Delete broadcast"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** Root's roster Actionables: broadcasts waiting on acknowledgements. */
export function BroadcastActionables({ items }: { items: BroadcastStatus[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((b) => b.id === openId) ?? null;
  if (!items.length) return null;
  return (
    <div>
      <h3 className="bg-background px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Broadcasts</h3>
      <ul className="divide-y divide-border">
        {items.map((b) => (
          <li key={b.id}>
            <button type="button" onClick={() => setOpenId(b.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-background">
              <span className="min-w-0 flex-1 truncate font-medium">{b.title}</span>
              <span className={`shrink-0 tabular-nums ${b.acknowledged.length === b.total ? "text-accent" : "text-muted"}`}>
                {b.acknowledged.length} / {b.total} acknowledged
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <StatusDialog b={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
