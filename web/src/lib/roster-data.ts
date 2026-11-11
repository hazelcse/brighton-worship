import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Composition, Ministry, People, Rule, RuleParams, SessionKind } from "@/lib/roster";
import type { RosterCheck } from "@/lib/roster-check";

/** Where a rule was missed: these people on these dates (no people = everyone on those dates). */
export type Where = { members: string[]; dates: string[] };

export type RosterRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  /** "revision": root's edit of a published roster (revision_of), not yet republished. */
  status: "draft" | "published" | "archived" | "revision";
  revision_of?: string | null;
  created_at: string;
  published_at: string | null;
  generated_at?: string | null;
};

export type SessionRow = {
  id: string;
  roster_id: string;
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
  /** The band's rehearsal for this session, if it has one. */
  rehearsal_date: string | null;
  /** "HH:MM:SS"; null = the default for its kind (see defaultStartTime / defaultRehearsalTime). */
  start_time: string | null;
  rehearsal_time: string | null;
};

export async function listRosters(): Promise<RosterRow[]> {
  const { data, error } = await createAdminClient()
    .from("rosters")
    .select("id, starts_on, ends_on, status, created_at, published_at, generated_at")
    .neq("status", "revision") // edits of published rosters aren't rosters of their own
    .order("starts_on", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RosterRow[];
}

/** The published roster covering a date, if any. */
export async function publishedRosterFor(date: string): Promise<RosterRow | null> {
  const { data } = await createAdminClient()
    .from("rosters")
    .select("id, starts_on, ends_on, status, created_at, published_at")
    .eq("status", "published")
    .lte("starts_on", date)
    .gte("ends_on", date)
    .maybeSingle();
  return (data as RosterRow) ?? null;
}

export async function loadRoster(id: string): Promise<{ roster: RosterRow; sessions: SessionRow[] } | null> {
  const db = createAdminClient();
  const [{ data: roster }, { data: sessions }] = await Promise.all([
    db.from("rosters").select("id, starts_on, ends_on, status, revision_of, created_at, published_at").eq("id", id).maybeSingle(),
    db.from("roster_sessions").select("*").eq("roster_id", id).order("date").order("kind"),
  ]);
  if (!roster) return null;
  return {
    roster: roster as RosterRow,
    sessions: ((sessions ?? []) as SessionRow[]).map((s) => ({ ...s, weight: Number(s.weight) })),
  };
}

/** Rules that apply to this roster: the defaults plus its own. */
export async function loadRules(rosterId: string): Promise<Rule[]> {
  const { data, error } = await createAdminClient()
    .from("roster_rules")
    .select("id, hard, weight, enabled, permanent, roster_id, template, params")
    .or(`roster_id.is.null,roster_id.eq.${rosterId}`)
    .order("permanent", { ascending: false })
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    hard: r.hard as boolean,
    weight: Number(r.weight),
    enabled: r.enabled as boolean,
    permanent: r.permanent as boolean,
    rosterId: (r.roster_id as string | null) ?? null,
    params: { ...(r.params as object), template: r.template } as RuleParams,
  }));
}

/** Every rule (defaults and each roster's own), with the roster a roster-only rule belongs to. */
export async function loadAllRules(): Promise<(Rule & { roster: { id: string; starts_on: string; status: string } | null })[]> {
  const { data, error } = await createAdminClient()
    .from("roster_rules")
    .select("id, hard, weight, enabled, permanent, roster_id, template, params, rosters(id, starts_on, status)")
    .order("permanent", { ascending: false })
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    hard: r.hard as boolean,
    weight: Number(r.weight),
    enabled: r.enabled as boolean,
    permanent: r.permanent as boolean,
    rosterId: (r.roster_id as string | null) ?? null,
    params: { ...(r.params as object), template: r.template } as RuleParams,
    roster: (r.rosters as unknown as { id: string; starts_on: string; status: string } | null) ?? null,
  }));
}

/** Active team members, for rule pickers and capacity checks. */
export async function loadPeople(): Promise<People> {
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, full_name, email, instruments, em_percent, serves, is_active")
    .eq("is_active", true)
    .eq("is_developer", false) // developer accounts are never rostered
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string) || (p.email as string),
    instruments: (p.instruments as string[]) ?? [],
    emPercent: p.em_percent as number | null,
    serves: ((p.serves as string) ?? "both") as "both" | "sunday" | "pnp",
  }));
}

export type AwayRow = { memberId: string; startsOn: string; endsOn: string; reason: string };

/** Absences that overlap the given dates (inclusive). The roster generator never uses people on these days. */
export async function loadAbsences(startsOn: string, endsOn: string): Promise<AwayRow[]> {
  const { data, error } = await createAdminClient()
    .from("absences")
    .select("member_id, starts_on, ends_on, reason")
    .lte("starts_on", endsOn)
    .gte("ends_on", startsOn);
  if (error) throw error;
  return (data ?? []).map((a) => ({ memberId: a.member_id, startsOn: a.starts_on, endsOn: a.ends_on, reason: a.reason }));
}

export type AssignmentRow = { session_id: string; member_id: string; name: string; role: string; also_roles: string[] };

export async function loadAssignments(sessionIds: string[]): Promise<AssignmentRow[]> {
  if (!sessionIds.length) return [];
  const { data, error } = await createAdminClient()
    .from("roster_assignments")
    .select("session_id, member_id, role, also_roles, profiles(full_name)")
    .in("session_id", sessionIds);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    session_id: r.session_id as string,
    member_id: r.member_id as string,
    name: ((r.profiles as unknown as { full_name: string } | null)?.full_name ?? "?") as string,
    role: r.role as string,
    also_roles: (r.also_roles as string[]) ?? [],
  }));
}

export type GenerationResult = {
  status: "optimal" | "feasible" | "impossible";
  unfilled: { session: string; date: string; name: string; role: string; missing: number }[];
  hard_broken: { rule: string; violations: number; checks: number; where?: Where[] }[];
  soft: { rule: string; violations: number; checks: number; penalty: number; where?: Where[] }[];
  loads: {
    member: string;
    name: string;
    services: number;
    /** Main services vs Prayer & Praise (older results don't have these). */
    main?: number;
    pnp?: number;
    /** Below 1 = serves less (from the fairness rule). */
    factor?: number;
    weighted: number;
    em: number;
    cm: number;
    em_target: number | null;
    em_actual: number | null;
  }[];
  weights: { fairness: number; em_cm_split: number; rules: Record<string, { hard: boolean; weight: number }>; sessions: Record<string, number> };
  objective: Record<string, number>;
  /** Pairs of one person's services within 1 / 2 / 3 weeks of each other (newer results only). */
  spacing?: { within_1_week: number; within_2_weeks: number; within_3_weeks: number };
  /** How mixed the teams are (newer results only). */
  variety?: { pairs: number; repeats: number; max_together: number };
  solve_seconds: number;
};

export async function loadResult(
  rosterId: string,
): Promise<{
  result: GenerationResult | null;
  generatedAt: string | null;
  check: RosterCheck | null;
  hasSnapshot: boolean;
  /** "sessionId|role|memberId" of everyone the optimiser put in (to spot names changed by hand). */
  generatedKeys: string[];
}> {
  const { data } = await createAdminClient()
    .from("rosters")
    .select("result, generated_at, check, generated_assignments")
    .eq("id", rosterId)
    .maybeSingle();
  return {
    result: (data?.result as GenerationResult) ?? null,
    generatedAt: (data?.generated_at as string) ?? null,
    check: (data?.check as RosterCheck) ?? null,
    hasSnapshot: Boolean(data?.generated_assignments),
    generatedKeys: ((data?.generated_assignments as { session_id: string; role: string; member_id: string }[] | null) ?? []).map(
      (a) => `${a.session_id}|${a.role}|${a.member_id}`,
    ),
  };
}
