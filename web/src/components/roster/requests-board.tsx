"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ROLE_LABEL, ROLE_SHORT, formatDate } from "@/lib/roster";
import { deleteAbsence } from "@/app/(app)/roster/absences/actions";
import type {
  AwayAbsence,
  AwayClash,
  BandRoleChoice,
  Candidate,
  CoverCandidate,
  CoverItem,
  HandoverItem,
  PendingRequest,
  Proposal,
  RequestsBoard as Board,
  SwapOption,
} from "@/lib/serving";
import {
  acceptHandover,
  acceptServe,
  acceptSwap,
  coverWhileAway,
  reaskHandover,
  refuseHandover,
  declineServe,
  declineSwap,
  addCover,
  editDirect,
  proposeSwap,
  takeDownCover,
  swapOptionsForAbsence,
  swapOptionsForCover,
  swapOptionsForRequest,
  type ServeResult,
} from "@/app/(app)/roster/serving-actions";

const when = (date: string) => formatDate(date, { weekday: "short", day: "numeric", month: "short" });
/** " · rehearsal Tue 10 Nov" for sessions with a rehearsal. */
const rehearsal = (s: { rehearsal?: string | null }) => (s.rehearsal ? ` · rehearsal ${when(s.rehearsal)}` : "");
const part = (role: string) => ROLE_LABEL[role] ?? role;

/** Band leader / talkback they're also doing, as +BL / +TB like on the roster. */
function BandTags({ roles }: { roles: { role: string }[] }) {
  return (
    <>
      {roles.map((r) => (
        <span key={r.role} className="ml-1 font-semibold text-accent" title={ROLE_LABEL[r.role]}>
          +{ROLE_SHORT[r.role] ?? r.role}
        </span>
      ))}
    </>
  );
}

/**
 * A request with its buttons on the right. When the board is too narrow for any one request's text
 * and buttons to share a line, every request puts its buttons on a row of their own underneath
 * (right-aligned), so they all look the same (see useStackedRows).
 */
function Row({ title, sub, children }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-x-3 gap-y-2 px-4 py-3 group-data-[stacked]/requests:flex-col group-data-[stacked]/requests:items-stretch">
      <div data-row-text className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      {children && (
        <div data-row-actions className="flex shrink-0 items-center gap-2 group-data-[stacked]/requests:justify-end">
          {children}
        </div>
      )}
    </li>
  );
}

/**
 * Whether the board's request rows should put their buttons underneath: true when, for any row, the
 * text on one line plus its buttons is wider than the row. Re-checked when the board resizes or its
 * rows change. It measures the text's natural width, so stacking doesn't change the answer.
 */
function useStackedRows(ref: React.RefObject<HTMLDivElement | null>, deps: unknown) {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const board = ref.current;
    if (!board) return;
    const measure = () => {
      let tooWide = false;
      for (const actions of board.querySelectorAll<HTMLElement>("[data-row-actions]")) {
        const row = actions.parentElement!;
        const text = row.querySelector<HTMLElement>("[data-row-text]");
        if (!text) continue;
        const style = getComputedStyle(row);
        // Exact (fractional) widths: rounding can say "fits" when the text actually wraps by a hair.
        const room = row.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const gap = parseFloat(style.columnGap) || 0;
        // The text's width on one line, without letting it show.
        const { whiteSpace, width } = text.style;
        text.style.whiteSpace = "nowrap";
        text.style.width = "max-content";
        const needed = Math.ceil(text.getBoundingClientRect().width) + gap + actions.getBoundingClientRect().width;
        text.style.whiteSpace = whiteSpace;
        text.style.width = width;
        if (needed > room) {
          tooWide = true;
          break;
        }
      }
      setStacked(tooWide);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(board);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [ref, deps]);
  return stacked;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="bg-background px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

export const btn = "inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium disabled:opacity-60";

/** Run a server action, showing its message. */
function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ServeResult | null>(null);
  const run = (fn: () => Promise<ServeResult>, then?: (r: ServeResult) => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      then?.(r);
    });
  return { pending, result, run };
}

/** Load the swap dates for a person (null = nobody picked). */
export function useSwapOptions(load: ((id: string) => Promise<SwapOption[]>) | null, personId: string | null) {
  const [state, setState] = useState<{ for: string | null; options: SwapOption[] }>({ for: null, options: [] });
  useEffect(() => {
    if (!load || !personId) return;
    let live = true;
    load(personId).then((options) => live && setState({ for: personId, options }));
    return () => {
      live = false;
    };
  }, [load, personId]);
  return { loading: Boolean(personId) && state.for !== personId, options: state.for === personId ? state.options : [] };
}

export function SwapSelect({
  options,
  loading,
  value,
  onChange,
  name,
  required = false,
}: {
  options: SwapOption[];
  loading: boolean;
  value: string;
  onChange: (v: string) => void;
  name: string;
  /** Proposing a date: there's no "no swap" choice. */
  required?: boolean;
}) {
  if (loading) return <p className="text-xs text-muted">Loading {name}&apos;s sessions…</p>;
  return (
    <label className="block text-sm">
      <span className="font-medium">{required ? "Swap date" : "Offer a swap"}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm">
        <option value="">{required ? "Choose a date…" : "No swap: ask them to take over"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            I take {name}&apos;s {part(o.role)} on {when(o.date)} ({o.name}{rehearsal(o)})
          </option>
        ))}
      </select>
      {!options.length && <span className="mt-1 block text-xs text-muted">None of {name}&apos;s sessions can be swapped with you.</span>}
    </label>
  );
}

const short = (role: string) => ROLE_SHORT[role] ?? role;

/**
 * One person in a "who to ask" list. Greyed out (and not pickable) if they're away, already serving,
 * or can't do any of the band leader / talkback that come with the place; otherwise, which of those
 * they'd take over too, and their load this quarter (session weights added up). ★ marks the one to ask.
 */
function candidateLabel(c: CoverCandidate) {
  if (c.unavailable === "absent") return `${c.name} (absent)`;
  if (c.unavailable === "serving") return `${c.name} (already serving)`;
  if (c.unavailable === "band") return `${c.name} (can't do ${(c.withPlace ?? []).map(short).join(" or ")})`;
  const band = c.bandRoles.length ? ` (${c.bandRoles.map((r) => `+${short(r)}`).join(" ")})` : "";
  const load = c.load === undefined ? "" : ` · load ${c.load} this quarter`;
  return `${c.recommended ? "★ " : ""}${c.name}${band}${load}`;
}

export function CandidateOptions({ candidates, keep }: { candidates: CoverCandidate[]; keep?: string | null }) {
  return (
    <>
      {candidates.map((c) => (
        <option key={c.id} value={c.id} disabled={Boolean(c.unavailable) && c.id !== keep}>
          {candidateLabel(c)}
        </option>
      ))}
    </>
  );
}

/** The band leader / talkback that come with the place (nobody else in the band can take them). */
const withPlace = (cs: CoverCandidate[]) => cs.find((c) => c.withPlace?.length)?.withPlace ?? [];

/** Band leader / talkback that come with the place: whoever covers it takes over what they can. */
export function WithPlaceNote({ candidates }: { candidates: CoverCandidate[] }) {
  const roles = withPlace(candidates);
  const star = candidates.find((c) => c.recommended);
  return (
    <>
      {star && (
        <span className="mt-1 block text-xs text-muted">
          ★ Recommended: {star.name}, who has the lightest load this quarter of everyone free.
        </span>
      )}
      {roles.length > 0 && (
        <span className="mt-1 block text-xs text-muted">
          Nobody else in the band can do {roles.map(part).join(" or ")}, so whoever covers you takes over {roles.length > 1 ? "the ones they can" : "it"} too.
        </span>
      )}
    </>
  );
}

const anyFree = (cs: CoverCandidate[]) => cs.some((c) => !c.unavailable);

/** Band leader / talkback choices, keyed by role: who to ask to take each over. */
export type BandPicks = Record<string, string>;

/** Every band role has someone to ask, or nobody can (then root and admins are told). */
export function bandPicksReady(roles: BandRoleChoice[], picks: BandPicks) {
  return roles.every((r) => r.candidates.length <= 1 || Boolean(picks[r.role]));
}

export function bandPicksFor(roles: BandRoleChoice[], picks: BandPicks) {
  return roles.map((r) => ({ role: r.role, targetId: picks[r.role] || (r.candidates.length === 1 ? r.candidates[0]!.id : null) }));
}

/**
 * They're also band leader / talkback: who in the band takes each over, before the instrument is
 * sorted. One person who can: they're asked. Several: choose. Nobody: root and admins are told.
 */
export function BandRolePicker({ roles, picks, onChange }: { roles: BandRoleChoice[]; picks: BandPicks; onChange: (p: BandPicks) => void }) {
  if (!roles.length) return null;
  return (
    <fieldset className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
      <legend className="px-1 text-sm font-medium">Your band roles</legend>
      <p className="text-xs text-muted">These are handed to someone else in the band first, then your part is covered as usual.</p>
      {roles.map((r) => {
        const label = part(r.role);
        if (!r.candidates.length) {
          return (
            <p key={r.role} className="text-sm text-orange-800">
              Nobody else in this band can be {label}: root and admins will be told.
            </p>
          );
        }
        if (r.candidates.length === 1) {
          return (
            <p key={r.role} className="text-sm">
              <span className="font-medium">{r.candidates[0]!.name}</span> will be asked to take over {label}.
            </p>
          );
        }
        return (
          <label key={r.role} className="block text-sm">
            <span className="font-medium">Who takes over {label}?</span>
            <select
              value={picks[r.role] ?? ""}
              onChange={(e) => onChange({ ...picks, [r.role]: e.target.value })}
              required
              className="mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
            >
              <option value="">Choose someone…</option>
              {r.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Choose one person to ask directly to swap or take over. */
export function RoutePicker({
  candidates,
  target,
  setTarget,
}: {
  candidates: CoverCandidate[];
  target: string;
  setTarget: (t: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">Ask someone to swap or take over</span>
      {anyFree(candidates) ? (
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
          className="mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
          aria-label="Who to ask"
        >
          <option value="">Choose a person…</option>
          <CandidateOptions candidates={candidates} />
        </select>
      ) : (
        <span className="mt-1 block text-xs text-muted">Nobody else who plays this part is free that day. Ask a leader to find cover.</span>
      )}
      <WithPlaceNote candidates={candidates} />
    </label>
  );
}

/** Which day(s) "can't serve" marks them away: the service day, its rehearsal day, or a range. */
type AwayPick = "service" | "rehearsal" | "range";

function AwayDays({
  session,
  pick,
  setPick,
  range,
  setRange,
}: {
  session: { date: string; rehearsal?: string | null };
  pick: AwayPick;
  setPick: (p: AwayPick) => void;
  range: { startsOn: string; endsOn: string };
  setRange: (r: { startsOn: string; endsOn: string }) => void;
}) {
  const input = "mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm font-normal";
  return (
    <div className="space-y-2 text-sm">
      <label className="block font-medium">
        Day you&apos;re away
        <select value={pick} onChange={(e) => setPick(e.target.value as AwayPick)} className={input}>
          <option value="service">Service day: {when(session.date)}</option>
          {session.rehearsal && <option value="rehearsal">Rehearsal day: {when(session.rehearsal)}</option>}
          <option value="range">A range of dates…</option>
        </select>
      </label>
      {pick === "range" && (
        <div className="flex gap-2">
          <label className="block flex-1 font-medium">
            From
            <input
              type="date"
              value={range.startsOn}
              max={range.endsOn || undefined}
              onChange={(e) => setRange({ ...range, startsOn: e.target.value })}
              required
              className={input}
            />
          </label>
          <label className="block flex-1 font-medium">
            To
            <input
              type="date"
              value={range.endsOn}
              min={range.startsOn || undefined}
              onChange={(e) => setRange({ ...range, endsOn: e.target.value })}
              required
              className={input}
            />
          </label>
        </div>
      )}
      <span className="block text-xs text-muted">This also adds an absence on {pick === "range" ? "these dates" : "that day"} to your schedule.</span>
    </div>
  );
}

function DeclineDialog({ request, onClose }: { request: PendingRequest; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [awayPick, setAwayPick] = useState<AwayPick>("service");
  const [range, setRange] = useState(() => ({
    startsOn: request.session.rehearsal && request.session.rehearsal < request.session.date ? request.session.rehearsal : request.session.date,
    endsOn: request.session.rehearsal && request.session.rehearsal > request.session.date ? request.session.rehearsal : request.session.date,
  }));
  const [target, setTarget] = useState("");
  const [offer, setOffer] = useState("");
  const [bandPicks, setBandPicks] = useState<BandPicks>({});
  const { pending, result, run } = useAction();
  const [load] = useState(() => (id: string) => swapOptionsForRequest(request.id, id));
  const swap = useSwapOptions(load, target || null);
  const targetName = request.candidates.find((c) => c.id === target)?.name ?? "";
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  const away =
    awayPick === "range"
      ? range
      : awayPick === "rehearsal" && request.session.rehearsal
        ? { startsOn: request.session.rehearsal, endsOn: request.session.rehearsal }
        : { startsOn: request.session.date, endsOn: request.session.date };
  const awayReady = Boolean(away.startsOn && away.endsOn && away.startsOn <= away.endsOn);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(
      () =>
        declineServe({
          requestId: request.id,
          reason,
          targetId: target,
          offerSessionId: offer || null,
          bandRoles: bandPicksFor(request.bandRoles, bandPicks),
          away,
        }),
      (r) => r.ok && onClose(),
    );
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label="Can't serve"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <form onSubmit={submit} className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">Can&apos;t serve?</h2>
          <p className="text-sm text-muted">
            {request.session.name}, {when(request.session.date)}
            {rehearsal(request.session)} · {part(request.role)}
            <BandTags roles={request.bandRoles} />
          </p>
        </div>
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
        <AwayDays session={request.session} pick={awayPick} setPick={setAwayPick} range={range} setRange={setRange} />
        <BandRolePicker roles={request.bandRoles} picks={bandPicks} onChange={setBandPicks} />
        <RoutePicker
          candidates={request.candidates}
          target={target}
          setTarget={(t) => {
            setTarget(t);
            setOffer("");
          }}
        />
        {target && <SwapSelect options={swap.options} loading={swap.loading} value={offer} onChange={setOffer} name={targetName} />}
        {result && !result.ok && (
          <p role="alert" className="text-sm text-danger">
            {result.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => ref.current?.close()} className={`${btn} border border-border bg-surface`}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !reason.trim() || !target || !awayReady || !bandPicksReady(request.bandRoles, bandPicks)}
            className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}
          >
            {pending ? "Sending…" : offer ? "Propose swap" : "Send request"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function PendingRow({ r, onDecline }: { r: PendingRequest; onDecline: () => void }) {
  const { pending, result, run } = useAction();
  return (
    <Row
      title={`${r.session.name}, ${when(r.session.date)}`}
      sub={
        <>
          {part(r.role)}
          <BandTags roles={r.bandRoles} />
          {result && !result.ok && <span className="ml-2 text-danger">{result.message}</span>}
        </>
      }
    >
      <button
        type="button"
        onClick={() => run(() => acceptServe(r.id))}
        disabled={pending}
        aria-label={`I can serve: ${r.session.name}, ${when(r.session.date)}`}
        title="I can serve"
        className="inline-flex size-9 items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 text-lg text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={onDecline}
        disabled={pending}
        aria-label={`I can't serve: ${r.session.name}, ${when(r.session.date)}`}
        title="I can't serve"
        className="inline-flex size-9 items-center justify-center rounded-full border border-red-300 bg-red-50 text-lg text-red-700 hover:bg-red-100 disabled:opacity-60"
      >
        ✗
      </button>
    </Row>
  );
}

/** Someone else's request: opens the calendar on that day, where the viewer takes over or swaps. */
function CoverLink({ c, title, note }: { c: CoverItem; title: string; note?: string }) {
  return (
    <li>
      <Link href={`/roster/absences?cover=${c.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 hover:bg-background">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted">
            {c.session.name}, {when(c.session.date)}
            {rehearsal(c.session)}
            {c.proposals.some((p) => !p.byMe) && <span className="ml-2 font-medium text-orange-700">Swap proposed to you</span>}
            {c.proposals.some((p) => p.byMe) && <span className="ml-2">You proposed a swap</span>}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted">{note ?? <span className="text-sm font-medium text-foreground">View →</span>}</span>
      </Link>
    </li>
  );
}

/** A swap proposal on the viewer's own request. */
function ProposalRow({ c, p }: { c: CoverItem; p: Proposal }) {
  const { pending, result, run } = useAction();
  const [countering, setCountering] = useState(false);
  const [offer, setOffer] = useState("");
  const [load] = useState(() => (id: string) => swapOptionsForCover(c.id, id));
  const swap = useSwapOptions(load, countering ? p.counterpart.id : null);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      {p.byMe ? (
        <p>
          You proposed taking <span className="font-medium">{p.counterpart.name}</span>&apos;s {part(p.offer.role)} on{" "}
          <span className="font-medium">{when(p.offer.date)}</span>. Waiting for them to approve.
        </p>
      ) : (
        <>
          <p>
            <span className="font-medium">{p.counterpart.name}</span> offers a swap: they take your {part(c.role)} on {when(c.session.date)}, you take their{" "}
            {part(p.offer.role)} on <span className="font-medium">{when(p.offer.date)}</span> ({p.offer.name}).
          </p>
          {!countering && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={() => run(() => acceptSwap(p.id))} className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}>
                Approve swap
              </button>
              <button type="button" disabled={pending} onClick={() => setCountering(true)} className={`${btn} border border-border bg-surface`}>
                Propose another date
              </button>
              <button type="button" disabled={pending} onClick={() => run(() => declineSwap(p.id))} className={`${btn} text-muted hover:text-foreground`}>
                Decline
              </button>
            </div>
          )}
        </>
      )}
      {countering && (
        <div className="space-y-2">
          <SwapSelect options={swap.options} loading={swap.loading} value={offer} onChange={setOffer} name={p.counterpart.name} required />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCountering(false)} className={`${btn} border border-border bg-surface`}>
              Back
            </button>
            <button
              type="button"
              disabled={pending || !offer}
              onClick={() => run(() => proposeSwap({ coverId: c.id, counterpartId: p.counterpart.id, offerSessionId: offer }), (r) => r.ok && setCountering(false))}
              className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}
            >
              Propose date
            </button>
          </div>
        </div>
      )}
      {result && !result.ok && <p className="text-danger">{result.message}</p>}
    </div>
  );
}

/** Pick a person and, optionally, a swap date to offer them. */
function DirectEditor({
  candidates,
  initialTarget,
  initialOffer = "",
  load,
  saveLabel,
  onSave,
  onCancel,
  pending,
}: {
  candidates: CoverCandidate[];
  initialTarget: Candidate | null;
  /** The swap date already offered (session id), so editing starts from it. */
  initialOffer?: string;
  load: (personId: string) => Promise<SwapOption[]>;
  saveLabel: string;
  onSave: (targetId: string, offerSessionId: string | null) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  // The person already asked stays in the list even if they no longer show as free.
  const people: CoverCandidate[] =
    initialTarget && !candidates.some((c) => c.id === initialTarget.id) ? [{ ...initialTarget, bandRoles: [] }, ...candidates] : candidates;
  const [target, setTarget] = useState(initialTarget?.id ?? "");
  const [offer, setOffer] = useState(initialOffer);
  const swap = useSwapOptions(load, target || null);
  const name = people.find((c) => c.id === target)?.name ?? "";
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/50 p-3">
      <label className="block text-sm">
        <span className="font-medium">Ask</span>
        {anyFree(people) || initialTarget ? (
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setOffer("");
            }}
            className="mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
          >
            <option value="">Choose a person…</option>
            <CandidateOptions candidates={people} keep={initialTarget?.id} />
          </select>
        ) : (
          <span className="mt-1 block text-xs text-muted">Nobody else who plays this part is free that day.</span>
        )}
        <WithPlaceNote candidates={people} />
      </label>
      {target && <SwapSelect options={swap.options} loading={swap.loading} value={offer} onChange={setOffer} name={name} />}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${btn} border border-border bg-surface`}>
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || !target}
          onClick={() => onSave(target, offer || null)}
          className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

/** One of the viewer's own requests (a direct ask or a board post): click it to edit or take it down. */
function MineItem({ c, last }: { c: CoverItem; last: boolean }) {
  const { pending, result, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [confirmDown, setConfirmDown] = useState(false);
  // The only request left for a session they're away for can't just come down.
  const [awayClash, setAwayClash] = useState(false);
  const [load] = useState(() => (id: string) => swapOptionsForCover(c.id, id));
  const direct = Boolean(c.target);
  const myOffer = c.proposals.find((p) => p.byMe);
  const status = direct
    ? c.status === "refused"
      ? `${c.target!.name} can't cover it.`
      : myOffer
        ? `Asked ${c.target!.name} to swap: you'd take their ${part(myOffer.offer.role)} on ${when(myOffer.offer.date)}.`
        : `Asked ${c.target!.name} to take over. Waiting for them.`
    : "An old requests-board post. Nobody else sees these any more: ask someone directly instead.";

  const what = direct ? "direct request" : "board post";
  const icon = "inline-flex size-8 shrink-0 items-center justify-center rounded-full";

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface py-1.5 pl-3 pr-1.5">
        <span
          className={`mt-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${direct ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}
        >
          {direct ? "Direct" : "Board"}
        </span>
        <span className={`min-w-0 flex-1 py-1 text-sm ${c.status === "refused" ? "text-danger" : ""}`}>{status}</span>
        {/* A board post has nothing to edit: it only comes down. */}
        {direct && (
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setConfirmDown(false);
            }}
            aria-expanded={editing}
            aria-label={editing ? `Stop editing ${what}` : `Edit ${what}`}
            title="Edit"
            className={`${icon} ${editing ? "bg-ink text-ink-foreground" : "text-muted hover:bg-background hover:text-foreground"}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            if (last && c.away) setAwayClash(true);
            else setConfirmDown((v) => !v);
          }}
          aria-expanded={confirmDown}
          aria-label={`Take down ${what}`}
          title="Take down"
          className={`${icon} ${confirmDown ? "bg-red-100 text-danger" : "text-muted hover:bg-red-50 hover:text-danger"}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18" />
            <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
            <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      </div>

      {confirmDown && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
          <span className="mr-auto">Take this {what} down?</span>
          <button type="button" onClick={() => setConfirmDown(false)} className={`${btn} border border-border bg-surface`}>
            Keep
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => takeDownCover(c.id))} className={`${btn} bg-danger text-white`}>
            Take down
          </button>
        </div>
      )}

      {/* Swap offers from the other side wait for an answer here. */}
      {c.proposals
        .filter((p) => !p.byMe)
        .map((p) => (
          <ProposalRow key={p.id} c={c} p={p} />
        ))}

      {editing && direct && (
        <DirectEditor
          candidates={c.candidates ?? []}
          initialTarget={c.status === "open" ? c.target : null}
          initialOffer={c.status === "open" ? (myOffer?.offer.id ?? "") : ""}
          load={load}
          saveLabel="Save"
          pending={pending}
          onCancel={() => setEditing(false)}
          onSave={(targetId, offerSessionId) => run(() => editDirect({ coverId: c.id, targetId, offerSessionId }), (r) => r.ok && setEditing(false))}
        />
      )}
      {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
      {awayClash && <AwayClashDialog c={c} onClose={() => setAwayClash(false)} />}
    </div>
  );
}

/** One session the viewer can't serve: their direct request and/or board post for it. */
function MinePlace({ items }: { items: CoverItem[] }) {
  const first = items[0]!;
  const { pending, result, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [load] = useState(() => (id: string) => swapOptionsForCover(first.id, id));
  // A turned-down direct request is replaced by editing it, so it counts as having one.
  const hasDirect = items.some((c) => c.target);
  return (
    <li className="space-y-2 px-4 py-3">
      <p className="text-sm font-medium">
        Your {part(first.role)}: {first.session.name}, {when(first.session.date)}
      </p>
      {items.map((c) => (
        <MineItem key={`${c.id}-${c.status}-${c.proposals.map((p) => p.id).join()}`} c={c} last={items.length === 1} />
      ))}
      {adding && (
        <DirectEditor
          candidates={first.candidates ?? []}
          initialTarget={null}
          load={load}
          saveLabel="Send request"
          pending={pending}
          onCancel={() => setAdding(false)}
          onSave={(targetId, offerSessionId) => run(() => addCover({ sessionId: first.session.id, targetId, offerSessionId }), (r) => r.ok && setAdding(false))}
        />
      )}
      {!adding && !hasDirect && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAdding(true)} className={`${btn} border border-border bg-surface`}>
            + Ask someone directly
          </button>
        </div>
      )}
      {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
    </li>
  );
}

/** The viewer's requests, one group per session, the direct request first. */
function groupBySession(items: CoverItem[]) {
  const groups = new Map<string, CoverItem[]>();
  for (const c of items) groups.set(c.session.id, [...(groups.get(c.session.id) ?? []), c]);
  return [...groups.values()].map((g) => g.sort((a, b) => Number(!a.target) - Number(!b.target)));
}

/**
 * Away for a session they're still on: ask someone directly and hand over
 * band leader / talkback, or delete the absence if they can make it after all. With `replace`, it's
 * standing in for taking that request down (the dustbin): the new ask goes out, then it comes down.
 */
function AwayFix({
  session,
  role,
  absence,
  candidates,
  bandRoles,
  replace,
  onDone,
}: {
  session: SessionInfoLike;
  role: string;
  absence: AwayAbsence;
  candidates: CoverCandidate[];
  bandRoles: BandRoleChoice[];
  replace?: CoverItem;
  onDone?: () => void;
}) {
  const { pending, result, run } = useAction();
  const [target, setTarget] = useState("");
  const [offer, setOffer] = useState("");
  const [band, setBand] = useState<BandPicks>({});
  const [load] = useState(() => (id: string) => swapOptionsForAbsence(session.id, id, { startsOn: absence.startsOn, endsOn: absence.endsOn }));
  const swap = useSwapOptions(load, target || null);
  const name = candidates.find((c) => c.id === target)?.name ?? "";
  const oneDay = absence.startsOn === absence.endsOn;
  const days = oneDay ? when(absence.startsOn) : `${when(absence.startsOn)} – ${when(absence.endsOn)}`;
  const ready = bandPicksReady(bandRoles, band);
  const send = (targetId: string) =>
    run(
      () =>
        coverWhileAway({
          sessionId: session.id,
          targetId,
          offerSessionId: offer || null,
          bandRoles: bandPicksFor(bandRoles, band),
          replaceCoverId: replace?.id ?? null,
        }),
      (r) => r.ok && onDone?.(),
    );
  const removeAbsence = () =>
    run(
      async () => {
        const r = await deleteAbsence(absence.id);
        return { ok: r.ok, message: r.message };
      },
      (r) => r.ok && onDone?.(),
    );

  return (
    <div className="space-y-3">
      <p className="text-sm">
        You&apos;re away on {days}
        {absence.reason && <span className="text-muted"> ({absence.reason})</span>} but still on the roster for{" "}
        <span className="font-medium">
          {session.name}, {when(session.date)}
        </span>{" "}
        as {part(role)}
        <BandTags roles={bandRoles} />.{" "}
        {replace ? "Taking this request down would leave nobody being asked to cover it." : "Nobody is being asked to cover it."}
      </p>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">{replace ? "Ask someone directly instead" : "Ask someone to cover"}</p>
        <BandRolePicker roles={bandRoles} picks={band} onChange={setBand} />
        {anyFree(candidates) ? (
          <label className="block text-sm">
            <span className="font-medium">Ask</span>
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setOffer("");
              }}
              className="mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
            >
              <option value="">Choose a person…</option>
              <CandidateOptions candidates={candidates} />
            </select>
            <WithPlaceNote candidates={candidates} />
          </label>
        ) : (
          <p className="text-xs text-muted">Nobody else who plays this part is free that day.</p>
        )}
        {target && <SwapSelect options={swap.options} loading={swap.loading} value={offer} onChange={setOffer} name={name} />}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={pending || !target || !ready} onClick={() => send(target)} className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}>
            {offer ? "Propose swap" : "Send request"}
            {replace && !replace.target ? " and take down the board post" : ""}
          </button>
        </div>
      </div>

      <div className="space-y-1 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">Can make it after all?</p>
        <button type="button" disabled={pending} onClick={removeAbsence} className={`${btn} border border-red-200 bg-red-50 text-danger hover:bg-red-100`}>
          Delete my absence ({days})
        </button>
        {!oneDay && (
          <p className="text-xs text-muted">
            This deletes the whole absence. To change only some days,{" "}
            <Link href="/roster/absences" className="underline underline-offset-2">
              edit it in Absences
            </Link>
            .
          </p>
        )}
      </div>
      {result && !result.ok && (
        <p role="alert" className="text-sm text-danger">
          {result.message}
        </p>
      )}
    </div>
  );
}

type SessionInfoLike = { id: string; date: string; name: string; rehearsal?: string | null };

/** The dustbin on the last request for a session they're still away for: a popup instead of taking it down. */
function AwayClashDialog({ c, onClose }: { c: CoverItem; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-labelledby="away-clash-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <div className="max-h-[85dvh] space-y-4 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-2">
          <h2 id="away-clash-title" className="text-lg font-semibold">
            Your absence still clashes
          </h2>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="-mr-2 rounded-full p-2 text-muted hover:bg-background">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <AwayFix
          session={c.session}
          role={c.role}
          absence={c.away!}
          candidates={c.candidates ?? []}
          bandRoles={c.bandRoles ?? []}
          replace={c}
          onDone={() => ref.current?.close()}
        />
      </div>
    </dialog>
  );
}

/** A bandmate asking you to take over their band leader / talkback. */
function HandoverInRow({ h }: { h: HandoverItem }) {
  const { pending, result, run } = useAction();
  return (
    <Row
      title={`${h.from.name} asked you to take over ${part(h.role)}`}
      sub={
        <>
          {h.session.name}, {when(h.session.date)}
          {rehearsal(h.session)}
          {result && !result.ok && <span className="ml-2 text-danger">{result.message}</span>}
        </>
      }
    >
      <button type="button" disabled={pending} onClick={() => run(() => refuseHandover(h.id))} className={`${btn} border border-border bg-surface`}>
        Can&apos;t
      </button>
      <button type="button" disabled={pending} onClick={() => run(() => acceptHandover(h.id))} className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}>
        Take over
      </button>
    </Row>
  );
}

/** Your own band leader / talkback handover: waiting, or turned down (ask someone else). */
function HandoverMineRow({ h }: { h: HandoverItem }) {
  const { pending, result, run } = useAction();
  const [target, setTarget] = useState("");
  const refused = h.status === "refused";
  return (
    <li className="space-y-2 px-4 py-3">
      <div>
        <p className="text-sm font-medium">
          {part(h.role)}: {h.session.name}, {when(h.session.date)}
        </p>
        <p className={`text-xs ${refused ? "text-danger" : "text-muted"}`}>
          {refused ? `${h.target.name} can't take it over.` : `Asked ${h.target.name} to take it over. Waiting for them.`}
        </p>
      </div>
      {refused &&
        (h.candidates?.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={`Who to ask to take over ${part(h.role)}`}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-sm"
            >
              <option value="">Ask someone else…</option>
              {h.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !target}
              onClick={() => run(() => reaskHandover({ sessionId: h.session.id, role: h.role, targetId: target }))}
              className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}
            >
              Ask
            </button>
          </div>
        ) : (
          <p className="text-xs text-orange-800">Nobody else in this band can do it. Root and admins have been told.</p>
        ))}
      {result && !result.ok && <p className="text-xs text-danger">{result.message}</p>}
    </li>
  );
}

export function RequestsBoard({ board, before }: { board: Board; /** Shown above the requests (root's broadcasts). */ before?: React.ReactNode }) {
  const [declining, setDeclining] = useState<PendingRequest | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stacked = useStackedRows(listRef, board);
  const empty =
    !before &&
    !board.pending.length &&
    !board.incoming.length &&
    !board.mine.length &&
    !board.handoversIn.length &&
    !board.handoversMine.length &&
    !board.awayUncovered.length;
  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-sm text-center text-sm text-muted">No requests right now.</p>
      </div>
    );
  }
  return (
    <div ref={listRef} data-stacked={stacked || undefined} className="group/requests flex-1 overflow-y-auto">
      {before}
      {board.awayUncovered.length > 0 && (
        <Section label="Away but still rostered">
          {board.awayUncovered.map((a: AwayClash) => (
            <li key={a.session.id} className="bg-red-50/60 px-4 py-3">
              <AwayFix session={a.session} role={a.role} absence={a.absence} candidates={a.candidates} bandRoles={a.bandRoles} />
            </li>
          ))}
        </Section>
      )}
      {board.pending.length > 0 && (
        <Section label="Can you serve?">
          {board.pending.map((r) => (
            <PendingRow key={r.id} r={r} onDecline={() => setDeclining(r)} />
          ))}
        </Section>
      )}
      {board.handoversIn.length > 0 && (
        <Section label="Asked to take over a band role">
          {board.handoversIn.map((h) => (
            <HandoverInRow key={h.id} h={h} />
          ))}
        </Section>
      )}
      {board.incoming.length > 0 && (
        <Section label="Asked to cover">
          {board.incoming.map((c) => (
            <CoverLink key={c.id} c={c} title={`${c.from.name} asked you to cover ${part(c.role)}`} />
          ))}
        </Section>
      )}
      {board.handoversMine.length > 0 && (
        <Section label="Your band roles">
          {board.handoversMine.map((h) => (
            <HandoverMineRow key={h.id} h={h} />
          ))}
        </Section>
      )}
      {board.mine.length > 0 && (
        <Section label="Your requests">
          {groupBySession(board.mine).map((items) => (
            <MinePlace key={items[0]!.session.id} items={items} />
          ))}
        </Section>
      )}
      {declining && <DeclineDialog key={declining.id} request={declining} onClose={() => setDeclining(null)} />}
    </div>
  );
}
