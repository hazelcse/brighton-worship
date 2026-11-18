import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { readTeamConfig, type TeamConfig, type TeamGroup, type TeamKind } from "@/lib/team-config";

export type { TeamConfig, TeamGroup, TeamKind };

/**
 * Teams share one login. The login page's title just cycles "Brighton Worship" / "Brighton Media";
 * logging in opens the person's own team (see loginTeam), kept in TEAM_COOKIE; every page then
 * shows only that team.
 */
export const TEAM_COOKIE = "bw-team";
export const DEFAULT_TEAM = "main-worship";

/** The login page's title for each kind of team. */
export const KIND_TITLE: Record<TeamKind, string> = { worship: "Brighton Worship", media: "Brighton Media" };
/** What root sees in its own view (root isn't on any team). */
export const ROOT_TITLE = "Brighton Serving";

/** Main teams before Youth ones, then in the Teams page's order. */
function mainFirst(list: Team[]): Team[] {
  return [...list].sort((a, b) => Number(a.group !== "main") - Number(b.group !== "main"));
}

/**
 * The team someone opens when they log in. Someone on one kind of team (worship or media) gets
 * theirs; someone on both gets the kind they chose in Settings (profiles.landing_kind; worship when
 * they haven't). Within a kind, a Main team comes first (Main Worship before Youth Worship), then
 * team order. They switch to their other teams from the profile menu (switchTeam).
 * Developers aren't on any team: they open the first worship team. Root and observers don't log
 * into a team at all (they get Brighton Serving, outside every team), so this isn't asked for them.
 */
export async function loginTeam(
  userId: string,
  opts: { isDeveloper: boolean; landingKind: TeamKind | null },
): Promise<Team | null> {
  const all = await loadTeams();
  const byKind = (kind: TeamKind, list: Team[]) => mainFirst(list.filter((t) => t.kind === kind));
  if (opts.isDeveloper) return byKind("worship", all)[0] ?? byKind("media", all)[0] ?? null;
  const { data: mine } = await createAdminClient().from("team_members").select("team_id").eq("user_id", userId);
  const on = new Set((mine ?? []).map((m) => m.team_id as string));
  const theirs = all.filter((t) => on.has(t.id));
  const first: TeamKind = opts.landingKind ?? "worship";
  return byKind(first, theirs)[0] ?? byKind(first === "worship" ? "media" : "worship", theirs)[0] ?? null;
}

/** The kinds of team (worship, media) someone is on. */
export async function memberKinds(userId: string): Promise<Set<TeamKind>> {
  const { data } = await createAdminClient().from("team_members").select("teams!inner(kind)").eq("user_id", userId);
  return new Set((data ?? []).map((r) => ((r.teams as unknown as { kind: string }).kind === "media" ? "media" : "worship") as TeamKind));
}

export type Team = {
  id: string;
  slug: string;
  name: string;
  kind: TeamKind;
  /** Main or Youth: each group has a worship team and a media team. */
  group: TeamGroup;
  /** How this team works (sessions, member fields, ...): see team-config.ts. */
  config: TeamConfig;
};

const COLUMNS = "id, slug, name, kind, team_group, config";

type TeamRow = { id: string; slug: string; name: string; kind: string; team_group: string; config: unknown };

/** A teams row, with its config checked and filled in from its group and kind's preset. */
function toTeam(r: TeamRow): Team {
  const kind = (r.kind === "media" ? "media" : "worship") as TeamKind;
  const group = (r.team_group === "youth" ? "youth" : "main") as TeamGroup;
  return { id: r.id, slug: r.slug, name: r.name, kind, group, config: readTeamConfig(r.config, group, kind) };
}

/** Every team, in login-page order. */
export async function loadTeams(): Promise<Team[]> {
  const { data } = await createAdminClient().from("teams").select(COLUMNS).order("position");
  return ((data ?? []) as TeamRow[]).map(toTeam);
}

/** A group's teams (e.g. Youth Worship and Youth Media), in login-page order. */
export async function groupTeams(group: TeamGroup): Promise<Team[]> {
  return (await loadTeams()).filter((t) => t.group === group);
}

export async function teamBySlug(slug: string): Promise<Team | null> {
  const { data } = await createAdminClient().from("teams").select(COLUMNS).eq("slug", slug).maybeSingle();
  return data ? toTeam(data as TeamRow) : null;
}

/** The slug in the team cookie, or null when there's none (members then get DEFAULT_TEAM; root and observers, Brighton Serving). */
export async function chosenTeamSlug(): Promise<string | null> {
  return (await cookies()).get(TEAM_COOKIE)?.value || null;
}

/** The ids of everyone on a team (not developers: they aren't members of any team). */
export async function teamMemberIds(teamId: string): Promise<string[]> {
  const { data } = await createAdminClient().from("team_members").select("user_id").eq("team_id", teamId);
  return (data ?? []).map((r) => r.user_id as string);
}

/** The lead of a team, or null. */
export async function teamLeadId(teamId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("team_members").select("user_id").eq("team_id", teamId).eq("is_lead", true).maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

/** Someone's place on a team: null when they aren't on it. */
export async function membership(teamId: string, userId: string): Promise<{ isLead: boolean } | null> {
  const { data } = await createAdminClient().from("team_members").select("is_lead").eq("team_id", teamId).eq("user_id", userId).maybeSingle();
  return data ? { isLead: Boolean(data.is_lead) } : null;
}

/**
 * Someone's profile on one team (team_members): what they play or do there, their EM/CM share,
 * which services they serve at and their personal rule. A person on two teams has one login and
 * name but a separate profile on each.
 */
export type TeamProfile = {
  instruments: string[];
  noRosterRoles: string[];
  emPercent: number | null;
  serves: "both" | "sunday" | "pnp";
};

const PROFILE_COLUMNS = "user_id, instruments, no_roster_roles, em_percent, serves";

function toProfile(r: Record<string, unknown>): TeamProfile {
  const sv = r.serves;
  return {
    instruments: (r.instruments as string[] | null) ?? [],
    noRosterRoles: (r.no_roster_roles as string[] | null) ?? [],
    emPercent: (r.em_percent as number | null) ?? null,
    serves: sv === "sunday" || sv === "pnp" ? sv : "both",
  };
}

/** Everyone's profile on a team (or just these people's), by user id. */
export async function teamProfiles(teamId: string, userIds?: string[]): Promise<Map<string, TeamProfile>> {
  let q = createAdminClient().from("team_members").select(PROFILE_COLUMNS).eq("team_id", teamId);
  if (userIds) {
    if (!userIds.length) return new Map();
    q = q.in("user_id", userIds);
  }
  const { data, error } = await q;
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.user_id as string, toProfile(r)]));
}

/** One person's profile on a team, or null when they aren't on it. */
export async function teamProfile(teamId: string, userId: string): Promise<TeamProfile | null> {
  return (await teamProfiles(teamId, [userId])).get(userId) ?? null;
}

/** What someone plays on the team whose roster this session is on ([] when they aren't on it). */
export async function sessionInstruments(sessionId: string, userId: string): Promise<string[]> {
  const { data } = await createAdminClient().from("roster_sessions").select("rosters!inner(team_id)").eq("id", sessionId).maybeSingle();
  const teamId = (data?.rosters as unknown as { team_id: string } | null)?.team_id;
  return teamId ? ((await teamProfile(teamId, userId))?.instruments ?? []) : [];
}
