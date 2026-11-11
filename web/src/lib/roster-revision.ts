import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABEL, formatDate, formatTime, hhmm } from "@/lib/roster";

/**
 * Root's revision of a published roster (rosters.status 'revision'): a copy of its sessions,
 * assignments and own rules that root edits while everyone keeps seeing the published roster.
 * Republishing applies root's changes (copy vs. how the published roster looked when the copy was
 * made) onto the published roster in place, so its sessions keep their ids and everything hanging
 * off them (serve requests, session plans, cover requests) stays.
 */

type Db = ReturnType<typeof createAdminClient>;

type Assignment = { session_id: string; member_id: string; role: string; also_roles: string[] };

/** The session fields root can change in a revision. */
const FIELDS = ["date", "name", "ministry", "weight", "composition", "cancelled", "cancel_reason", "note", "rehearsal_date", "start_time", "rehearsal_time"] as const;
type Field = (typeof FIELDS)[number];
type SessionFields = Record<Field, unknown>;
type SessionRow = SessionFields & { id: string; kind: string; source_session_id?: string | null };

export type RevisionBase = { sessions: Record<string, SessionFields>; assignments: Assignment[] };

const pick = (s: SessionRow): SessionFields => Object.fromEntries(FIELDS.map((f) => [f, s[f] ?? null])) as SessionFields;
const same = (a: unknown, b: unknown) => JSON.stringify(normal(a)) === JSON.stringify(normal(b));
/** numeric columns come back as strings; compositions as objects whose key order can vary. */
function normal(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normal(x)]));
  }
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
const also = (a: { also_roles?: unknown }) => [...(((a.also_roles as string[] | null) ?? []))].sort();
const key = (sessionId: string, memberId: string) => `${sessionId}|${memberId}`;

/**
 * A custom session renamed or moved: this roster's "serve at" rules for it (e.g. an ad-hoc
 * session's picked band) follow it.
 */
export async function followCustomSession(db: Db, rosterId: string, from: { date: string; name: string }, to: { date: string; name: string }) {
  if (from.date === to.date && from.name === to.name) return;
  const { data: rules } = await db.from("roster_rules").select("id, params").eq("roster_id", rosterId).eq("template", "date");
  for (const r of rules ?? []) {
    const p = r.params as { date?: string; sessionKind?: string; sessionName?: string };
    if (p.date === from.date && p.sessionKind === "custom" && p.sessionName === from.name) {
      await db.from("roster_rules").update({ params: { ...p, date: to.date, sessionName: to.name } }).eq("id", r.id);
    }
  }
}

/** Swap every published session id in a JSON value (the generator's result, a check) for its copy's. */
function remapIds<T>(value: T, ids: Map<string, string>): T {
  if (value == null || !ids.size) return value;
  let text = JSON.stringify(value);
  for (const [from, to] of ids) text = text.split(from).join(to);
  return JSON.parse(text) as T;
}

/** Root's open revision of a published roster, if any. */
export async function revisionOf(publishedId: string, db: Db = createAdminClient()): Promise<string | null> {
  const { data } = await db.from("rosters").select("id").eq("revision_of", publishedId).eq("status", "revision").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Copy a published roster into a new revision. Returns the revision's id. */
export async function createRevision(publishedId: string, userId: string, db: Db = createAdminClient()): Promise<string> {
  const { data: pub } = await db
    .from("rosters")
    .select("id, status, starts_on, ends_on, result, generated_at, check")
    .eq("id", publishedId)
    .maybeSingle();
  if (!pub) throw new Error("Roster not found.");
  if (pub.status !== "published") throw new Error("Only a published roster can be edited this way.");

  const [{ data: sessions, error: sErr }, { data: rules, error: rErr }] = await Promise.all([
    db.from("roster_sessions").select("*").eq("roster_id", publishedId),
    db.from("roster_rules").select("template, params, hard, weight, enabled, created_by").eq("roster_id", publishedId),
  ]);
  if (sErr) throw sErr;
  if (rErr) throw rErr;
  const pubSessions = (sessions ?? []) as SessionRow[];
  const ids = new Map(pubSessions.map((s) => [s.id, crypto.randomUUID()]));
  const { data: assignments, error: aErr } = ids.size
    ? await db.from("roster_assignments").select("session_id, member_id, role, also_roles").in("session_id", [...ids.keys()])
    : { data: [] as Assignment[], error: null };
  if (aErr) throw aErr;
  const pubAssignments = (assignments ?? []).map((a) => ({ ...a, also_roles: also(a) })) as Assignment[];
  const copied = pubAssignments.map((a) => ({ ...a, session_id: ids.get(a.session_id)! }));

  const base: RevisionBase = {
    sessions: Object.fromEntries(pubSessions.map((s) => [s.id, pick(s)])),
    assignments: pubAssignments,
  };
  const { data: rev, error } = await db
    .from("rosters")
    .insert({
      starts_on: pub.starts_on,
      ends_on: pub.ends_on,
      status: "revision",
      revision_of: publishedId,
      revision_base: base,
      created_by: userId,
      result: remapIds(pub.result, ids),
      generated_at: pub.generated_at,
      // The published roster's check lists cells hand-edited while it was a draft; in the copy, orange
      // means "differs from the published roster", so nothing starts out marked as changed.
      check: (() => {
        const c = remapIds(pub.check, ids) as Record<string, unknown> | null;
        return c && typeof c === "object" ? { ...c, edited_cells: [] } : c;
      })(),
      // What the published roster has now: hand edits in the revision are checked (and highlighted)
      // against it, not against the roster as first generated.
      generated_assignments: copied,
    })
    .select("id")
    .single();
  if (error) throw error;
  const revisionId = rev.id as string;
  try {
    if (pubSessions.length) {
      const { error: e } = await db.from("roster_sessions").insert(
        pubSessions.map((s) => ({ ...pick(s), id: ids.get(s.id)!, roster_id: revisionId, kind: s.kind, source_session_id: s.id })),
      );
      if (e) throw e;
    }
    for (let i = 0; i < copied.length; i += 500) {
      const { error: e } = await db.from("roster_assignments").insert(copied.slice(i, i + 500));
      if (e) throw e;
    }
    if (rules?.length) {
      const { error: e } = await db.from("roster_rules").insert(rules.map((r) => ({ ...r, roster_id: revisionId, updated_by: userId })));
      if (e) throw e;
    }
  } catch (e) {
    await db.from("rosters").delete().eq("id", revisionId);
    throw e;
  }
  return revisionId;
}

const day = (d: unknown) => formatDate(String(d), { weekday: "short", day: "numeric", month: "short" });
const partText = (role: string, extra: string[]) =>
  [ROLE_LABEL[role] ?? role, ...extra.map((t) => (ROLE_LABEL[t] ?? t).toLowerCase())].join(" and ");

/** What changed about a session, in words, for the people on it ("moved from Sun 5 Jan; now starts at 10:30"). */
function sessionChangeText(before: SessionFields, after: SessionFields): string | null {
  const bits: string[] = [];
  if (!same(before.cancelled, after.cancelled)) bits.push(after.cancelled ? "cancelled" : "back on");
  if (after.cancelled) return bits.length ? bits.join("; ") : null;
  if (!same(before.name, after.name)) bits.push(`renamed from ${String(before.name)}`);
  if (!same(before.date, after.date)) bits.push(`moved from ${day(before.date)}`);
  if (!same(hhmm(before.start_time as string | null), hhmm(after.start_time as string | null))) {
    bits.push(after.start_time ? `now starts at ${formatTime(hhmm(after.start_time as string)!)}` : "start time back to the usual");
  }
  if (!same(before.rehearsal_date, after.rehearsal_date)) {
    bits.push(after.rehearsal_date ? `rehearsal now ${day(after.rehearsal_date)}` : "no rehearsal any more");
  } else if (after.rehearsal_date && !same(hhmm(before.rehearsal_time as string | null), hhmm(after.rehearsal_time as string | null))) {
    bits.push(after.rehearsal_time ? `rehearsal now at ${formatTime(hhmm(after.rehearsal_time as string)!)}` : "rehearsal time back to the usual");
  }
  return bits.length ? bits.join("; ") : null;
}

export type RepublishSummary = { added: number; removed: number; changed: number; sessions: number; notified: number; skipped: number };

/**
 * Put root's changes in a revision onto the published roster, tell the people affected, and drop
 * the revision. Changes made to the published roster since the copy (covers, swaps, ad-hoc
 * sessions) are kept; where root's change no longer fits (the person has already left that
 * place), it's skipped and counted.
 */
export async function applyRevision(revisionId: string, userId: string, db: Db = createAdminClient()): Promise<{ publishedId: string; summary: RepublishSummary }> {
  const { data: rev } = await db.from("rosters").select("id, status, revision_of, revision_base").eq("id", revisionId).maybeSingle();
  if (!rev || rev.status !== "revision" || !rev.revision_of) throw new Error("There's no edit in progress for this roster.");
  const publishedId = rev.revision_of as string;
  const { data: pub } = await db.from("rosters").select("status").eq("id", publishedId).maybeSingle();
  if (pub?.status !== "published") throw new Error("This roster isn't the published one any more.");
  const base = (rev.revision_base as RevisionBase | null) ?? { sessions: {}, assignments: [] };

  const [{ data: draftS }, { data: liveS }] = await Promise.all([
    db.from("roster_sessions").select("*").eq("roster_id", revisionId),
    db.from("roster_sessions").select("*").eq("roster_id", publishedId),
  ]);
  const draftSessions = (draftS ?? []) as SessionRow[];
  const liveSessions = new Map(((liveS ?? []) as SessionRow[]).map((s) => [s.id, s]));
  const draftIds = draftSessions.map((s) => s.id);
  const [{ data: draftA }, { data: liveA }] = await Promise.all([
    draftIds.length ? db.from("roster_assignments").select("session_id, member_id, role, also_roles").in("session_id", draftIds) : Promise.resolve({ data: [] }),
    liveSessions.size
      ? db.from("roster_assignments").select("session_id, member_id, role, also_roles").in("session_id", [...liveSessions.keys()])
      : Promise.resolve({ data: [] }),
  ]);

  // --- Sessions ---------------------------------------------------------------------------
  const toLive = new Map<string, string>(); // revision session id -> published session id
  const sessionNotes = new Map<string, string>(); // published session id -> what changed, in words
  let sessionsChanged = 0;
  for (const d of draftSessions) {
    const src = d.source_session_id ?? null;
    if (src) {
      const live = liveSessions.get(src);
      const was = base.sessions[src];
      if (!live || !was) continue; // the published session went meanwhile (its copy should have too)
      toLive.set(d.id, src);
      const patch: Partial<SessionFields> = {};
      for (const f of FIELDS) if (!same(d[f], was[f])) patch[f] = d[f] ?? null;
      if (!Object.keys(patch).length) continue;
      const { error } = await db.from("roster_sessions").update(patch).eq("id", src);
      if (error) throw error;
      sessionsChanged++;
      const after = { ...pick(live), ...patch } as SessionFields;
      const note = sessionChangeText(pick(live), after);
      if (note) sessionNotes.set(src, note);
      if (live.kind === "custom") {
        await followCustomSession(db, publishedId, { date: String(live.date), name: String(live.name) }, { date: String(after.date), name: String(after.name) });
      }
    } else {
      // Added in the revision.
      const { data: added, error } = await db
        .from("roster_sessions")
        .insert({ ...pick(d), kind: d.kind, roster_id: publishedId })
        .select("id")
        .single();
      if (error) throw error;
      toLive.set(d.id, added.id as string);
      sessionsChanged++;
    }
  }
  // Deleted in the revision (custom sessions only): note who was on them before they go.
  const kept = new Set(draftSessions.map((d) => d.source_session_id).filter(Boolean) as string[]);
  const deleted = Object.keys(base.sessions).filter((id) => !kept.has(id) && liveSessions.has(id));

  // --- Assignments (root's changes on top of what the published roster has now) -------------
  const before = new Map<string, Assignment>();
  for (const a of (liveA ?? []) as Assignment[]) before.set(key(a.session_id, a.member_id), { ...a, also_roles: also(a) });
  const after = new Map(before);
  const baseMap = new Map(base.assignments.map((a) => [key(a.session_id, a.member_id), { ...a, also_roles: also(a) }]));
  const draftMap = new Map<string, Assignment>();
  for (const a of (draftA ?? []) as Assignment[]) {
    const s = toLive.get(a.session_id);
    if (s) draftMap.set(key(s, a.member_id), { ...a, session_id: s, also_roles: also(a) });
  }
  let skipped = 0;
  for (const [k, b] of baseMap) {
    if (draftMap.has(k) || !liveSessions.has(b.session_id)) continue;
    after.delete(k); // root took them off (no-op if they've already left)
  }
  for (const [k, d] of draftMap) {
    const b = baseMap.get(k);
    if (b && b.role === d.role && same(b.also_roles, d.also_roles)) continue; // root didn't touch it
    if (b && !before.has(k)) {
      skipped++; // root changed their part, but they've left that session meanwhile
      continue;
    }
    after.set(k, d);
  }
  for (const id of deleted) for (const k of [...after.keys()]) if (k.startsWith(`${id}|`)) after.delete(k);

  const removed = [...before.entries()].filter(([k]) => !after.has(k));
  const added = [...after.entries()].filter(([k]) => !before.has(k));
  const changed = [...after.entries()].filter(([k, a]) => {
    const b = before.get(k);
    return b && (b.role !== a.role || !same(b.also_roles, a.also_roles));
  });

  // Who was on each deleted session, and what it was, for telling them.
  const deletedInfo = new Map(deleted.map((id) => [id, liveSessions.get(id)!]));
  for (const [, r] of removed) {
    if (deletedInfo.has(r.session_id)) continue;
    const { error } = await db.from("roster_assignments").delete().eq("session_id", r.session_id).eq("member_id", r.member_id);
    if (error) throw error;
  }
  for (const [, a] of changed) {
    const { error } = await db
      .from("roster_assignments")
      .update({ role: a.role, also_roles: a.also_roles })
      .eq("session_id", a.session_id)
      .eq("member_id", a.member_id);
    if (error) throw error;
    await db.from("serve_requests").update({ role: a.role }).eq("session_id", a.session_id).eq("member_id", a.member_id);
  }
  if (added.length) {
    const rows = added.map(([, a]) => a);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("roster_assignments").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
  }

  // Requests that no longer make sense for people taken off a session.
  const now = new Date().toISOString();
  for (const [, r] of removed) {
    await Promise.all([
      db.from("serve_requests").delete().eq("session_id", r.session_id).eq("member_id", r.member_id),
      db.from("cover_requests").update({ status: "cancelled", closed_at: now }).eq("session_id", r.session_id).eq("member_id", r.member_id).in("status", ["open", "refused"]),
      db.from("handover_requests").update({ status: "cancelled", closed_at: now }).eq("session_id", r.session_id).eq("status", "open").or(`member_id.eq.${r.member_id},target_id.eq.${r.member_id}`),
      db.from("swap_proposals").update({ status: "closed", closed_at: now }).eq("offer_session_id", r.session_id).eq("counterpart_id", r.member_id).eq("status", "pending"),
    ]);
  }
  if (deleted.length) {
    const { error } = await db.from("roster_sessions").delete().in("id", deleted);
    if (error) throw error;
  }

  // --- Telling people -----------------------------------------------------------------------
  type Update = { kind: string; session_id: string | null; role: string | null; actor_id: string; member_id: string; detail: string | null };
  const updates: Update[] = [];
  const touched = new Set<string>(); // "session|member" already told about something
  for (const [k, r] of removed) {
    touched.add(k);
    const gone = deletedInfo.get(r.session_id);
    const cancelled = sessionNotes.get(r.session_id) === "cancelled";
    if (cancelled) continue; // told below that the session was cancelled
    updates.push({
      kind: "roster_removed",
      session_id: gone ? null : r.session_id,
      role: r.role,
      actor_id: userId,
      member_id: r.member_id,
      detail: gone ? `${ROLE_LABEL[r.role] ?? r.role} (${String(gone.name)}) – ${day(gone.date)}` : null,
    });
  }
  for (const [k, a] of added) {
    touched.add(k);
    updates.push({
      kind: "roster_added",
      session_id: a.session_id,
      role: a.role,
      actor_id: userId,
      member_id: a.member_id,
      detail: a.also_roles.length ? a.also_roles.map((t) => (ROLE_LABEL[t] ?? t).toLowerCase()).join(" and ") : null,
    });
  }
  for (const [k, a] of changed) {
    touched.add(k);
    const b = before.get(k)!;
    updates.push({
      kind: "roster_part_changed",
      session_id: a.session_id,
      role: a.role,
      actor_id: userId,
      member_id: a.member_id,
      detail: `${partText(b.role, b.also_roles)} → ${partText(a.role, a.also_roles)}`,
    });
  }
  // Everyone still on a session whose date, time or rehearsal changed (or who was on it when it was cancelled).
  for (const [sessionId, note] of sessionNotes) {
    const people = note === "cancelled" ? [...before.values()].filter((a) => a.session_id === sessionId) : [...after.values()].filter((a) => a.session_id === sessionId);
    for (const a of people) {
      if (note !== "cancelled" && touched.has(key(sessionId, a.member_id)) && !before.has(key(sessionId, a.member_id))) continue; // just added: that says it all
      updates.push({ kind: "roster_session_changed", session_id: sessionId, role: a.role, actor_id: userId, member_id: a.member_id, detail: note });
    }
  }
  // The rest of each band whose line-up changed: one note each saying who moved. (Cancelled
  // sessions were covered above; people added, taken off or moved were told about themselves.)
  const lineUp = new Map<string, string[]>(); // published session id -> changes, in words
  const moved = [...removed, ...added, ...changed];
  if (moved.length) {
    const ids = [...new Set(moved.map(([, a]) => a.member_id))];
    const { data: profiles } = await db.from("profiles").select("id, full_name, email").in("id", ids);
    const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string) || "Someone"]));
    const note = (sessionId: string, text: string) => lineUp.set(sessionId, [...(lineUp.get(sessionId) ?? []), text]);
    for (const [, r] of removed) note(r.session_id, `${nameOf.get(r.member_id)} off ${partText(r.role, r.also_roles).toLowerCase()}`);
    for (const [, a] of added) note(a.session_id, `${nameOf.get(a.member_id)} on ${partText(a.role, a.also_roles).toLowerCase()}`);
    for (const [k, a] of changed) {
      const b = before.get(k)!;
      note(a.session_id, `${nameOf.get(a.member_id)} ${partText(b.role, b.also_roles).toLowerCase()} → ${partText(a.role, a.also_roles).toLowerCase()}`);
    }
  }
  for (const [sessionId, changes] of lineUp) {
    if (deletedInfo.has(sessionId) || sessionNotes.get(sessionId) === "cancelled") continue;
    for (const a of after.values()) {
      if (a.session_id !== sessionId || touched.has(key(sessionId, a.member_id))) continue;
      updates.push({ kind: "roster_band_changed", session_id: sessionId, role: a.role, actor_id: userId, member_id: a.member_id, detail: changes.join(", ") });
    }
  }

  if (updates.length) {
    const { error } = await db.from("roster_updates").insert(updates);
    if (error) throw error;
  }

  // Everyone newly on a session that's coming up is asked to confirm, as when it was first published.
  const { createServeRequests } = await import("@/lib/serving");
  await createServeRequests(publishedId);

  // The republished roster takes over completely: it becomes the new original, so nothing from the
  // version before (the roster as first generated, cells hand-edited back then) is shown as an edit.
  const [{ data: nowA }, { data: pubRow }] = await Promise.all([
    db
      .from("roster_assignments")
      .select("session_id, member_id, role, also_roles, roster_sessions!inner(roster_id)")
      .eq("roster_sessions.roster_id", publishedId),
    db.from("rosters").select("check").eq("id", publishedId).maybeSingle(),
  ]);
  const check = pubRow?.check as Record<string, unknown> | null;
  const { error: baseErr } = await db
    .from("rosters")
    .update({
      generated_assignments: (nowA ?? []).map((a) => ({ session_id: a.session_id, member_id: a.member_id, role: a.role, also_roles: also(a) })),
      check: check && typeof check === "object" ? { ...check, edited_cells: [] } : check,
    })
    .eq("id", publishedId);
  if (baseErr) throw baseErr;

  // The edit copy goes: only the republished roster is left.
  const { error: delErr } = await db.from("rosters").delete().eq("id", revisionId);
  if (delErr) throw delErr;

  return {
    publishedId,
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      sessions: sessionsChanged + deleted.length,
      notified: new Set(updates.map((u) => u.member_id)).size,
      skipped,
    },
  };
}
