import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { readTeamConfig, type TeamConfig, type TeamGroup, type TeamKind } from "@/lib/team-config";

export type { TeamConfig, TeamGroup, TeamKind };

/**
 * Teams share one login. The login page shows one title per kind of team ("Brighton Worship",
 * "Brighton Media"; press and hold to switch, remembered in LOGIN_KIND_COOKIE). Logging in opens
 * the team of that kind the person is on (Main Worship, Youth Worship, ...), kept in TEAM_COOKIE;
 * every page then shows only that team.
 */
export const TEAM_COOKIE = "bw-team";
export const LOGIN_KIND_COOKIE = "bw-login"; // also written by components/team-login.tsx
export const DEFAULT_TEAM = "main-worship";

/** The login page's title for each kind of team. */
export const KIND_TITLE: Record<TeamKind, string> = { worship: "Brighton Worship", media: "Brighton Media" };
/** What root sees in its own view (root isn't on any team). */
export const ROOT_TITLE = "Brighton Serving";

/** The login page's last choice (worship when there's none). */
export async function chosenLoginKind(): Promise<TeamKind> {
  return (await cookies()).get(LOGIN_KIND_COOKIE)?.value === "media" ? "media" : "worship";
}

/**
 * The team someone logs into from a kind's login page: of the teams of that kind they're on, a Main
 * team first (e.g. Main Worship before Youth Worship), then in team order. They can switch to their
 * other teams from the profile menu (switchTeam).
 * Developers aren't on any team: they open the kind's first team. Root and observers don't log into
 * a team at all (they get Brighton Serving, outside every team), so this isn't asked for them.
 */
export async function loginTeam(
  kind: TeamKind,
  userId: string,
  opts: { isDeveloper: boolean },
): Promise<Team | null> {
  const db = createAdminClient();
  const { data: teams } = await db.from("teams").select(COLUMNS).eq("kind", kind).order("position");
  // Main teams before Youth ones, then in the Teams page's order.
  const list = (teams ?? []).map(toTeam).sort((a, b) => Number(a.group !== "main") - Number(b.group !== "main"));
  if (opts.isDeveloper) return list[0] ?? null;
  if (!list.length) return null;
  const { data: mine } = await db.from("team_members").select("team_id").eq("user_id", userId).in("team_id", list.map((t) => t.id));
  const on = new Set((mine ?? []).map((m) => m.team_id as string));
  return list.find((t) => on.has(t.id)) ?? null;
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
