import { createAdminClient } from "@/lib/supabase/admin";
import { teamMemberIds } from "@/lib/teams";
import { ROLE_LABEL, isRole, type TeamGroup } from "@/lib/team-config";

/**
 * Labels for what a member can play or do on any team (worship instruments and media roles).
 * Which ones a team offers: teamRoles(team.config) in team-config.ts.
 */
export const INSTRUMENT_LABEL = ROLE_LABEL;
export const isInstrument = isRole;

/** 100 = EM only, 0 = CM only, anything between = serves both. */
export function ministryLabel(emPercent: number | null): string | null {
  if (emPercent === null || emPercent === undefined) return null;
  if (emPercent >= 100) return "EM";
  if (emPercent <= 0) return "CM";
  return "EM/CM";
}

export type Gender = "male" | "female";
export type Serves = "both" | "sunday" | "pnp";
export const SERVES_LABEL: Record<Serves, string> = { both: "Sunday & P&P", sunday: "Sunday only", pnp: "P&P only" };
export const GENDER_LABEL: Record<Gender, string> = { male: "Male", female: "Female" };

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith("@placeholder.invalid");
}

export type Member = {
  id: string;
  uid: number | null;
  name: string;
  email: string;
  /** What they play or do on this team (their profile for this team; other teams keep their own). */
  instruments: string[];
  /** Their personal rule: parts they can play but shouldn't be rostered for. */
  noRosterRoles: string[];
  emPercent: number | null;
  gender: Gender | null;
  serves: Serves;
  isLead: boolean;
  /** The other teams they're on (linked: same person and login, a separate profile on each). */
  otherTeams: string[];
  isDeveloper: boolean;
  /** An observer account (on no team; root sees it in the directory of the group it observes). */
  isObserver: boolean;
  isActive: boolean;
  groups: string[];
};

type Row = {
  id: string;
  uid: number | null;
  full_name: string;
  email: string;
  gender: Gender | null;
  is_developer: boolean | null;
  observer_group: TeamGroup | null;
  is_active: boolean;
  user_groups: { groups: { name: string; team_id: string } | null }[] | null;
  team_members: TeamProfileRow[] | null;
};

/** Someone's profile on one team (team_members). */
type TeamProfileRow = {
  team_id: string;
  is_lead: boolean;
  instruments: string[] | null;
  no_roster_roles: string[] | null;
  em_percent: number | null;
  serves: Serves | null;
  teams: { name: string } | null;
};

function toMember(r: Row, teamId: string): Member {
  // Their profile on this team (developer accounts are on no team, so have none).
  const t = (r.team_members ?? []).find((x) => x.team_id === teamId);
  return {
    id: r.id,
    uid: r.uid,
    name: r.full_name || r.email,
    email: r.email,
    instruments: t?.instruments ?? [],
    noRosterRoles: t?.no_roster_roles ?? [],
    emPercent: t?.em_percent ?? null,
    gender: r.gender,
    serves: t?.serves ?? "both",
    isLead: Boolean(t?.is_lead),
    otherTeams: (r.team_members ?? []).filter((x) => x.team_id !== teamId && x.teams).map((x) => x.teams!.name),
    isDeveloper: Boolean(r.is_developer),
    isObserver: Boolean(r.observer_group),
    isActive: r.is_active,
    // Only this team's permission groups.
    groups: (r.user_groups ?? [])
      .filter((g) => g.groups?.team_id === teamId)
      .map((g) => g.groups!.name),
  };
}

const SELECT =
  "id, uid, full_name, email, gender, is_developer, observer_group, is_active, user_groups(groups(name, team_id)), team_members(team_id, is_lead, instruments, no_roster_roles, em_percent, serves, teams(name))";

/**
 * One team's members. Developer and observer accounts aren't on any team: they're left out unless
 * includeDevelopers (root's view only; `observerOf` is the team's group, whose observer then shows),
 * and are never rostered or counted.
 */
export async function loadMembers(
  teamId: string,
  { includeDevelopers = false, observerOf }: { includeDevelopers?: boolean; observerOf?: TeamGroup } = {},
): Promise<Member[]> {
  const ids = await teamMemberIds(teamId);
  let query = createAdminClient().from("profiles").select(SELECT);
  const idList = `id.in.(${ids.join(",") || "00000000-0000-0000-0000-000000000000"})`;
  query = includeDevelopers
    ? query.or(`is_developer.eq.true,${observerOf ? `observer_group.eq.${observerOf},` : ""}${idList}`)
    : query.in("id", ids).eq("is_developer", false);
  const { data, error } = await query.order("uid", { nullsFirst: false }).order("full_name");
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map((r) => toMember(r, teamId));
}

/** A member of this team (or, with includeDevelopers, a developer account or the group's observer), or null. */
export async function loadMember(
  id: string,
  teamId: string,
  { includeDevelopers = false, observerOf }: { includeDevelopers?: boolean; observerOf?: TeamGroup } = {},
): Promise<Member | null> {
  const { data } = await createAdminClient().from("profiles").select(SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as unknown as Row;
  const m = toMember(row, teamId);
  if (m.isDeveloper) return includeDevelopers ? m : null;
  if (row.observer_group) return includeDevelopers && row.observer_group === observerOf ? m : null;
  return (row.team_members ?? []).some((t) => t.team_id === teamId) ? m : null;
}
