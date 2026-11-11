"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveAbsenceWithCover, swapOptionsForAbsence, type CoverChoice } from "@/app/(app)/roster/serving-actions";
import {
  BandRolePicker,
  RoutePicker,
  SwapSelect,
  bandPicksFor,
  bandPicksReady,
  btn,
  useSwapOptions,
  type BandPicks,
} from "@/components/roster/requests-board";
import { useCloseOnLeave } from "@/lib/use-close-on-leave";
import { ROLE_LABEL, formatDate } from "@/lib/roster";
import type { AbsenceClash } from "@/lib/serving";

const when = (date: string) => formatDate(date, { weekday: "short", day: "numeric", month: "short" });

type Choice = { target: string; offer: string; band: BandPicks };

/** One clashing session: who to ask. */
function ClashCover({
  clash,
  range,
  choice,
  onChange,
}: {
  clash: AbsenceClash;
  range: { startsOn: string; endsOn: string };
  choice: Choice;
  onChange: (c: Choice) => void;
}) {
  const s = clash.session;
  const [load] = useState(() => (id: string) => swapOptionsForAbsence(s.id, id, range));
  const swap = useSwapOptions(load, choice.target || null);
  const targetName = clash.candidates.find((c) => c.id === choice.target)?.name ?? "";
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="text-sm">
        <span className="font-medium">
          {s.name}, {when(s.date)}
        </span>
        <span className="text-muted">
          {s.rehearsal && ` · rehearsal ${when(s.rehearsal)}`} · {ROLE_LABEL[clash.role] ?? clash.role}
        </span>
        <span className="block text-xs text-orange-700">
          Your absence covers {clash.on.length === 2 ? "the service and its rehearsal" : clash.on[0] === "rehearsal" ? "the rehearsal" : "the service"}.
          {clash.unanswered && " You hadn't answered this one yet, so it'll be marked as can't serve."}
        </span>
      </p>
      <BandRolePicker roles={clash.bandRoles} picks={choice.band} onChange={(band) => onChange({ ...choice, band })} />
      <RoutePicker
        candidates={clash.candidates}
        target={choice.target}
        setTarget={(target) => onChange({ ...choice, target, offer: "" })}
      />
      {choice.target && (
        <SwapSelect options={swap.options} loading={swap.loading} value={choice.offer} onChange={(offer) => onChange({ ...choice, offer })} name={targetName} />
      )}
    </div>
  );
}

/**
 * Adding an absence on days they've confirmed they'll serve: like saying "can't serve", they find
 * someone to cover each session by asking them directly. Cancelling adds no absence.
 */
export function AbsenceCoverDialog({
  absence,
  clashes: initial,
  onCancel,
  onSaved,
}: {
  absence: { id?: string; startsOn: string; endsOn: string; reason: string };
  clashes: AbsenceClash[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useCloseOnLeave(ref);
  const [clashes, setClashes] = useState(initial);
  const [reason, setReason] = useState(absence.reason);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const range = { startsOn: absence.startsOn, endsOn: absence.endsOn };
  const choiceFor = (id: string): Choice => choices[id] ?? { target: "", offer: "", band: {} };

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  const ready =
    reason.trim() &&
    clashes.every((c) => {
      const ch = choiceFor(c.session.id);
      return ch.target && bandPicksReady(c.bandRoles, ch.band);
    });
  const only = clashes.length === 1 ? choiceFor(clashes[0]!.session.id) : null;
  const label = only ? (only.offer ? "Propose swap" : "Send request") : "Send requests";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const covers: CoverChoice[] = clashes.map((c) => {
      const ch = choiceFor(c.session.id);
      return {
        sessionId: c.session.id,
        targetId: ch.target,
        offerSessionId: ch.offer || null,
        bandRoles: bandPicksFor(c.bandRoles, ch.band),
      };
    });
    start(async () => {
      setError(null);
      const r = await saveAbsenceWithCover({ ...absence, reason, covers });
      if (r.ok) {
        onSaved();
        return;
      }
      setError(r.message);
      if (r.clashes) setClashes(r.clashes);
    });
  };

  const dates =
    absence.startsOn === absence.endsOn ? when(absence.startsOn) : `${when(absence.startsOn)} – ${when(absence.endsOn)}`;

  return (
    <dialog
      ref={ref}
      onClose={(e) => {
        // React passes it up to the absence dialog this sits in, which would reset the form.
        e.stopPropagation();
        // A close from before it was opened again (React runs effects twice in development,
        // closing then reopening it): it's still open, so it wasn't cancelled.
        if (ref.current?.open) return;
        onCancel();
      }}
      // Clicking outside it cancels: the absence isn't added.
      onClick={(e) => e.target === ref.current && !pending && ref.current?.close()}
      aria-labelledby="absence-cover-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <form onSubmit={submit} className="flex max-h-[85dvh] flex-col">
        <div className="space-y-1 border-b border-border p-6 pb-4">
          <h2 id="absence-cover-title" className="text-lg font-semibold">
            Can&apos;t serve?
          </h2>
          <p className="text-sm text-muted">
            You&apos;re rostered to serve on {clashes.length === 1 ? "a day" : "days"} in this absence ({dates}). Find someone to cover{" "}
            {clashes.length === 1 ? "it" : "each one"} to add the absence.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <label className="block text-sm font-medium">
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={80}
              required
              autoFocus
              placeholder="e.g. Away for a wedding"
              className="mt-1 block h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal"
            />
          </label>
          {clashes.map((c) => (
            <ClashCover
              key={c.session.id}
              clash={c}
              range={range}
              choice={choiceFor(c.session.id)}
              onChange={(ch) => setChoices((all) => ({ ...all, [c.session.id]: ch }))}
            />
          ))}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button type="button" onClick={() => ref.current?.close()} className={`${btn} border border-border bg-surface`}>
            Cancel
          </button>
          <button type="submit" disabled={pending || !ready} className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}>
            {pending ? "Sending…" : label}
          </button>
        </div>
      </form>
    </dialog>
  );
}
