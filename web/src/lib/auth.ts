import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/permissions";
import { chosenTeamSlug, teamBySlug, type Team } from "@/lib/teams";
import type { TeamGroup } from "@/lib/team-config";

/**
 * What an observer can do in each of its group's teams: look (some may also manage permissions:
 * observerManagesPermissions). It sees every
 * published session plan, the team directory and the roster (and, like a lead, everyone's absences).
 */
export const OBSERVER_PERMISSIONS: readonly Permission[] = ["roster.view", "team.view", "sessions.view"];

/**
 * Developers can view the app as the lead, as one permission group, or as one person (cookie value
 * "person:<id>"), to test what others see. Viewing as a person assumes their account: changes are
 * made as them (their id, their permissions).
 */
export const VIEW_AS_COOKIE = "bw-view-as";
export const VIEW_AS_PERSON = "person:";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  /** The team chosen at login. Everything they see and change is this team's. */
  team: Team;
  /**
   * Lead powers in this team right now: true for the team's lead, and for root and developers
   * (unless a developer is viewing as a group or another person).
   */
  isLead: boolean;
  /** The app-wide root account: every permission in every team, and creates teams. */
  isRoot: boolean;
  /**
   * An observer account: on no team, read-only, overseeing one group's teams (e.g. Youth Worship and
   * Youth Media). Its view is like root's "Brighton Serving", limited to that group.
   */
  isObserver: boolean;
  /** The group an observer oversees; null for everyone else. */
  observerGroup: TeamGroup | null;
  /**
   * An observer root allowed to manage its teams' permissions (groups, everyone's access, denying
   * the lead, transferring the lead): the Youth observer. False for everyone else.
   */
  observerManagesPermissions: boolean;
  /**
   * An observer root allowed to see everyone's absences on its teams (the Youth observer). Without
   * it, its Absences page shows only services. False for everyone else.
   */
  observerSeesAbsences: boolean;
  /** The real account type, unaffected by "view as". */
  isDeveloper: boolean;
  /** For developers: "lead", a group name, a person's name, or null (their own full access). */
  viewAs: string | null;
  /** The view-as cookie value in use ("lead", a group name or "person:<id>"), or null. */
  viewAsKey: string | null;
  /**
   * Set while a developer acts as a person: id, name, email and permissions above are that
   * person's, and changes are made as them. realId is the developer's own account.
   */
  viewingAsPerson: { realId: string; realName: string } | null;
  /** Still on the default password: every page sends them to /change-password. */
  mustChangePassword: boolean;
  permissions: ReadonlySet<string>;
  can: (permission: Permission) => boolean;
};

/**
 * The signed-in, active user, or null. Unlike getCurrentUser this includes members still on
 * the default password; only the sign-in and change-password flow should use it.
 */
export const getSessionUser = cache(async (): Promise<CurrentUser | null> => {
  // Session checks compare token expiry with the current time, so they must run per request.
  await connection();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const team = await teamBySlug(await chosenTeamSlug());
  if (!team) return null;

  const admin = createAdminClient();
  const [{ data: profile }, { data: membership }, { data: perms }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, is_root, is_developer, is_active, must_change_password, observer_group, observer_manages_permissions, observer_sees_absences")
      .eq("id", userId)
      .single(),
    admin.from("team_members").select("is_lead").eq("team_id", team.id).eq("user_id", userId).maybeSingle(),
    supabase.rpc("my_team_permissions", { p_team_id: team.id }),
  ]);
  if (!profile || !profile.is_active) return null;
  const isRoot = Boolean(profile.is_root);
  const observerGroup = (profile.observer_group as TeamGroup | null) ?? null;
  // Signed in, but not on the team chosen at login: they count as signed out for this team.
  // Root and developers can open every team; an observer, every team in its group.
  if (!membership && !profile.is_developer && !isRoot && !(observerGroup && team.group === observerGroup)) return null;
  if (observerGroup && !isRoot && !profile.is_developer) {
    const perms = new Set<string>(OBSERVER_PERMISSIONS);
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      team,
      isLead: false,
      isRoot: false,
      isObserver: true,
      observerGroup,
      observerManagesPermissions: Boolean(profile.observer_manages_permissions),
      observerSeesAbsences: Boolean(profile.observer_sees_absences),
      isDeveloper: false,
      viewAs: null,
      viewAsKey: null,
      viewingAsPerson: null,
      mustChangePassword: Boolean(profile.must_change_password),
      permissions: perms,
      can: (p) => perms.has(p),
    };
  }

  // Already capped by the team's ceiling: the lead gets everything that team may do.
  let permissions = new Set<string>((perms as string[] | null) ?? []);
  let isLead: boolean = Boolean(membership?.is_lead) || isRoot || profile.is_developer;
  let viewAs: string | null = null;
  let viewAsKey: string | null = null;

  if (profile.is_developer) {
    const wanted = (await cookies()).get(VIEW_AS_COOKIE)?.value ?? null;
    if (wanted?.startsWith(VIEW_AS_PERSON)) {
      // See the app exactly as this person does in this team: their identity and their permissions.
      const personId = wanted.slice(VIEW_AS_PERSON.length);
      const [{ data: person }, { data: theirMembership }, { data: theirPerms }] = await Promise.all([
        admin.from("profiles").select("id, email, full_name, is_developer, is_active").eq("id", personId).maybeSingle(),
        admin.from("team_members").select("is_lead").eq("team_id", team.id).eq("user_id", personId).maybeSingle(),
        admin.rpc("team_permissions", { p_user_id: personId, p_team_id: team.id }),
      ]);
      if (person && person.is_active && !person.is_developer && theirMembership) {
        const perms = new Set<string>((theirPerms as string[] | null) ?? []);
        return {
          id: person.id,
          email: person.email,
          fullName: person.full_name,
          team,
          isLead: Boolean(theirMembership.is_lead),
          isRoot: false,
          isObserver: false,
          observerGroup: null,
          observerManagesPermissions: false,
          observerSeesAbsences: false,
          isDeveloper: true,
          viewAs: person.full_name || person.email,
          viewAsKey: wanted,
          viewingAsPerson: { realId: profile.id, realName: profile.full_name || profile.email },
          mustChangePassword: false,
          permissions: perms,
          can: (p) => perms.has(p),
        };
      }
    } else if (wanted === "lead") {
      viewAs = "lead";
      viewAsKey = "lead";
    } else if (wanted) {
      // View as one of this team's permission groups: exactly that group's permissions (within
      // the team's ceiling), no lead powers.
      const { data: group } = await admin
        .from("groups")
        .select("name, group_permissions(permission_key)")
        .eq("team_id", team.id)
        .eq("name", wanted)
        .maybeSingle();
      if (group) {
        viewAs = group.name as string;
        viewAsKey = viewAs;
        isLead = false;
        const all = permissions; // a developer's permissions are the team's whole ceiling
        permissions = new Set(
          ((group.group_permissions as { permission_key: string }[]) ?? []).map((g) => g.permission_key).filter((k) => all.has(k)),
        );
      }
    }
  }

  const finalPermissions = permissions;
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    team,
    isLead,
    isRoot,
    isObserver: false,
    observerGroup: null,
    observerManagesPermissions: false,
    observerSeesAbsences: false,
    isDeveloper: Boolean(profile.is_developer),
    viewAs,
    viewAsKey,
    viewingAsPerson: null,
    mustChangePassword: Boolean(profile.must_change_password),
    permissions: finalPermissions,
    can: (p) => finalPermissions.has(p),
  };
});

/**
 * The signed-in, active user with their effective permissions, or null. Members who still
 * have to change the default password count as signed out everywhere (pages, actions, APIs).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await getSessionUser();
  return user && !user.mustChangePassword ? user : null;
}

/** Where each kind of team's interface starts. */
export const TEAM_HOME: Record<Team["kind"], string> = { worship: "/home", media: "/media" };

/**
 * Use at the top of protected pages. Sends signed-out users to the landing page, and people
 * signed into a different kind of team to that team's own interface (a media team member never
 * sees the worship app's pages, and the other way round).
 */
export async function requireUser(kind: Team["kind"] = "worship"): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (user.mustChangePassword) redirect("/change-password");
  // Root and observers aren't on any team: they always get their own view (the worship app's pages,
  // as "Brighton Serving"), whichever team they're looking at.
  if (user.team.kind !== kind && !user.isRoot && !user.isObserver) redirect(TEAM_HOME[user.team.kind]);
  // An observer's view is always the worship app's pages, even while looking at a media team.
  if (user.isObserver && kind !== "worship") redirect(TEAM_HOME.worship);
  return user;
}

const CHANGE_PASSWORD_FIRST = "Choose a new password before doing anything else.";

export class PermissionError extends Error {
  constructor(permission: Permission) {
    super(`You don't have permission to do this (${permission}).`);
  }
}

/** Use in server actions before any write. Throws if the user lacks the permission. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (user.mustChangePassword) throw new Error(CHANGE_PASSWORD_FIRST);
  if (!user.can(permission)) throw new PermissionError(permission);
  return user;
}

/** For lead-only actions in the current team (managing members and permissions). */
export async function requireLead(): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (user.mustChangePassword) throw new Error(CHANGE_PASSWORD_FIRST);
  if (!user.isLead) throw new Error("Only the team's lead can do this.");
  return user;
}

/**
 * For managing permissions in the current team (groups, everyone's access, handing over the lead):
 * the team's lead, root and developers, and the observer of the team's group when root allowed it
 * (which may also deny the lead permissions).
 */
export async function requirePermissionsManager(): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (user.mustChangePassword) throw new Error(CHANGE_PASSWORD_FIRST);
  if (!user.isLead && !user.observerManagesPermissions) throw new Error("Only the team's lead can do this.");
  return user;
}

/** Root, developers (not as someone else) and a permission-managing observer: above a team's lead, so can change the lead's access. */
export function overseesLeads(user: CurrentUser): boolean {
  return user.observerManagesPermissions || user.isRoot || (user.isDeveloper && !user.viewingAsPerson);
}

/** For the root account (and developers): creating teams and setting their maximum permissions. */
export async function requireRoot(): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (user.mustChangePassword) throw new Error(CHANGE_PASSWORD_FIRST);
  if (!user.isRoot && !(user.isDeveloper && !user.viewingAsPerson)) throw new Error("Only the root account can do this.");
  return user;
}
