"use client";

import { useState, useTransition } from "react";
import { editCell, type CellSlot } from "@/app/(app)/roster/actions";
import { ATTACHED_ROLES, MINISTRY_LABEL, ROLE_LABEL, ROLE_SHORT, formatDate, usesMinistry } from "@/lib/roster";
import type { AssignmentRow, SessionRow } from "@/lib/roster-data";

export type EditPerson = {
  id: string;
  name: string;
  instruments: string[];
  emPercent: number | null;
  serves: "both" | "sunday" | "pnp";
  /** Their absences in this quarter: they can't be picked on these days. */
  away?: { startsOn: string; endsOn: string; reason: string }[];
};

/** Why they're away on that date, or null if they're available. */
function awayOn(p: EditPerson, date: string): string | null {
  return p.away?.find((a) => a.startsOn <= date && a.endsOn >= date)?.reason ?? null;
}

/** Why they can't make this session (away that day, or at its rehearsal), or null if they can. */
function awayReason(p: EditPerson, s: { date: string; rehearsal_date: string | null }): string | null {
  const onDay = awayOn(p, s.date);
  if (onDay !== null) return onDay;
  const atRehearsal = s.rehearsal_date ? awayOn(p, s.rehearsal_date) : null;
  return atRehearsal === null ? null : `rehearsal${atRehearsal ? `: ${atRehearsal}` : ""}`;
}

const SINGING = ["worship leader", "vocalist"];

function canServe(p: EditPerson, s: SessionRow): boolean {
  const em = p.emPercent === null || p.emPercent > 0;
  const cm = p.emPercent === null || p.emPercent < 100;
  const ministryOk = s.ministry === "any" || (s.ministry === "em" ? em : cm);
  const pnp = s.kind.endsWith("_pnp");
  const servesOk = p.serves === "both" || (p.serves === "pnp" ? pnp : !pnp);
  return ministryOk && servesOk;
}

type Slot = CellSlot & { was: { member: string; also: string[] } | null };

/** Root: choose everyone who fills one part of one session, and who also does band leader / talkback. */
export function CellEditor({
  rosterId,
  session,
  role,
  sessions,
  assignments,
  people,
  shares,
  onClose,
}: {
  rosterId: string;
  session: SessionRow;
  role: string;
  sessions: SessionRow[];
  assignments: AssignmentRow[];
  people: EditPerson[];
  /** Serve-less shares (below 1); everyone else counts as 1. */
  shares: Record<string, number>;
  onClose: () => void;
}) {
  const composition = session.composition as Record<string, number>;
  const need = composition[role] ?? 0;
  const current = assignments.filter((a) => a.session_id === session.id && a.role === role);
  // `was`: who held this place when the editor opened, and the band roles they did (BL/TB), so a
  // replacement can be held to them when nobody else in the band can take those over.
  const [slots, setSlots] = useState<Slot[]>(() => {
    const filled = current.map((a) => ({ member: a.member_id, also: [...a.also_roles], was: { member: a.member_id, also: [...a.also_roles] } }));
    return [...filled, ...Array.from({ length: Math.max(0, need - filled.length) }, () => ({ member: null, also: [], was: null }))];
  });
  // Band leader / talkback -> the bandmate (outside this part) who takes it over.
  const [handOver, setHandOver] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const singing = SINGING.includes(role);
  const attachable = singing ? [] : ATTACHED_ROLES.filter((t) => (composition[t] ?? 0) > 0);
  const byId = new Map(people.map((p) => [p.id, p]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // Where everyone else is on this date (outside this cell), to flag clashes in the picker.
  const elsewhere = new Map<string, string>();
  for (const a of assignments) {
    const s = sessionById.get(a.session_id);
    if (!s || s.date !== session.date || (a.session_id === session.id && a.role === role)) continue;
    elsewhere.set(a.member_id, `${s.id === session.id ? "" : `${s.name}, `}${ROLE_LABEL[a.role] ?? a.role}`);
  }
  // The rest of this session's line-up (other parts).
  const others = assignments.filter((a) => a.session_id === session.id && a.role !== role);
  // Who currently does band leader / talkback in this session (in any part).
  const attachedNow = (t: string) => {
    const inCell = slots.find((s) => s.member && s.also.includes(t));
    if (inCell) return `${byId.get(inCell.member!)?.name} (${ROLE_LABEL[role]})`;
    const other = others.find((a) => a.also_roles.includes(t));
    if (other) return `${other.name} (${ROLE_LABEL[other.role] ?? other.role})`;
    const to = handOver[t] ? others.find((a) => a.member_id === handOver[t] && !SINGING.includes(a.role)) : undefined;
    return to ? `${to.name} (${ROLE_LABEL[to.role] ?? to.role}, taking over)` : null;
  };

  // Only people who play this part; those outside this session's ministry / session type come
  // second and get flagged if picked.
  const byName = (a: EditPerson, b: EditPerson) => a.name.localeCompare(b.name);
  const skilled = people.filter((p) => p.instruments.includes(role));
  // How much each person serves this month (each session they're on counts its weight), relative
  // to their share: someone on 0.4 counts as "full" at 40% of a normal load.
  const month = session.date.slice(0, 7);
  const monthIds = new Set(sessions.filter((x) => !x.cancelled && x.date.startsWith(month)).map((x) => x.id));
  const served = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!monthIds.has(a.session_id)) continue;
    served.set(a.member_id, (served.get(a.member_id) ?? new Set()).add(a.session_id));
  }
  const loadOf = (id: string) => [...(served.get(id) ?? [])].reduce((t, sid) => t + (sessionById.get(sid)?.weight ?? 1), 0);
  const shareOf = (id: string) => shares[id] ?? 1;
  const relative = (id: string) => loadOf(id) / shareOf(id);
  const inCell = new Set(slots.map((sl) => sl.member).filter(Boolean) as string[]);
  // The least loaded this month for their share first.
  const byLoad = (a: EditPerson, b: EditPerson) => relative(a.id) - relative(b.id) || byName(a, b);
  // People marked absent that day are listed last, greyed out and can't be picked.
  const isAway = (p: EditPerson) => awayReason(p, session) !== null;
  const players = skilled.filter((p) => canServe(p, session) && !isAway(p)).sort(byLoad);
  const otherPlayers = skilled.filter((p) => !canServe(p, session) && !isAway(p)).sort(byLoad);
  const absentPlayers = skilled.filter(isAway).sort(byName);
  // Someone in another place of this cell.
  const takenElsewhereInCell = (id: string, i: number) => slots.some((sl, j) => j !== i && sl.member === id);
  const suggested = players.find((p) => !elsewhere.has(p.id) && !inCell.has(p.id));

  // Band leader / talkback held by whoever was in place i: if nobody else in the band (outside
  // this part, or someone else in it) can take it over, whoever replaces them must be able to.
  const bandCanCover = (t: string, i: number) =>
    others.some(
      (a) =>
        !SINGING.includes(a.role) &&
        !current.some((c) => c.member_id === a.member_id) &&
        !inCell.has(a.member_id) &&
        Boolean(byId.get(a.member_id)?.instruments.includes(t)),
    ) ||
    (!singing && slots.some((sl, j) => j !== i && sl.member && byId.get(sl.member)?.instruments.includes(t)));
  const mustDo = (i: number) =>
    singing ? [] : (slots[i]?.was?.also ?? []).filter((t) => (ATTACHED_ROLES as readonly string[]).includes(t) && !bandCanCover(t, i));
  /** Why p can't take place i, or null if they can. Whoever had the place to begin with always can. */
  const blockedFor = (p: EditPerson, i: number): string | null => {
    if (slots[i]?.was?.member === p.id) return null;
    if (takenElsewhereInCell(p.id, i)) return `already serving ${session.name}`;
    if (elsewhere.has(p.id)) return `already on ${elsewhere.get(p.id)}`;
    const missing = mustDo(i).filter((t) => !p.instruments.includes(t));
    if (missing.length) return `can't do ${missing.map((t) => ROLE_SHORT[t]).join("/")}, and nobody else in the band can`;
    return null;
  };
  // Keep anyone already in the cell selectable even if they don't play it (so the picker shows them).
  const unskilledNow = slots
    .map((sl) => (sl.member ? byId.get(sl.member) : undefined))
    .filter((p): p is EditPerson => Boolean(p) && !p!.instruments.includes(role));
  // Current load ÷ supposed load. Supposed = their share × the average load-per-share of everyone
  // who plays this part here. 1 = on target, below 1 = room to take this on.
  const avgPerShare = players.length ? players.reduce((t, p) => t + relative(p.id), 0) / players.length : 0;
  const ratio = (id: string) => (avgPerShare ? relative(id) / avgPerShare : 0);
  const loadText = (id: string) => (Math.round(ratio(id) * 10) / 10).toFixed(1);
  // EM or CM for people who serve only one of them.
  const onlyMinistry = (p: EditPerson) => (p.emPercent === 100 ? "EM" : p.emPercent === 0 ? "CM" : null);
  const absentOption = (p: EditPerson) => (
    <option key={p.id} value={p.id} disabled className="text-muted">
      {p.name} · absent ({awayReason(p, session)})
    </option>
  );
  // Unavailable for place i (serving elsewhere that day, already in this cell, or unable to take
  // over BL/TB nobody else can): listed last, greyed out and can't be picked.
  const option = (p: EditPerson, i: number) => {
    const why = blockedFor(p, i);
    return why ? (
      <option key={p.id} value={p.id} disabled className="text-muted">
        {p.name} · {why}
      </option>
    ) : (
      <option key={p.id} value={p.id}>
        {p.id === suggested?.id ? "★ " : ""}
        {p.name}
        {onlyMinistry(p) ? ` (${onlyMinistry(p)})` : ""} · {loadText(p.id)}
        {elsewhere.has(p.id) ? ` · also on ${elsewhere.get(p.id)}` : ""}
      </option>
    );
  };
  // Available first (lowest load first, as sorted), then the unavailable ones.
  const ordered = (list: EditPerson[], i: number) =>
    [...list].sort((a, b) => Number(Boolean(blockedFor(a, i))) - Number(Boolean(blockedFor(b, i))));

  // Band leader / talkback someone in this part was doing has to stay covered: by someone in the
  // part, or handed to a bandmate playing an instrument here who can do it (as the server checks).
  const uncovered = ATTACHED_ROLES.flatMap((t) => {
    const outside = others.filter((a) => a.also_roles.includes(t)).length;
    const leaving = current.filter((a) => a.also_roles.includes(t));
    const required = Math.min(composition[t] ?? 0, outside + leaving.length);
    const kept = outside + (singing ? 0 : slots.filter((sl) => sl.member && sl.also.includes(t)).length);
    if (kept >= required) return [];
    const seen = new Set<string>();
    const bandmates = others.filter((a) => {
      if (seen.has(a.member_id) || SINGING.includes(a.role) || a.also_roles.includes(t) || inCell.has(a.member_id)) return false;
      if (current.some((c) => c.member_id === a.member_id) || !byId.get(a.member_id)?.instruments.includes(t)) return false;
      seen.add(a.member_id);
      return true;
    });
    const canInCell = singing
      ? []
      : slots.flatMap((sl) => {
          const p = sl.member ? byId.get(sl.member) : undefined;
          return p?.instruments.includes(t) ? [p.name] : [];
        });
    return [{ role: t, leaving: leaving.map((a) => a.name), bandmates, canInCell }];
  });
  const blocked = uncovered.some((u) => !u.bandmates.some((b) => b.member_id === handOver[u.role]));

  function setMember(i: number, id: string) {
    setSlots((xs) =>
      xs.map((s, j) => {
        if (j !== i) return s;
        const p = id ? byId.get(id) : undefined;
        // Keep band leader / talkback only if the new person does them.
        // Keep the band roles this place has (or had) if the new person does them.
        const had = [...new Set([...s.also, ...(s.was?.also ?? [])])];
        return { ...s, member: id || null, also: p ? had.filter((t) => p.instruments.includes(t)) : [] };
      }),
    );
  }
  function toggleAlso(i: number, t: string, on: boolean) {
    setSlots((xs) => xs.map((s, j) => (j === i ? { ...s, also: on ? [...s.also, t] : s.also.filter((x) => x !== t) } : s)));
  }

  function save() {
    setError(null);
    // Only hand over what this change leaves uncovered.
    const send: Record<string, string> = {};
    for (const u of uncovered) if (handOver[u.role]) send[u.role] = handOver[u.role]!;
    start(async () => {
      const r = await editCell(rosterId, session.id, role, slots.map(({ member, also }) => ({ member, also })), send);
      if (r.ok) onClose();
      else setError(r.message);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted">
          {formatDate(session.date, { weekday: "long", day: "numeric", month: "long" })} · {session.name}
          {usesMinistry(sessions) && <> · {MINISTRY_LABEL[session.ministry]}</>}
        </p>
        <h2 className="font-display text-2xl font-semibold">{ROLE_LABEL[role]}</h2>
        <p className="pt-1 text-xs text-muted">
          The number by each name is how much they&apos;re serving in {formatDate(session.date, { month: "long" })} (each session counts its
          weight) compared with their fair share: 1 is on target, below 1 means they have room. Lowest first.
        </p>
      </div>

      <ul className="space-y-3">
        {slots.map((slot, i) => {
          const p = slot.member ? byId.get(slot.member) : undefined;
          return (
            <li key={i} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <select
                  aria-label={`${ROLE_LABEL[role]} ${slots.length > 1 ? i + 1 : ""}`}
                  value={slot.member ?? ""}
                  onChange={(e) => setMember(i, e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">— Nobody —</option>
                  {ordered(players, i).map((p) => option(p, i))}
                  {otherPlayers.length > 0 && (
                    <optgroup label="Not usually at this session (will be flagged)">
                      {ordered(otherPlayers, i).map((p) => option(p, i))}
                    </optgroup>
                  )}
                  {unskilledNow.length > 0 && <optgroup label="In this cell now (not set up for this part)">{unskilledNow.map((p) => option(p, i))}</optgroup>}
                  {absentPlayers.length > 0 && <optgroup label="Absent that day or at the rehearsal">{absentPlayers.map(absentOption)}</optgroup>}
                </select>
                <button
                  type="button"
                  onClick={() => setSlots((xs) => xs.filter((_, j) => j !== i))}
                  aria-label={`Remove ${p?.name ?? "this empty place"}`}
                  className="text-xs text-muted hover:text-danger"
                >
                  Remove
                </button>
              </div>
              {mustDo(i).length > 0 && slot.was && (
                <p className="text-xs text-amber-700">
                  {byId.get(slot.was.member)?.name ?? "They"} {slot.member === slot.was.member ? "does" : "did"}{" "}
                  {mustDo(i).map((t) => ROLE_LABEL[t].toLowerCase()).join(" and ")} here and nobody else in the band can take it over, so only people who
                  can do it are available.
                </p>
              )}
              {suggested && slot.member !== suggested.id && !blockedFor(suggested, i) && (
                <p className="text-xs text-muted">
                  ★ Suggested: <span className="font-medium text-foreground">{suggested.name}</span> ({loadText(suggested.id)}).{" "}
                  <button type="button" onClick={() => setMember(i, suggested.id)} className="text-accent hover:underline">
                    Use
                  </button>
                </p>
              )}
              {slot.member && elsewhere.has(slot.member) && (
                <p className="text-xs text-danger">Also on {elsewhere.get(slot.member)} that day.</p>
              )}
              {p && isAway(p) && (
                <p className="text-xs text-danger">
                  {p.name} is marked absent that day or at the rehearsal ({awayReason(p, session)}).
                </p>
              )}
              {p && !players.includes(p) && !isAway(p) && (
                <p className="text-xs text-amber-700">
                  {p.instruments.includes(role) ? `${p.name} doesn't usually serve at this session.` : `${p.name} isn't set up for this part.`}
                </p>
              )}
              {attachable.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachable.map((t) => {
                    const on = slot.also.includes(t);
                    const skilled = p?.instruments.includes(t);
                    // Only offer band leader / talkback to people who do it (or to untick it).
                    if (!on && (!p || !skilled)) return null;
                    return (
                      <label
                        key={t}
                        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${on ? "border-accent bg-accent/10 text-accent" : "border-border"}`}
                        title={p && !skilled ? `${p.name} isn't set up as ${ROLE_LABEL[t].toLowerCase()}` : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!slot.member}
                          onChange={(e) => toggleAlso(i, t, e.target.checked)}
                          className="accent-accent"
                        />
                        +{ROLE_SHORT[t]} {ROLE_LABEL[t]}
                        {p && !skilled && on && <span className="text-amber-700">(not set up)</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* More people than the band needs: said under the last name, and updated as places are changed. */}
      {(() => {
        const filled = slots.filter((sl) => sl.member).length;
        if (filled <= need) return null;
        const part = ROLE_LABEL[role].toLowerCase();
        return (
          <p role="status" className="-mt-2 text-sm text-danger">
            {filled - need} more {part} than the band needs (it needs {need}).
          </p>
        );
      })()}
      <button
        type="button"
        onClick={() => setSlots((xs) => [...xs, { member: null, also: [], was: null }])}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-accent hover:border-accent"
      >
        <span aria-hidden className="text-base leading-none">
          +
        </span>
        Add another {ROLE_LABEL[role].toLowerCase()}
      </button>

      {uncovered.map((u) => (
        <div key={u.role} role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            {u.leaving.length ? `${u.leaving.join(" and ")} ${u.leaving.length > 1 ? "were" : "was"} doing` : "Someone was doing"}{" "}
            {ROLE_LABEL[u.role].toLowerCase()} here, so someone has to take it over.
            {u.canInCell.length > 0 && ` Tick +${ROLE_SHORT[u.role]} for ${u.canInCell.join(" or ")} above, or hand it to someone else in the band.`}
          </p>
          {u.bandmates.length > 0 ? (
            <label className="flex flex-wrap items-center gap-2">
              <span>Hand it to</span>
              <select
                value={handOver[u.role] ?? ""}
                onChange={(e) => setHandOver((h) => ({ ...h, [u.role]: e.target.value }))}
                className="h-9 min-w-0 flex-1 rounded-lg border border-amber-300 bg-surface px-2 text-sm text-foreground"
              >
                <option value="">— Choose —</option>
                {u.bandmates.map((b) => (
                  <option key={b.member_id} value={b.member_id}>
                    {b.name} ({ROLE_LABEL[b.role] ?? b.role})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            u.canInCell.length === 0 && (
              <p>
                Nobody else in this session&apos;s band can do it. Pick someone for this part who can do {ROLE_LABEL[u.role].toLowerCase()}.
              </p>
            )
          )}
        </div>
      ))}

      {attachable.length > 0 && (
        <p className="text-xs text-muted">
          {attachable
            .map((t) => {
              const who = attachedNow(t);
              return `${ROLE_LABEL[t]}: ${who ?? "nobody yet"}`;
            })
            .join(" · ")}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button type="button" disabled={pending || blocked} onClick={save} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60">
          {pending ? "Saving and checking…" : "Save change"}
        </button>
        <button type="button" onClick={onClose} className="text-sm text-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}
