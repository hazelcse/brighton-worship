"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ATTACHED_ROLES,
  OPS,
  ROLES,
  ROLE_LABEL,
  SESSION_TYPES,
  SINGING_ROLES,
  checkRule,
  addDays,
  defaultRehearsal,
  defaultSessions,
  formatDate,
  quarterOf,
  type Composition,
  type Role,
  type RuleParams,
} from "@/lib/roster";
import { loadPeople } from "@/lib/roster-data";
import { cleanComposition, compositionProblem, isDate, validateSession, type SessionInput } from "@/lib/session-input";
import { bandRoleCandidates, createServeRequests } from "@/lib/serving";
import { followCustomSession } from "@/lib/roster-revision";

export type ActionState = { ok: boolean; message: string | null };

function fail(e: unknown): ActionState {
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
}

async function audit(actorId: string, action: string, target: string, details: object = {}) {
  await createAdminClient().from("audit_log").insert({ actor_id: actorId, action, target, details });
}

// ---------------------------------------------------------------------------
// Rosters and sessions
// ---------------------------------------------------------------------------

/** Start planning a quarter: a draft with every regular session. Opens the existing draft if there is one. */
export async function createRoster(quarterStart: string): Promise<ActionState> {
  let id: string;
  try {
    const user = await requirePermission("roster.edit");
    if (!isDate(quarterStart)) return { ok: false, message: "Choose a quarter." };
    const q = quarterOf(quarterStart);
    const db = createAdminClient();
    const { data: existing } = await db.from("rosters").select("id").eq("starts_on", q.start).eq("status", "draft").maybeSingle();
    if (existing) {
      id = existing.id;
    } else {
      const { data, error } = await db
        .from("rosters")
        .insert({ starts_on: q.start, ends_on: q.end, created_by: user.id })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
      const sessions = defaultSessions(q).map((s) => ({ ...s, roster_id: id }));
      const { error: sErr } = await db.from("roster_sessions").insert(sessions);
      if (sErr) throw sErr;
      await audit(user.id, "roster.create", id, { quarter: q.label });
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  redirect(`/roster/${id}/plan`);
}

/**
 * Delete the session plans (session builder: sections, songs, revisions) made for a roster's
 * sessions, before the roster itself goes. Plans only point at roster sessions loosely (the link is
 * cleared when the session goes) and are found again by date, service and name, so without this a
 * new roster for the same quarter would pick the old plans back up. Also takes plans for these
 * sessions that have already lost their link, unless another roster still has that session. A
 * revision's sessions are copies of the published roster's, so deleting a revision deletes no plans.
 */
async function deleteRosterPlans(db: ReturnType<typeof createAdminClient>, rosterId: string): Promise<number> {
  const { data: rosters, error: rErr } = await db.from("rosters").select("id, status").or(`id.eq.${rosterId},revision_of.eq.${rosterId}`);
  if (rErr) throw rErr;
  if (rosters?.find((r) => r.id === rosterId)?.status === "revision") return 0;
  const rosterIds = (rosters ?? []).map((r) => r.id);
  const { data: sessions, error: sErr } = await db
    .from("roster_sessions")
    .select("id, date, kind, name")
    .in("roster_id", rosterIds);
  if (sErr) throw sErr;
  if (!sessions?.length) return 0;
  const ids = sessions.map((s) => s.id);
  const dates = sessions.map((s) => s.date).sort();
  const keys = new Set(sessions.map((s) => `${s.date}|${s.kind}|${s.name}`));
  const [{ data: linked, error: lErr }, { data: loose, error: oErr }, { data: others, error: xErr }] = await Promise.all([
    db.from("worship_sessions").select("id").in("roster_session_id", ids),
    db
      .from("worship_sessions")
      .select("id, date, service, service_name")
      .is("roster_session_id", null)
      .gte("date", dates[0])
      .lte("date", dates[dates.length - 1]),
    db
      .from("roster_sessions")
      .select("date, kind, name")
      .not("roster_id", "in", `(${rosterIds.join(",")})`)
      .gte("date", dates[0])
      .lte("date", dates[dates.length - 1]),
  ]);
  if (lErr) throw lErr;
  if (oErr) throw oErr;
  if (xErr) throw xErr;
  for (const o of others ?? []) keys.delete(`${o.date}|${o.kind}|${o.name}`);
  const planIds = [
    ...(linked ?? []).map((p) => p.id),
    ...(loose ?? []).filter((p) => keys.has(`${p.date}|${p.service}|${p.service_name}`)).map((p) => p.id),
  ];
  if (!planIds.length) return 0;
  // Sections, items and published revisions go with them (ON DELETE CASCADE).
  const { error } = await db.from("worship_sessions").delete().in("id", planIds);
  if (error) throw error;
  return planIds.length;
}

/** Delete a roster from the list: drafts by anyone who plans rosters, published ones by root only. */
export async function deleteRoster(rosterId: string): Promise<ActionState> {
  try {
    const user = await requirePermission("roster.edit");
    const db = createAdminClient();
    const { data: r } = await db.from("rosters").select("status, starts_on").eq("id", rosterId).maybeSingle();
    if (!r) return { ok: false, message: "Roster not found." };
    if (r.status !== "draft" && !user.isRoot) return { ok: false, message: "Only root can delete a published roster." };
    const plans = await deleteRosterPlans(db, rosterId);
    const { error } = await db.from("rosters").delete().eq("id", rosterId);
    if (error) throw error;
    await audit(user.id, "roster.delete", rosterId, { status: r.status, quarter: quarterOf(r.starts_on).label, plans });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  revalidatePath("/sessions", "layout");
  return { ok: true, message: null };
}

export async function deleteDraft(rosterId: string): Promise<ActionState> {
  try {
    const user = await requirePermission("roster.edit");
    const db = createAdminClient();
    const { data: r } = await db.from("rosters").select("status").eq("id", rosterId).maybeSingle();
    if (!r) return { ok: false, message: "Roster not found." };
    if (r.status !== "draft") return { ok: false, message: "Only draft rosters can be deleted." };
    await deleteRosterPlans(db, rosterId);
    const { error } = await db.from("rosters").delete().eq("id", rosterId);
    if (error) throw error;
    await audit(user.id, "roster.delete_draft", rosterId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  redirect("/roster/new");
}

/**
 * The draft being planned. Pass the user to also allow root's revision of a published roster (its
 * sessions and who serves can be changed; generating and its own rules can't).
 */
async function draftFor(rosterId: string, user?: { isRoot: boolean }) {
  const { data } = await createAdminClient().from("rosters").select("id, status, starts_on, ends_on").eq("id", rosterId).maybeSingle();
  if (!data) throw new Error("Roster not found.");
  if (data.status === "revision") {
    if (!user) throw new Error("This can't be changed while editing a published roster.");
    if (!user.isRoot) throw new Error("Only root can edit a published roster.");
    return data;
  }
  if (data.status !== "draft") throw new Error("This roster has been published, so its sessions can't be changed here.");
  return data;
}

export async function addSession(rosterId: string, input: SessionInput): Promise<ActionState> {
  try {
    const user = await requirePermission("roster.edit");
    const roster = await draftFor(rosterId, user);
    const s = { ...input, composition: cleanComposition(input.composition), weight: Number(input.weight) };
    const problem = validateSession(s, roster);
    if (problem) return { ok: false, message: problem };
    const { error } = await createAdminClient().from("roster_sessions").insert({
      roster_id: rosterId,
      date: s.date,
      kind: "custom",
      name: s.name.trim(),
      ministry: s.ministry,
      weight: s.weight,
      composition: s.composition,
      note: (s.note ?? "").trim(),
      rehearsal_date: s.rehearsal_date || null,
      start_time: s.start_time || null,
      rehearsal_time: (s.rehearsal_date && s.rehearsal_time) || null,
    });
    if (error) throw error;
    await audit(user.id, "roster.add_session", rosterId, { date: s.date, name: s.name });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/roster/${rosterId}/plan`);
  return { ok: true, message: "Session added." };
}

/** Set the weight and band of every session with this name in a draft (e.g. all "CM Prayer & Praise"). */
export async function setDefaultsForSessions(
  rosterId: string,
  name: string,
  input: { weight: number; composition: Composition },
): Promise<ActionState> {
  try {
    const user = await requirePermission("roster.edit");
    await draftFor(rosterId, user);
    const weight = Math.round(Number(input.weight) * 100) / 100;
    if (!(weight >= 0 && weight <= 1)) return { ok: false, message: "The weight must be between 0 and 1." };
    const composition = cleanComposition(input.composition);
    const problem = compositionProblem(composition);
    if (problem) return { ok: false, message: problem };
    const { error } = await createAdminClient()
      .from("roster_sessions")
      .update({ weight, composition })
      .eq("roster_id", rosterId)
      .eq("name", name);
    if (error) throw error;
    await audit(user.id, "roster.set_session_defaults", rosterId, { name, weight, composition });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/roster/${rosterId}/plan`);
  return { ok: true, message: "Saved." };
}

/**
 * `removals`: people taken off parts made smaller (root only, on a roster with people in it). For
 * band leader / talkback that's just the extra role; for any other part, their place.
 */
export async function updateSession(
  sessionId: string,
  input: SessionInput & { cancelled: boolean },
  removals: { member: string; role: string }[] = [],
): Promise<ActionState> {
  let rosterId = "";
  let message: string | null = null;
  try {
    const user = await requirePermission("roster.edit");
    if (removals.length && !user.isRoot) return { ok: false, message: "Only root can change who's serving." };
    const db = createAdminClient();
    const { data: row } = await db.from("roster_sessions").select("roster_id, kind, date, name").eq("id", sessionId).maybeSingle();
    if (!row) return { ok: false, message: "Session not found." };
    rosterId = row.roster_id;
    const roster = await draftFor(rosterId, user);
    const s = { ...input, composition: cleanComposition(input.composition), weight: Number(input.weight) };
    const problem = validateSession(s, roster);
    if (problem) return { ok: false, message: problem };
    const { error } = await db
      .from("roster_sessions")
      .update({
        date: s.date,
        name: s.name.trim(),
        ministry: s.ministry,
        weight: s.weight,
        composition: s.composition,
        cancelled: Boolean(input.cancelled),
        note: (s.note ?? "").trim(),
        rehearsal_date: s.rehearsal_date || null,
        start_time: s.start_time || null,
        rehearsal_time: (s.rehearsal_date && s.rehearsal_time) || null,
      })
      .eq("id", sessionId);
    if (error) throw error;
    if (row.kind === "cm_pnp") await syncCmRehearsals(rosterId, [row.date, s.date]);
    if (row.kind === "custom") await followCustomSession(db, rosterId, { date: row.date, name: row.name }, { date: s.date, name: s.name.trim() });
    for (const r of Array.isArray(removals) ? removals : []) {
      const member = String(r.member);
      const role = String(r.role);
      if (ATTACHED_ROLES.includes(role)) {
        const { data: a } = await db.from("roster_assignments").select("also_roles").eq("session_id", sessionId).eq("member_id", member).maybeSingle();
        if (!a) continue;
        const { error: e } = await db
          .from("roster_assignments")
          .update({ also_roles: ((a.also_roles as string[] | null) ?? []).filter((t) => t !== role) })
          .eq("session_id", sessionId)
          .eq("member_id", member);
        if (e) throw e;
      } else {
        const { error: e } = await db.from("roster_assignments").delete().eq("session_id", sessionId).eq("member_id", member).eq("role", role);
        if (e) throw e;
      }
    }
    await audit(user.id, "roster.update_session", sessionId, { cancelled: input.cancelled, ...(removals.length ? { removed: removals } : {}) });
    message = await afterSessionChange(rosterId, roster.status);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/roster/${rosterId}`, "layout");
  return { ok: true, message: message ?? "Saved." };
}

/**
 * A session changed on a roster that already has people in it (an edit of a published roster, or
 * a generated draft): re-check it so its problems match the new band. Returns a note if the check
 * couldn't run.
 */
async function afterSessionChange(rosterId: string, status: string): Promise<string | null> {
  const { data } = await createAdminClient().from("rosters").select("generated_assignments").eq("id", rosterId).maybeSingle();
  if (status !== "revision" && !data?.generated_assignments) return null;
  const problem = await recheck(rosterId, status === "revision");
  return problem ? `Saved, but the roster couldn't be re-checked: ${problem}` : null;
}

/** Mark a session as no session (with why, e.g. "REKINDLE 2026" or "NO SERVICE"), or bring it back. */
export async function setSessionCancelled(sessionId: string, cancelled: boolean, reason = ""): Promise<ActionState> {
  let rosterId = "";
  let message: string | null = null;
  try {
    const user = await requirePermission("roster.edit");
    const why = String(reason ?? "").trim().slice(0, 120);
    if (cancelled && !why) return { ok: false, message: "Give a reason, e.g. REKINDLE 2026 or NO SERVICE." };
    const db = createAdminClient();
    const { data: row } = await db.from("roster_sessions").select("roster_id, kind, date").eq("id", sessionId).maybeSingle();
    if (!row) return { ok: false, message: "Session not found." };
    rosterId = row.roster_id;
    const roster = await draftFor(rosterId, user);
    const { error } = await db
      .from("roster_sessions")
      .update({ cancelled, cancel_reason: cancelled ? why : "" })
      .eq("id", sessionId);
    if (error) throw error;
    if (row.kind === "cm_pnp") await syncCmRehearsals(rosterId, [row.date]);
    message = await afterSessionChange(rosterId, roster.status);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/roster/${rosterId}`, "layout");
  return { ok: true, message: message ?? (cancelled ? "Marked as no session." : "Session restored.") };
}

/**
 * A CM Prayer & Praise moved, was cancelled or came back: the CM Sundays it could clash with get
 * their default rehearsal again (Wednesday, or the Sunday before if that Wednesday is a P&P).
 * Rehearsals someone set by hand to another date are left alone.
 */
async function syncCmRehearsals(rosterId: string, pnpDates: string[]) {
  const db = createAdminClient();
  const sundays = [...new Set(pnpDates.map((d) => addDays(d, 4)))];
  const [{ data: cm }, { data: pnps }] = await Promise.all([
    db.from("roster_sessions").select("id, date, rehearsal_date").eq("roster_id", rosterId).eq("kind", "cm_sunday").in("date", sundays),
    db.from("roster_sessions").select("date").eq("roster_id", rosterId).eq("kind", "cm_pnp").eq("cancelled", false),
  ]);
  const pnpSet = new Set((pnps ?? []).map((p) => p.date as string));
  for (const s of cm ?? []) {
    const defaults = [addDays(s.date, -4), addDays(s.date, -7)];
    if (s.rehearsal_date && !defaults.includes(s.rehearsal_date)) continue;
    const next = defaultRehearsal(s.date, "cm_sunday", pnpSet);
    if (next !== s.rehearsal_date) await db.from("roster_sessions").update({ rehearsal_date: next }).eq("id", s.id);
  }
}

/** Only sessions added by hand can be deleted; regular ones are marked "no session" instead. */
export async function deleteSession(sessionId: string): Promise<ActionState> {
  let rosterId = "";
  let message: string | null = null;
  try {
    const user = await requirePermission("roster.edit");
    const db = createAdminClient();
    const { data: row } = await db.from("roster_sessions").select("roster_id, kind").eq("id", sessionId).maybeSingle();
    if (!row) return { ok: false, message: "Session not found." };
    rosterId = row.roster_id;
    const roster = await draftFor(rosterId, user);
    if (row.kind !== "custom") return { ok: false, message: "Regular sessions can't be deleted. Mark them as “no session” instead." };
    const { error } = await db.from("roster_sessions").delete().eq("id", sessionId);
    if (error) throw error;
    message = await afterSessionChange(rosterId, roster.status);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/roster/${rosterId}`, "layout");
  return { ok: true, message: message ?? "Session removed." };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function cleanParams(p: RuleParams): RuleParams | null {
  const subjectOk = (s: unknown) => {
    const x = s as { kind?: string; value?: string };
    return (
      x?.kind === "everyone" ||
      (x?.kind === "ministry" && (x.value === "em" || x.value === "cm")) ||
      (x?.kind === "role" && ROLES.some((r) => r.value === x.value)) ||
      (x?.kind === "member" && typeof x.value === "string")
    );
  };
  switch (p?.template) {
    case "frequency":
      if (!subjectOk(p.subject) || !OPS.includes(p.op) || !["month", "quarter"].includes(p.period) || !["should", "should_not"].includes(p.polarity)) return null;
      return { template: "frequency", subject: p.subject, polarity: p.polarity, op: p.op, count: Math.trunc(Number(p.count)), period: p.period };
    case "pair":
      if (!["should", "should_not"].includes(p.polarity)) return null;
      return { template: "pair", a: String(p.a ?? ""), b: String(p.b ?? ""), polarity: p.polarity };
    case "break":
      if (!subjectOk(p.subject) || !OPS.includes(p.op)) return null;
      return { template: "break", subject: p.subject, except: (p.except ?? []).map(String), op: p.op, weeks: Math.trunc(Number(p.weeks)) };
    case "date":
      if (!["must", "must_not"].includes(p.polarity)) return null;
      if (p.sessionKind && !(p.sessionKind in SESSION_TYPES) && p.sessionKind !== "custom") return null;
      return {
        template: "date",
        member: String(p.member ?? ""),
        polarity: p.polarity,
        date: String(p.date ?? ""),
        ...(p.sessionKind ? { sessionKind: p.sessionKind } : {}),
        ...(p.sessionKind === "custom" ? { sessionName: String(p.sessionName ?? "") } : {}),
        // A band picked by hand: the part (and BL/TB) stays with the rule when it's edited.
        ...(p.polarity === "must" && p.role && ROLES.some((r) => r.value === p.role) ? { role: p.role } : {}),
        ...(p.polarity === "must" && p.role && p.bandLeader === true ? { bandLeader: true } : {}),
      };
    default:
      return null;
  }
}

/** Create or update a rule. Rules that can never hold are refused; only root can change soft-rule weights. */
export async function saveRule(
  ruleId: string | null,
  input: { hard: boolean; weight: number; enabled: boolean; params: RuleParams; rosterId: string; isDefault: boolean },
): Promise<ActionState> {
  try {
    const user = await requirePermission("roster.edit");
    if (!input.isDefault) await draftFor(input.rosterId);
    if (ruleId && (await isPermanent(ruleId))) {
      return { ok: false, message: "This is a permanent rule. Only its weight can be changed." };
    }
    const params = cleanParams(input.params);
    if (!params) return { ok: false, message: "That rule isn't complete." };
    const people = await loadPeople();
    const errors = checkRule(params, people, input.hard).filter((a) => a.level === "error");
    if (errors.length) return { ok: false, message: errors.map((e) => e.message).join(" ") };

    const db = createAdminClient();
    let weight = Math.min(1, Math.max(0, Number(input.weight)));
    if (!user.isRoot) {
      // Admins can build rules, but only root sets how much a soft rule matters.
      if (ruleId) {
        const { data: existing } = await db.from("roster_rules").select("weight").eq("id", ruleId).maybeSingle();
        weight = Number(existing?.weight ?? 0.5);
      } else {
        weight = 0.5;
      }
    }
    const { template, ...rest } = params;
    const row = {
      template,
      params: rest,
      hard: Boolean(input.hard),
      weight,
      enabled: Boolean(input.enabled),
      roster_id: input.isDefault ? null : input.rosterId,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (ruleId) {
      const { error } = await db.from("roster_rules").update(row).eq("id", ruleId);
      if (error) throw error;
    } else {
      const { error } = await db.from("roster_rules").insert({ ...row, created_by: user.id });
      if (error) throw error;
    }
    await audit(user.id, ruleId ? "roster.rule_update" : "roster.rule_create", ruleId ?? "new", { params, hard: input.hard, weight });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  return { ok: true, message: "Rule saved." };
}

/** Make a rule a default (used by every roster) or keep it to this roster only. */
export async function setRuleDefault(ruleId: string, rosterId: string, isDefault: boolean): Promise<ActionState> {
  try {
    const user = await requirePermission("roster.edit");
    if (await isPermanent(ruleId)) return { ok: false, message: "Permanent rules are always defaults." };
    if (!isDefault) await draftFor(rosterId);
    const { error } = await createAdminClient()
      .from("roster_rules")
      .update({ roster_id: isDefault ? null : rosterId, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", ruleId);
    if (error) throw error;
    await audit(user.id, "roster.rule_default", ruleId, { isDefault, rosterId });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  return { ok: true, message: null };
}

async function isPermanent(ruleId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("roster_rules").select("permanent").eq("id", ruleId).maybeSingle();
  return Boolean(data?.permanent);
}

export async function deleteRule(ruleId: string): Promise<ActionState> {
  try {
    const user = await requirePermission("roster.edit");
    if (await isPermanent(ruleId)) return { ok: false, message: "Permanent rules can't be deleted." };
    const { error } = await createAdminClient().from("roster_rules").delete().eq("id", ruleId);
    if (error) throw error;
    await audit(user.id, "roster.rule_delete", ruleId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  return { ok: true, message: "Rule deleted." };
}

export async function setRuleEnabled(ruleId: string, enabled: boolean): Promise<ActionState> {
  try {
    await requirePermission("roster.edit");
    if (await isPermanent(ruleId)) return { ok: false, message: "Permanent rules can't be switched off." };
    const { error } = await createAdminClient().from("roster_rules").update({ enabled }).eq("id", ruleId);
    if (error) throw error;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  return { ok: true, message: null };
}

/**
 * Root only: let a member serve less under "Share the load fairly". factor 1 (or null) = normal;
 * below 1 = their fair share is scaled down (0.5 = about half as often as others who could fill
 * the same places).
 */
export async function setServeLess(memberId: string, factor: number | null): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    if (!user?.isRoot) return { ok: false, message: "Only root can change who serves less." };
    const db = createAdminClient();
    const { data: rule } = await db.from("roster_rules").select("id, params").eq("template", "fairness").maybeSingle();
    if (!rule) return { ok: false, message: "The fairness rule is missing." };
    const reduced: Record<string, number> = { ...((rule.params as { reduced?: Record<string, number> })?.reduced ?? {}) };
    const f = factor == null ? 1 : Math.round(Number(factor) * 100) / 100;
    if (!(f >= 0.1 && f <= 1)) return { ok: false, message: "Choose a number between 0.1 and 1." };
    if (f >= 1) delete reduced[memberId];
    else reduced[memberId] = f;
    const { error } = await db
      .from("roster_rules")
      .update({ params: { ...(rule.params as object), reduced }, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", rule.id);
    if (error) throw error;
    await audit(user.id, "roster.serve_less", memberId, { factor: f });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  revalidatePath("/team", "layout");
  return { ok: true, message: null };
}

/** Root only: how much a soft rule matters (0–1). */
export async function setRuleWeight(ruleId: string, weight: number): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    if (!user?.isRoot) return { ok: false, message: "Only root can change rule weights." };
    const w = Math.min(1, Math.max(0, Math.round(Number(weight) * 100) / 100));
    const { error } = await createAdminClient().from("roster_rules").update({ weight: w }).eq("id", ruleId);
    if (error) throw error;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  return { ok: true, message: null };
}

// ---------------------------------------------------------------------------
// Generating and publishing
// ---------------------------------------------------------------------------

/** Run the optimiser (in the worker) for a draft. Replaces the draft's assignments. */
export async function generateRoster(rosterId: string): Promise<ActionState & { status?: string }> {
  try {
    const user = await requirePermission("roster.edit");
    await draftFor(rosterId);
    const { data: unexplained } = await createAdminClient()
      .from("roster_sessions")
      .select("name, date")
      .eq("roster_id", rosterId)
      .eq("cancelled", true)
      .eq("cancel_reason", "")
      .order("date");
    if (unexplained?.length) {
      const list = unexplained.map((s) => `${s.name} (${formatDate(s.date, { day: "numeric", month: "short" })})`).join(", ");
      return { ok: false, message: `Give a reason for each session marked as no session before generating: ${list}.` };
    }
    const { workerFetch } = await import("@/lib/worker");
    const r = await workerFetch<{ status: string; unfilled: number; hard_broken: number; assigned: number; seconds: number }>(
      `/rosters/${rosterId}/generate`,
      { method: "POST" },
      180_000,
    );
    await audit(user.id, "roster.generate", rosterId, r);
    revalidatePath(`/roster/${rosterId}/plan`);
    return {
      ok: true,
      status: r.status,
      message:
        r.status === "impossible"
          ? "This roster is impossible as the hard rules stand. See the warnings below."
          : `Roster generated (${r.assigned} places filled in ${r.seconds}s).`,
    };
  } catch (e) {
    return fail(e);
  }
}

/** Re-score a draft after hand edits (worker saves rosters.check). Failures are reported, not thrown. */
async function recheck(rosterId: string, full = false): Promise<string | null> {
  try {
    const { workerFetch } = await import("@/lib/worker");
    // full: check even if nobody moved (e.g. only a session's band or who can serve changed).
    await workerFetch(`/rosters/${rosterId}/evaluate${full ? "?full=true" : ""}`, { method: "POST" }, 60_000);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't check the roster.";
  }
}

export type CellSlot = { member: string | null; also: string[] };

/**
 * Root only: replace who fills one part (e.g. Bass) of one session in a generated draft.
 * `handOver` (band leader / talkback -> member id): a bandmate outside this part who takes over a
 * band role nobody in the part keeps. A band role held by someone in the part has to stay covered.
 */
export async function editCell(
  rosterId: string,
  sessionId: string,
  role: string,
  slots: CellSlot[],
  handOver: Record<string, string> = {},
): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    if (!user?.isRoot) return { ok: false, message: "Only root can change the roster by hand." };
    const { status } = await draftFor(rosterId, user);
    if (!ROLES.some((r) => r.value === role) || ATTACHED_ROLES.includes(role as Role)) return { ok: false, message: "Unknown part." };
    const db = createAdminClient();
    const { data: session } = await db
      .from("roster_sessions")
      .select("id, name, date, rehearsal_date, composition")
      .eq("id", sessionId)
      .eq("roster_id", rosterId)
      .maybeSingle();
    if (!session) return { ok: false, message: "Session not found." };
    const singing = SINGING_ROLES.includes(role);
    const members = slots.flatMap((s) => (s.member ? [s.member] : []));
    const { data: band } = await db.from("roster_assignments").select("member_id, role, also_roles").eq("session_id", sessionId);
    const before = band ?? [];
    const ids = [...new Set([...members, ...Object.values(handOver)])];
    const { data: profiles } = ids.length ? await db.from("profiles").select("id, full_name, email, instruments").in("id", ids) : { data: [] };
    const person = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    const nameOf = (id: string) => person.get(id)?.full_name || person.get(id)?.email || "Someone";
    if (members.some((m) => !person.has(m))) return { ok: false, message: "Someone picked isn't on the team." };
    // The same person can't fill two places in one part.
    const twice = members.find((m, i) => members.indexOf(m) !== i);
    if (twice) return { ok: false, message: `${nameOf(twice)} is already serving ${session.name} as ${(ROLE_LABEL[role] ?? role).toLowerCase()}.` };

    // Anyone newly put in can't already be serving that day, or be absent that day or at the rehearsal.
    const inCellNow = before.filter((b) => b.role === role).map((b) => b.member_id as string);
    const added = [...new Set(members.filter((m) => !inCellNow.includes(m)))];
    if (added.length) {
      const { data: sameDay } = await db
        .from("roster_assignments")
        .select("member_id, role, roster_sessions!inner(id, name, date, roster_id, cancelled)")
        .in("member_id", added)
        .eq("roster_sessions.roster_id", rosterId)
        .eq("roster_sessions.date", session.date as string)
        .eq("roster_sessions.cancelled", false);
      const clash = (sameDay ?? []).find((a) => !(a.role === role && (a.roster_sessions as unknown as { id: string }).id === sessionId));
      if (clash) {
        const s = clash.roster_sessions as unknown as { name: string };
        return { ok: false, message: `${nameOf(clash.member_id as string)} is already on ${s.name} (${(ROLE_LABEL[clash.role as string] ?? clash.role).toLowerCase()}) that day.` };
      }
      const days = [session.date as string, ...(session.rehearsal_date ? [session.rehearsal_date as string] : [])];
      for (const d of days) {
        const { data: away } = await db.from("absences").select("member_id").in("member_id", added).lte("starts_on", d).gte("ends_on", d).limit(1);
        if (away?.length) {
          return { ok: false, message: `${nameOf(away[0].member_id as string)} is marked absent ${d === session.date ? "that day" : "at the rehearsal"}.` };
        }
      }
    }

    const heldBefore = (id: string, t: string) => before.some((b) => b.member_id === id && ((b.also_roles as string[] | null) ?? []).includes(t));
    const skilled = (id: string, t: string) => ((person.get(id)?.instruments as string[] | null) ?? []).includes(t);
    const rows: { session_id: string; member_id: string; role: string; also_roles: string[] }[] = [];
    for (const s of slots) {
      if (!s.member) continue;
      // Band leader / talkback goes with an instrument, never with singing.
      const also = singing ? [] : [...new Set(s.also.filter((t) => ATTACHED_ROLES.includes(t as Role)))];
      const unable = also.find((t) => !skilled(s.member!, t) && !heldBefore(s.member!, t));
      if (unable) return { ok: false, message: `${nameOf(s.member)} isn't set up as ${(ROLE_LABEL[unable] ?? unable).toLowerCase()}.` };
      rows.push({ session_id: sessionId, member_id: s.member, role, also_roles: also });
    }

    // Band leader / talkback that someone in this part was doing has to stay covered: by someone in
    // the part, or handed to a bandmate who can do it (the same people bandRoleCandidates offers).
    const composition = (session.composition as Record<string, number> | null) ?? {};
    const inCellBefore = before.filter((b) => b.role === role).map((b) => b.member_id as string);
    const outside = before.filter((b) => b.role !== role);
    const handTo: { memberId: string; role: string; also: string[] }[] = [];
    for (const t of ATTACHED_ROLES) {
      const holds = (b: { also_roles: unknown }) => ((b.also_roles as string[] | null) ?? []).includes(t);
      const was = before.filter(holds).length;
      const kept = outside.filter(holds).length + rows.filter((r) => r.also_roles.includes(t)).length;
      const required = Math.min(Number(composition[t] ?? 0), was);
      const target = handOver[t];
      if (kept >= required) continue; // covered without a hand-over (any hand-over sent is ignored)
      if (!target) {
        return {
          ok: false,
          message: `${ROLE_LABEL[t]} at ${session.name} would be left uncovered. Pick someone in the band to take it over, or someone in this part who can do it.`,
        };
      }
      const candidates = await bandRoleCandidates(sessionId, t, [...inCellBefore, ...members], db);
      const row = outside.find((b) => b.member_id === target && !SINGING_ROLES.includes(b.role as string));
      if (!row || !candidates.some((c) => c.id === target)) {
        return { ok: false, message: `${nameOf(target)} can't take over ${(ROLE_LABEL[t] ?? t).toLowerCase()} at ${session.name}.` };
      }
      handTo.push({ memberId: target, role: row.role as string, also: [...new Set([...((row.also_roles as string[] | null) ?? []), t])] });
    }

    const { error: delErr } = await db.from("roster_assignments").delete().eq("session_id", sessionId).eq("role", role);
    if (delErr) throw delErr;
    if (rows.length) {
      const { error } = await db.from("roster_assignments").insert(rows);
      if (error) throw error;
    }
    for (const h of handTo) {
      const { error } = await db.from("roster_assignments").update({ also_roles: h.also }).eq("session_id", sessionId).eq("member_id", h.memberId).eq("role", h.role);
      if (error) throw error;
    }
    await audit(user.id, "roster.edit_cell", rosterId, {
      sessionId,
      role,
      members: rows.map((r) => [r.member_id, r.also_roles]),
      ...(handTo.length ? { handedOver: handTo.map((h) => h.memberId) } : {}),
    });
    const problem = await recheck(rosterId, status === "revision");
    revalidatePath(`/roster/${rosterId}`, "layout");
    return { ok: true, message: problem ? `Saved, but the roster couldn't be re-checked: ${problem}` : "Saved." };
  } catch (e) {
    return fail(e);
  }
}

/** Root only: throw away hand edits and go back to the roster as generated. */
export async function resetToGenerated(rosterId: string): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    if (!user?.isRoot) return { ok: false, message: "Only root can reset the roster." };
    await draftFor(rosterId);
    const db = createAdminClient();
    const { data: r } = await db.from("rosters").select("generated_assignments").eq("id", rosterId).maybeSingle();
    const snapshot = (r?.generated_assignments as { session_id: string; member_id: string; role: string; also_roles: string[] }[] | null) ?? null;
    if (!snapshot) return { ok: false, message: "There's no generated roster to go back to. Generate it again instead." };
    const { data: sessions } = await db.from("roster_sessions").select("id").eq("roster_id", rosterId);
    const ids = (sessions ?? []).map((s) => s.id as string);
    if (ids.length) {
      const { error } = await db.from("roster_assignments").delete().in("session_id", ids);
      if (error) throw error;
    }
    const keep = snapshot.filter((x) => ids.includes(x.session_id));
    for (let i = 0; i < keep.length; i += 500) {
      const { error } = await db.from("roster_assignments").insert(keep.slice(i, i + 500));
      if (error) throw error;
    }
    await db.from("rosters").update({ check: null }).eq("id", rosterId);
    await audit(user.id, "roster.reset_to_generated", rosterId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/roster/${rosterId}`, "layout");
  return { ok: true, message: "Back to the generated roster." };
}

/** Make a generated draft the live roster for its quarter (any earlier published one is archived). */
export async function publishRoster(rosterId: string): Promise<ActionState> {
  try {
    const user = await requirePermission("roster.edit");
    const db = createAdminClient();
    const { data: r } = await db.from("rosters").select("status, starts_on, result").eq("id", rosterId).maybeSingle();
    if (!r) return { ok: false, message: "Roster not found." };
    if (r.status !== "draft") return { ok: false, message: "This roster is already published." };
    if (!r.result) return { ok: false, message: "Generate the roster before publishing it." };
    // Rosters with problems can still be published; the problems stay listed on the roster.
    // A revision of the roster being replaced goes with it.
    const { data: replaced } = await db.from("rosters").select("id").eq("starts_on", r.starts_on).eq("status", "published");
    const replacedIds = (replaced ?? []).map((x) => x.id as string);
    if (replacedIds.length) await db.from("rosters").delete().eq("status", "revision").in("revision_of", replacedIds);
    await db.from("rosters").update({ status: "archived" }).eq("starts_on", r.starts_on).eq("status", "published");
    const { error } = await db
      .from("rosters")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", rosterId);
    if (error) throw error;
    await createServeRequests(rosterId);
    await audit(user.id, "roster.publish", rosterId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout");
  redirect(`/roster/${rosterId}`);
}

/**
 * Root, editing a published roster: the × button. Puts back who was serving when the pencil was
 * pressed (cell changes save as they're made), then re-checks the roster.
 */
export async function restoreRevisionAssignments(
  rosterId: string,
  snapshot: { session_id: string; member_id: string; role: string; also_roles: string[] }[],
  /** The sessions' settings when the pencil was pressed, to put back too (band, times, who can serve…). */
  sessionSettings?: {
    id: string;
    date: string;
    name: string;
    ministry: string;
    weight: number;
    composition: Record<string, number>;
    cancelled: boolean;
    cancel_reason?: string;
    note: string;
    rehearsal_date: string | null;
    start_time: string | null;
    rehearsal_time: string | null;
  }[],
): Promise<ActionState> {
  try {
    const user = await getCurrentUser();
    if (!user?.isRoot) return { ok: false, message: "Only root can change the roster by hand." };
    const roster = await draftFor(rosterId, user);
    if (roster.status !== "revision") return { ok: false, message: "This only undoes changes while editing a published roster." };
    const db = createAdminClient();
    const { data: sessions } = await db.from("roster_sessions").select("id").eq("roster_id", rosterId);
    const ids = new Set((sessions ?? []).map((s) => s.id as string));
    // Sessions removed meanwhile can't come back, and neither can their people.
    snapshot = Array.isArray(snapshot) ? snapshot.filter((a) => ids.has(a.session_id)) : [];
    for (const s of Array.isArray(sessionSettings) ? sessionSettings : []) {
      if (!ids.has(s.id)) continue;
      const { error } = await db
        .from("roster_sessions")
        .update({
          date: String(s.date),
          name: String(s.name),
          ministry: ["em", "cm", "any"].includes(s.ministry) ? s.ministry : "any",
          weight: Number(s.weight),
          composition: cleanComposition(s.composition as Composition),
          cancelled: Boolean(s.cancelled),
          cancel_reason: s.cancelled ? String(s.cancel_reason ?? "").slice(0, 120) : "",
          note: String(s.note ?? ""),
          rehearsal_date: s.rehearsal_date || null,
          start_time: s.start_time || null,
          rehearsal_time: s.rehearsal_time || null,
        })
        .eq("id", s.id);
      if (error) throw error;
    }
    const rows = snapshot.map((a) => ({
      session_id: a.session_id,
      member_id: String(a.member_id),
      role: String(a.role),
      also_roles: Array.isArray(a.also_roles) ? a.also_roles.map(String) : [],
    }));
    if (ids.size) {
      const { error } = await db.from("roster_assignments").delete().in("session_id", [...ids]);
      if (error) throw error;
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("roster_assignments").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
    await audit(user.id, "roster.revision_cancel_edit", rosterId, { assignments: rows.length });
    const problem = await recheck(rosterId, true);
    revalidatePath(`/roster/${rosterId}`, "layout");
    return { ok: true, message: problem ? `Changes undone, but the roster couldn't be re-checked: ${problem}` : null };
  } catch (e) {
    return fail(e);
  }
}
