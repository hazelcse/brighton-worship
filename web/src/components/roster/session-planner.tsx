"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addSession, deleteSession, setSessionCancelled, setDefaultsForSessions, updateSession } from "@/app/(app)/roster/actions";
import {
  ATTACHED_ROLES,
  MINISTRY_LABEL,
  addDays,
  defaultRehearsalTime,
  defaultStartTime,
  formatTime,
  ROLES,
  SESSION_TYPES,
  compositionSummary,
  formatDate,
  headcount,
  usesMinistry,
  type Composition,
  type Ministry,
  type SessionKind,
} from "@/lib/roster";
import { ROLE_LABEL as CATALOGUE_LABEL, presetKinds, rolesNoun, sessionTypeFor, splitsMinistry, type TeamConfig } from "@/lib/team-config";
import { LinkAfterAdding, LinkedServiceField } from "@/components/roster/service-link";

/**
 * What a session's people are on this team: the band's parts (worship teams), or a media team's roles
 * in the team's order, as a "crew". Set by SessionPlanner for everything inside it.
 */
type Parts = { crew: boolean; list: readonly { value: string; label: string }[] };
const BAND_PARTS: Parts = { crew: false, list: ROLES };
const PartsContext = createContext<Parts>(BAND_PARTS);
function partsFor(config: TeamConfig | undefined): Parts {
  if (!config || rolesNoun(config) === "Instruments") return BAND_PARTS;
  return { crew: true, list: config.roles.map((r) => ({ value: r, label: CATALOGUE_LABEL[r] ?? r })) };
}

export type PlannerSession = {
  id: string;
  date: string;
  kind: SessionKind;
  name: string;
  ministry: Ministry;
  weight: number;
  composition: Composition;
  cancelled: boolean;
  /** Why it isn't happening (e.g. "REKINDLE 2026"); empty while it's on. */
  cancel_reason: string;
  note: string;
  /** The band's rehearsal for this session (null = none). */
  rehearsal_date: string | null;
  /** "HH:MM"; null = the default for its kind, if it has one. */
  start_time: string | null;
  rehearsal_time: string | null;
  /** An ad hoc service linked to other teams' (lib/service-links.ts): those teams' names. */
  linkedTeams?: string[];
};

const MINISTRY_STYLE: Record<Ministry, string> = {
  em: "bg-sky-100 text-sky-800",
  cm: "bg-rose-100 text-rose-800",
  any: "bg-violet-100 text-violet-800",
};

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export type Draft = Omit<PlannerSession, "id" | "kind"> & { id: string | null; kind: SessionKind };

/** Someone rostered on a session: their part, and band leader / talkback on top. */
export type BandMember = { member_id: string; name: string; role: string; also_roles: string[] };

/** A new, empty session on this date. */
export function newSessionDraft(date: string): Draft {
  return {
    id: null,
    kind: "custom",
    date,
    name: "",
    ministry: "any",
    weight: 1,
    composition: {},
    cancelled: false,
    cancel_reason: "",
    note: "",
    rehearsal_date: null,
    start_time: null,
    rehearsal_time: null,
  };
}

/** What the session form saves (a new session's details). */
export type SessionPayload = {
  date: string;
  name: string;
  ministry: Ministry;
  weight: number;
  composition: Composition;
  note: string;
  rehearsal_date: string | null;
  start_time: string | null;
  rehearsal_time: string | null;
};

/**
 * A time for the "See you at … tomorrow" reminder. Empty = the default for the session's kind
 * (shown as the hint), or no time at all if it has none.
 */
function TimeField({
  id,
  label,
  value,
  fallback,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  fallback: string | null;
  onChange: (t: string | null) => void;
}) {
  return (
    <div className="space-y-1 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="time" value={value ?? fallback ?? ""} onChange={(e) => onChange(e.target.value || null)} className={input} />
      <p className="flex flex-wrap items-center justify-between gap-x-3 text-xs font-normal text-muted">
        <span>{value ? "Shown in reminders the day before." : fallback ? `Default ${formatTime(fallback)}.` : "No time set: reminders won't give one."}</span>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="underline underline-offset-2 hover:text-foreground">
            {fallback ? `Reset to ${formatTime(fallback)}` : "No time"}
          </button>
        )}
      </p>
    </div>
  );
}

/** + / − counters for each part of the band (a media team: each role in the crew). */
function BandEditor({ composition, onBump }: { composition: Composition; onBump: (role: string, delta: number) => void }) {
  const { list } = useContext(PartsContext);
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {list.map((r) => (
        <li key={r.value} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5">
          <span className="text-sm">
            {r.label}
            {ATTACHED_ROLES.includes(r.value) && <span className="block text-xs text-muted">also plays an instrument</span>}
          </span>
          <span className="flex items-center gap-1">
            <button type="button" aria-label={`Fewer ${r.label}`} onClick={() => onBump(r.value, -1)} className="h-7 w-7 rounded-md border border-border text-sm">
              −
            </button>
            <output className="w-6 text-center text-sm font-semibold">{composition[r.value] ?? 0}</output>
            <button type="button" aria-label={`More ${r.label}`} onClick={() => onBump(r.value, 1)} className="h-7 w-7 rounded-md border border-border text-sm">
              +
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Reasons offered when marking a session as no session (plus any already used in this roster). */
const STOCK_REASONS = ["NO SERVICE"];

/**
 * Why a session isn't happening (e.g. "REKINDLE 2026", "NO SERVICE"): required to mark it as no
 * session. It shows in the planner and in session tracking.
 */
function NoSessionReason({
  name,
  date,
  reasons,
  pending,
  onConfirm,
  onCancel,
}: {
  name: string;
  date: string;
  /** Reasons already used in this roster, offered as quick picks. */
  reasons: string[];
  pending: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const picks = [...new Set([...reasons, ...STOCK_REASONS].map((r) => r.trim()).filter(Boolean))];
  const id = `reason-${date}-${name.replace(/\W+/g, "-")}`;
  const submit = () => {
    setTried(true);
    if (reason.trim()) onConfirm(reason.trim());
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm font-medium">
          Why is there no {name || "session"} on {formatDate(date, { weekday: "short", day: "numeric", month: "short" })}?
        </label>
        <input
          id={id}
          autoFocus
          value={reason}
          maxLength={120}
          placeholder="e.g. REKINDLE 2026"
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          aria-invalid={tried && !reason.trim()}
          className={input}
        />
        {tried && !reason.trim() ? (
          <p className="text-xs text-danger">Give a reason.</p>
        ) : (
          <p className="text-xs text-muted">Shown in the planner and in session tracking.</p>
        )}
      </div>
      {picks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picks.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              aria-pressed={reason.trim() === r}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:border-accent/50 aria-pressed:border-accent aria-pressed:bg-accent/10"
            >
              {r}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="h-9 rounded-lg border border-danger px-3 text-sm font-medium text-danger hover:bg-danger hover:text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Mark as no session"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-muted">
          Keep it
        </button>
      </div>
    </div>
  );
}

const bumped = (c: Composition, role: string, delta: number): Composition => ({
  ...c,
  [role]: Math.max(0, Math.min(6, (c[role as keyof Composition] ?? 0) + delta)),
});
/** Same parts and numbers (any roles: the band's or a crew's). */
const sameBand = (a: Composition, b: Composition) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((r) => (a[r] ?? 0) === (b[r] ?? 0));

type Group = { name: string; ministry: Ministry; weights: number[]; bands: Composition[] };

function mostCommonBand(bands: Composition[]): Composition {
  let best = bands[0];
  let most = 0;
  for (const b of bands) {
    const n = bands.filter((x) => sameBand(x, b)).length;
    if (n > most) [best, most] = [b, n];
  }
  return best;
}

/** One kind of session (e.g. all "CM Prayer & Praise"): set the weight and band of all of them at once. */
function DefaultsRow({ rosterId, group, showMinistry }: { rosterId: string; group: Group; showMinistry: boolean }) {
  const { name, ministry, weights, bands } = group;
  const count = weights.length;
  const sameWeight = weights.every((w) => w === weights[0]);
  const bandsAgree = bands.every((b) => sameBand(b, bands[0]));
  const { crew } = useContext(PartsContext);
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState(String(sameWeight ? weights[0] : ""));
  const [band, setBand] = useState<Composition>(() => ({ ...mostCommonBand(bands) }));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const w = Number(weight);
  const validWeight = weight !== "" && w >= 0 && w <= 1;
  const changed = validWeight && (!sameWeight || w !== weights[0] || !bandsAgree || !sameBand(band, bands[0]));
  const id = `d-${name.replace(/\W+/g, "-")}`;

  return (
    <li className="py-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
        {showMinistry && (
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${MINISTRY_STYLE[ministry]}`}>{MINISTRY_LABEL[ministry]}</span>
        )}
        <span className="min-w-0 flex-1 text-sm font-medium">
          {name} <span className="font-normal text-muted">× {count}</span>
          <span className="block text-xs font-normal text-muted">
            {bandsAgree ? compositionSummary(bands[0], CATALOGUE_LABEL) : crew ? "Crews differ between sessions" : "Bands differ between sessions"} · weight {sameWeight ? weights[0] : "mixed"}
          </span>
        </span>
        <span aria-hidden className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 rounded-xl bg-background p-3">
          <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-medium">
            Weight
            <input
              id={id}
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={weight}
              placeholder="mixed"
              onChange={(e) => {
                setWeight(e.target.value);
                setMsg(null);
              }}
              className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {weight !== "" && !validWeight ? (
              <span className="font-normal text-danger">0 to 1</span>
            ) : (
              <span className="font-normal text-muted">how much one session counts toward someone&apos;s load</span>
            )}
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{crew ? "Crew" : "Band"}</legend>
            <BandEditor
              composition={band}
              onBump={(role, delta) => {
                setBand((b) => bumped(b, role, delta));
                setMsg(null);
              }}
            />
            {!bandsAgree && (
              <p className="text-xs text-amber-700">
                {crew
                  ? "These sessions have different crews now. Applying sets them all to this crew."
                  : "These sessions have different bands now. Applying sets them all to this band."}
              </p>
            )}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!changed || pending}
              onClick={() =>
                start(async () => {
                  const r = await setDefaultsForSessions(rosterId, name, { weight: w, composition: band });
                  setMsg({ ok: r.ok, text: r.ok ? "Saved" : (r.message ?? "Couldn't save.") });
                })
              }
              className="h-9 rounded-lg bg-ink px-3 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-40"
            >
              {pending ? "Saving…" : `Apply to all ${count}`}
            </button>
            {msg && <span role="status" className={`text-xs ${msg.ok ? "text-emerald-700" : "text-danger"}`}>{msg.text}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

function SessionDefaults({ rosterId, sessions }: { rosterId: string; sessions: PlannerSession[] }) {
  // A media crew's team doesn't split EM and CM: no badges.
  const { crew } = useContext(PartsContext);
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const s of sessions) {
      if (s.cancelled) continue;
      const g = m.get(s.name) ?? { name: s.name, ministry: s.ministry, weights: [], bands: [] };
      g.weights.push(s.weight);
      g.bands.push(s.composition);
      m.set(s.name, g);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions]);
  const ref = useRef<HTMLDialogElement>(null);
  if (!groups.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50"
      >
        Session defaults
      </button>
      <dialog
        ref={ref}
        aria-labelledby="defaults-dialog-title"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <div className="max-h-[88vh] space-y-3 overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 id="defaults-dialog-title" className="font-display text-2xl font-semibold">
              Session defaults
            </h2>
            <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="-mr-2 rounded-full p-2 text-muted hover:bg-background">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-muted">
            Set the weight and band for every session of one kind in this roster. You can still change a single session by tapping it.
          </p>
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              // Remount when the saved values change so the editor shows them.
              <DefaultsRow key={`${g.name}|${g.weights.join(",")}|${JSON.stringify(g.bands)}`} rosterId={rosterId} group={g} showMinistry={!crew && usesMinistry(sessions)} />
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}

/**
 * The session form. `submit` replaces adding to `rosterId` (e.g. an ad-hoc session from the Roster
 * page), and `extra` adds a section under the band (e.g. picking who's in it). Once a new session is
 * added, the lead is asked whether it's the same service as another team's ad hoc service that day
 * (if there are any); with `stay`, what happened is shown with a Done button either way.
 */
function SessionDialogBody({
  rosterId,
  draft,
  quarter,
  onClose,
  submit,
  extra,
  band,
  reasons = [],
  teamConfig,
  stay = false,
}: {
  rosterId: string;
  draft: Draft;
  /** The dates it can be on (end "" = no limit). */
  quarter: { start: string; end: string };
  onClose: () => void;
  submit?: (payload: SessionPayload) => Promise<{ ok: boolean; message: string | null; id?: string }>;
  extra?: (s: Draft) => React.ReactNode;
  stay?: boolean;
  /** Who's rostered on it (an existing session on a roster with people in it): making a part
   *  smaller asks who comes off, and saving takes them off. */
  band?: BandMember[];
  /** Reasons already used for "no session" in this roster, offered as quick picks. */
  reasons?: string[];
  /** The signed-in team: which regular bands "Start from" offers, and whether EM/CM applies. */
  teamConfig?: TeamConfig;
}) {
  const [s, setS] = useState<Draft>(draft);
  const presets = presetKinds(teamConfig);
  // Teams without an EM/CM split (e.g. Youth) don't choose who can serve: anyone can.
  const splitMinistry = splitsMinistry(teamConfig);
  // Asking why it won't happen (marking it as no session, or changing the reason).
  const [askReason, setAskReason] = useState(false);
  // "role|memberId" picked to come off parts made smaller than the people in them.
  const [off, setOff] = useState<Set<string>>(new Set());
  // Parts now smaller than the people in them: who's in each, and how many have to come off.
  const parts = useContext(PartsContext);
  const shrunk = parts.list.flatMap((r) => {
    const holders = (band ?? []).filter((m) => m.role === r.value || m.also_roles.includes(r.value)).sort((a, b) => a.name.localeCompare(b.name));
    const over = holders.length - (s.composition[r.value] ?? 0);
    return over > 0 ? [{ role: r.value, label: r.label, holders, over }] : [];
  });
  const removals = shrunk.flatMap((g) => g.holders.filter((m) => off.has(`${g.role}|${m.member_id}`)).map((m) => ({ member: m.member_id, role: g.role })));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Just added: asking whether it's the same service as another team's.
  const [added, setAdded] = useState<{ id: string; date: string; message: string | null } | null>(null);
  const isNew = draft.id === null;
  const set = (patch: Partial<Draft>) => setS((x) => ({ ...x, ...patch }));
  // Functional update so quick clicks on different roles never overwrite each other.
  const bump = (role: string, delta: number) => setS((x) => ({ ...x, composition: bumped(x.composition, role, delta) }));

  function applyPreset(kind: string) {
    if (kind === "blank") return set({ composition: {}, weight: 1 });
    // The team's own parts for this kind (e.g. Main Media's EM Sunday crew), else the catalogue's band.
    const t = sessionTypeFor(teamConfig, kind as keyof typeof SESSION_TYPES);
    set({ name: t.name, ministry: t.ministry, weight: t.weight, composition: t.composition });
  }

  function save() {
    setError(null);
    const short = shrunk.find((g) => g.holders.filter((m) => off.has(`${g.role}|${m.member_id}`)).length !== g.over);
    if (short) {
      setError(`Choose ${short.over === 1 ? "who comes" : `the ${short.over} who come`} off ${short.label}.`);
      return;
    }
    start(async () => {
      const payload: SessionPayload = {
        date: s.date,
        name: s.name,
        ministry: s.ministry,
        weight: s.weight,
        composition: s.composition,
        note: s.note,
        rehearsal_date: s.rehearsal_date,
        start_time: s.start_time,
        rehearsal_time: s.rehearsal_date ? s.rehearsal_time : null,
      };
      const r: { ok: boolean; message: string | null; id?: string } = isNew
        ? await (submit ?? ((x: SessionPayload) => addSession(rosterId, x)))(payload)
        : await updateSession(s.id!, { ...payload, cancelled: s.cancelled }, removals);
      if (r.ok && isNew && r.id) setAdded({ id: r.id, date: s.date, message: stay ? r.message : null });
      else if (r.ok) onClose();
      else setError(r.message);
    });
  }

  const people = headcount(s.composition);
  const singers = (s.composition["worship leader"] ?? 0) + (s.composition.vocalist ?? 0);

  function markNoSession(reason: string) {
    setError(null);
    start(async () => {
      const r = await setSessionCancelled(draft.id!, true, reason);
      if (r.ok) onClose();
      else setError(r.message);
    });
  }

  if (added) {
    return <LinkAfterAdding sessionId={added.id} date={added.date} message={added.message} stay={stay} crew={parts.crew} onDone={onClose} />;
  }

  return (
    <div className="space-y-5">
      {draft.cancelled && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <span>
            <span className="font-medium">No session</span>
            {draft.cancel_reason ? <>: {draft.cancel_reason}</> : <span className="text-danger"> (no reason given yet)</span>}
          </span>
          {!askReason && (
            <button type="button" onClick={() => setAskReason(true)} className="text-xs underline underline-offset-2 hover:text-accent">
              {draft.cancel_reason ? "Change reason" : "Give a reason"}
            </button>
          )}
        </div>
      )}
      {isNew && (
        <label className="block space-y-1 text-sm font-medium">
          Start from
          <select className={input} defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
            <option value="" disabled>
              {parts.crew ? "Choose a crew…" : "Choose a band…"}
            </option>
            {presets.map((k) => (
              <option key={k} value={k}>
                {SESSION_TYPES[k].name} {parts.crew ? "crew" : "band"}
              </option>
            ))}
            <option value="blank">{parts.crew ? "Empty crew" : "Empty band"}</option>
          </select>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          Name
          <input value={s.name} onChange={(e) => set({ name: e.target.value })} className={input} placeholder="e.g. Christmas Eve Service" />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Date
          <input type="date" value={s.date} min={quarter.start} max={quarter.end || undefined} onChange={(e) => set({ date: e.target.value })} className={input} />
        </label>
        <TimeField
          id="start-time"
          label="Starts at"
          value={s.start_time}
          fallback={defaultStartTime(s.kind)}
          onChange={(t) => set({ start_time: t })}
        />
        {/* Rehearsal date | time, the same layout as the session's Date | Starts at. */}
        <div className="space-y-1 text-sm font-medium">
          <label htmlFor="rehearsal-date">Rehearsal</label>
          <input
            id="rehearsal-date"
            type="date"
            value={s.rehearsal_date ?? ""}
            max={s.date}
            min={addDays(s.date, -14)}
            disabled={s.rehearsal_date === null}
            onChange={(e) => set({ rehearsal_date: e.target.value || null })}
            className={`${input} disabled:opacity-50`}
          />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-normal text-muted">
            <span>{s.rehearsal_date ? formatDate(s.rehearsal_date, { weekday: "long", day: "numeric", month: "short" }) : "No rehearsal"}</span>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={s.rehearsal_date === null}
                onChange={(e) => set({ rehearsal_date: e.target.checked ? null : addDays(s.date, -4) })}
                className="accent-accent"
              />
              No rehearsal
            </label>
          </div>
        </div>
        {s.rehearsal_date && (
          <TimeField
            id="rehearsal-time"
            label="Rehearsal at"
            value={s.rehearsal_time}
            fallback={defaultRehearsalTime(s.kind, s.rehearsal_date)}
            onChange={(t) => set({ rehearsal_time: t })}
          />
        )}
        <p className="-mt-2 text-xs text-muted sm:col-span-2">Anyone away on the rehearsal date won&apos;t be rostered for this session.</p>
        {/* A crew's team doesn't split EM and CM, so anyone can serve: no choice to make. */}
        {(splitMinistry || (s.ministry !== "any" && !parts.crew)) && (
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            Who can serve
            <select value={s.ministry} onChange={(e) => set({ ministry: e.target.value as Ministry })} className={input}>
              <option value="em">EM members only</option>
              <option value="cm">CM members only</option>
              <option value="any">Anyone (EM & CM)</option>
            </select>
          </label>
        )}
        <label className="space-y-1 text-sm font-medium sm:col-span-2">
          Weight <span className="font-normal text-muted">({s.weight.toFixed(1)}): how much serving at this counts toward someone&apos;s load</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={s.weight}
            onChange={(e) => set({ weight: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{parts.crew ? "Crew" : "Band"}</legend>
        <BandEditor composition={s.composition} onBump={bump} />
        <p className="text-xs text-muted">
          {people} {people === 1 ? "person" : "people"}.{!parts.crew && " Band leader / talkback goes to someone already playing an instrument."}
          {(s.composition["worship leader"] ?? 0) > 0 && (s.composition.vocalist ?? 0) > 0 && ` The ${singers} singers will be ${singers} different people.`}
        </p>
        {shrunk.map((g) => (
          <div key={g.role} role="group" aria-label={`Who comes off ${g.label}`} className="space-y-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
            <p className="text-sm font-medium">
              {g.label}: choose {g.over === 1 ? "who comes" : `the ${g.over} who come`} off
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {g.holders.map((m) => {
                const k = `${g.role}|${m.member_id}`;
                return (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={off.has(k)}
                      onChange={(e) =>
                        setOff((x) => {
                          const next = new Set(x);
                          if (e.target.checked) next.add(k);
                          else next.delete(k);
                          return next;
                        })
                      }
                      className="accent-accent"
                    />
                    <span className={off.has(k) ? "line-through" : ""}>{m.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>

      {extra?.(s)}

      {!isNew && draft.kind === "custom" && <LinkedServiceField sessionId={draft.id!} date={draft.date} />}

      <label className="block space-y-1 text-sm font-medium">
        Note <span className="font-normal text-muted">(optional)</span>
        <input value={s.note} onChange={(e) => set({ note: e.target.value })} className={input} />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {askReason ? (
        <div className="border-t border-border pt-4">
          <NoSessionReason
            name={draft.name}
            date={draft.date}
            reasons={reasons}
            pending={pending}
            onConfirm={markNoSession}
            onCancel={() => setAskReason(false)}
          />
        </div>
      ) : (
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button type="button" disabled={pending} onClick={save} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60">
          {pending ? "Saving…" : isNew ? "Add session" : "Save"}
        </button>
        <button type="button" onClick={onClose} className="text-sm text-muted">
          Cancel
        </button>
        {!isNew && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              // A session marked as no session comes back the same way.
              if (draft.cancelled) {
                start(async () => {
                  const r = await setSessionCancelled(draft.id!, false);
                  if (r.ok) onClose();
                  else setError(r.message);
                });
                return;
              }
              // Regular sessions are kept as "no session" (with why), so they can be restored from the
              // planner; sessions added by hand go for good.
              if (draft.kind !== "custom") return setAskReason(true);
              if (!window.confirm(`Delete ${draft.name || "this session"}? Nobody will be rostered for it.`)) return;
              start(async () => {
                const r = await deleteSession(draft.id!);
                if (r.ok) onClose();
                else setError(r.message);
              });
            }}
            className={`ml-auto h-10 rounded-lg border px-4 text-sm font-medium disabled:opacity-50 ${
              draft.cancelled ? "border-border hover:border-accent/50" : "border-danger text-danger hover:bg-danger hover:text-white"
            }`}
          >
            {draft.cancelled ? "Restore session" : draft.kind === "custom" ? "Delete session" : "No session"}
          </button>
        )}
      </div>
      )}
    </div>
  );
}

function SessionPlannerBody({
  rosterId,
  sessions,
  quarter,
  editable,
  teamConfig,
}: {
  rosterId: string;
  sessions: PlannerSession[];
  quarter: { start: string; end: string };
  editable: boolean;
  teamConfig?: TeamConfig;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Open the dialog once its content has rendered.
  useEffect(() => {
    if (draft && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [draft]);
  const [pending, start] = useTransition();

  const byDate = useMemo(() => {
    const m = new Map<string, PlannerSession[]>();
    for (const s of sessions) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return [...m.entries()];
  }, [sessions]);

  const active = sessions.filter((s) => !s.cancelled);
  // No EM or CM sessions (e.g. Youth): no EM/CM badges.
  // EM/CM badges only for a team that splits EM and CM (not media) with EM or CM sessions.
  const showMinistry = splitsMinistry(teamConfig) && usesMinistry(sessions);
  // Reasons already given in this roster, offered again as quick picks.
  const reasons = useMemo(() => [...new Set(sessions.map((s) => s.cancel_reason.trim()).filter(Boolean))], [sessions]);
  // The session being marked as no session from the list (asks why first).
  const reasonRef = useRef<HTMLDialogElement>(null);
  const [cancelling, setCancelling] = useState<PlannerSession | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  useEffect(() => {
    if (cancelling && !reasonRef.current?.open) reasonRef.current?.showModal();
  }, [cancelling]);
  const closeReason = () => {
    reasonRef.current?.close();
    setCancelling(null);
    setCancelError(null);
  };

  function open(d: Draft) {
    setDraft(d);

  }
  function close() {
    dialogRef.current?.close();
    setDraft(null);
  }

  return (
    <section aria-labelledby="sessions-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="sessions-title" className="text-lg font-semibold">
            1. Sessions to plan
          </h2>
          <p className="text-sm text-muted">
            {active.length} sessions · {sessions.length - active.length} marked as no session. Tap a session to change it.
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <SessionDefaults rosterId={rosterId} sessions={sessions} />
            <button
              type="button"
              onClick={() => open(newSessionDraft(quarter.start))}
              aria-label="Add session"
              title="Add session"
              className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-surface hover:border-accent/50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ul className="divide-y divide-border">
          {byDate.map(([date, list]) => (
            <li key={date} className="flex flex-col gap-1 px-3 py-1.5 sm:flex-row sm:items-start sm:gap-4">
              <p className="w-28 shrink-0 pt-1 text-sm font-medium">{formatDate(date, { weekday: "short", day: "numeric", month: "short" })}</p>
              <ul className="flex flex-1 flex-col gap-1">
                {list.map((s) => (
                  <li key={s.id}>
                    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1 ${s.cancelled ? "opacity-50" : ""} ${editable ? "hover:bg-background" : ""}`}>
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() => open({ ...s })}
                        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left disabled:cursor-default"
                      >
                        {showMinistry && (
                          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${MINISTRY_STYLE[s.ministry]}`}>{MINISTRY_LABEL[s.ministry]}</span>
                        )}
                        <span className={`text-[13px] font-medium ${s.cancelled ? "line-through" : ""}`}>{s.name}</span>
                        <span className="text-xs text-muted">
                          {s.cancelled ? (
                            s.cancel_reason ? (
                              <span className="font-semibold text-foreground">{s.cancel_reason}</span>
                            ) : (
                              <span className="text-danger">No session: give a reason</span>
                            )
                          ) : (
                            compositionSummary(s.composition, CATALOGUE_LABEL)
                          )}
                        </span>
                        <span className="text-xs text-muted">weight {s.weight}</span>
                        {s.rehearsal_date && !s.cancelled && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                            Rehearsal {formatDate(s.rehearsal_date, { weekday: "short", day: "numeric", month: "short" })}
                          </span>
                        )}
                        {s.linkedTeams?.length ? (
                          <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted">Linked with {s.linkedTeams.join(", ")}</span>
                        ) : null}
                        {s.note && <span className="text-xs italic text-muted">{s.note}</span>}
                      </button>
                      {editable && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => (s.cancelled ? start(async () => void (await setSessionCancelled(s.id, false))) : setCancelling(s))}
                          aria-label={s.cancelled ? `Restore ${s.name}` : `No ${s.name} this week`}
                          title={s.cancelled ? "Restore this session" : "No session this week"}
                          className="grid h-6 w-6 place-items-center rounded-full text-muted/50 hover:bg-background hover:text-foreground"
                        >
                          {s.cancelled ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                              <path d="M3 3v5h5" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <dialog
        ref={dialogRef}
        onClose={() => setDraft(null)}
        aria-labelledby="session-dialog-title"
        className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <div className="max-h-[88vh] space-y-4 overflow-y-auto p-6">
          <h2 id="session-dialog-title" className="font-display text-2xl font-semibold">
            {draft?.id ? "Edit session" : "Add a session"}
          </h2>
          {draft && <SessionDialog key={draft.id ?? "new"} rosterId={rosterId} draft={draft} quarter={quarter} onClose={close} reasons={reasons} teamConfig={teamConfig} />}
        </div>
      </dialog>

      <dialog
        ref={reasonRef}
        onClose={() => {
          setCancelling(null);
          setCancelError(null);
        }}
        aria-labelledby="reason-dialog-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <div className="space-y-4 p-6">
          <h2 id="reason-dialog-title" className="font-display text-2xl font-semibold">
            No session
          </h2>
          {cancelling && (
            <NoSessionReason
              key={cancelling.id}
              name={cancelling.name}
              date={cancelling.date}
              reasons={reasons}
              pending={pending}
              onCancel={closeReason}
              onConfirm={(reason) =>
                start(async () => {
                  const r = await setSessionCancelled(cancelling.id, true, reason);
                  if (r.ok) closeReason();
                  else setCancelError(r.message);
                })
              }
            />
          )}
          {cancelError && (
            <p role="alert" className="text-sm text-danger">
              {cancelError}
            </p>
          )}
        </div>
      </dialog>
    </section>
  );
}

/** A session's dialog (also used by the roster's New menu), with the team's parts: band or crew. */
export function SessionDialog(props: React.ComponentProps<typeof SessionDialogBody>) {
  return (
    <PartsContext.Provider value={partsFor(props.teamConfig)}>
      <SessionDialogBody {...props} />
    </PartsContext.Provider>
  );
}

/** The roster's sessions: the list, the session dialog and the defaults, with the team's parts: band or crew. */
export function SessionPlanner(props: React.ComponentProps<typeof SessionPlannerBody>) {
  return (
    <PartsContext.Provider value={partsFor(props.teamConfig)}>
      <SessionPlannerBody {...props} />
    </PartsContext.Provider>
  );
}
