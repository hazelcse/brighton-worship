import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { DEFAULT_TEAM, chosenTeamSlug, teamBySlug, type Team } from "@/lib/teams";
import type { TeamGroup } from "@/lib/team-config";

/**
 * What an observer can do in each of its group's teams: look (some may also manage permissions:
 * observerManagesPermissions). It sees every
 * published session plan, the team directory and the roster (and, like a lead, everyone's absences).
 */
export const OBSERVER_PERMISSIONS: readonly Permission[] = ["roster.view", "team.view", "sessions.view"];

/**
 * Developers pick a team by group (Main/Youth) and kind (Worship/Media), and see it with a standard
 * account (their own full access) or as that group's observer (cookie value "observer"), in any
 * combination. They can also act as one person (cookie value "person:<id>"), which assumes that
 * person's account: changes are made as them (their id, their permissions).
 */
export const VIEW_AS_COOKIE = "bw-view-as";
export const VIEW_AS_PERSON = "person:";
export const VIEW_AS_OBSERVER = "observer";

/**
 * A developer's observer view can also set the observer's permissions for the view (the real
 * observer account isn't changed): "observer" uses the group's real settings, "observer:<m><a>"
 * sets them, each 1 or 0 (m: manages permissions, a: sees absences), e.g. "observer:10".
 */
export type ObserverView = { managesPermissions?: boolean; seesAbsences?: boolean };

export function observerViewCookie(view: ObserverView): string {
  if (view.managesPermissions === undefined || view.seesAbsences === undefined) return VIEW_AS_OBSERVER;
  return `${VIEW_AS_OBSERVER}:${Number(view.managesPermissions)}${Number(view.seesAbsences)}`;
}

/** The observer view a view-as cookie asks for, or null when it isn't one. */
export function parseObserverView(value: string | null): ObserverView | null {
  if (value === VIEW_AS_OBSERVER) return {};
  const m = value?.match(/^observer:([01])([01])$/);
  return m ? { managesPermissions: m[1] === "1", seesAbsences: m[2] === "1" } : null;
}

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  /**
   * The team they're working in. Everything they see and change is this team's.
   * Null for root and observers on Brighton Serving: their own view, outside every team, drawing
   * on all the teams they oversee (worship and media). They open a team from Team to work in it.
   */
  team: Team | null;
  /**
   * Lead powers in this team right now: true for the team's lead, and for root and developers
   * (unless a developer is viewing as an observer or another person).
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
  /** For developers: "observer", a person's name, or null (their own full access). */
  viewAs: string | null;
  /** The view-as cookie value in use ("observer" or "person:<id>"), or null. */
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

/** Someone working in a team (everyone but root and observers on Brighton Serving). */
export type TeamUser = CurrentUser & { team: Team };

/** Root or an observer on Brighton Serving: outside every team. */
export const onServing = (user: Pick<CurrentUser, "team">): boolean => !user.team;

const OPEN_A_TEAM = "Open a team first (from Team), then try again.";

/** For actions that change one team's things: throws on Brighton Serving, where there's no team. */
export function inTeam(user: CurrentUser): TeamUser {
  if (!user.team) throw new Error(OPEN_A_TEAM);
  return user as TeamUser;
}

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

  const cookieSlug = await chosenTeamSlug();
  const [{ data: profile }, chosen] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, is_root, is_developer, is_active, must_change_password, observer_group, observer_manages_permissions, observer_sees_absences")
      .eq("id", userId)
      .single(),
    cookieSlug ? teamBySlug(cookieSlug) : Promise.resolve(null),
  ]);
  if (!profile || !profile.is_active) return null;
  const isRoot = Boolean(profile.is_root);
  const observerGroup = (profile.observer_group as TeamGroup | null) ?? null;
  const isRealObserver = Boolean(observerGroup) && !isRoot && !profile.is_developer;

  // Root and observers are on Brighton Serving (no team) until they open one of their teams.
  // Everyone else always works in a team: the one chosen at login, or the default.
  let team: Team | null;
  if (isRoot) team = chosen;
  else if (isRealObserver) team = chosen && chosen.group === observerGroup ? chosen : null;
  else team = chosen ?? (await teamBySlug(DEFAULT_TEAM));

  const admin = createAdminClient();
  const [{ data: membership }, { data: perms }] = team
    ? await Promise.all([
        admin.from("team_members").select("is_lead").eq("team_id", team.id).eq("user_id", userId).maybeSingle(),
        supabase.rpc("my_team_permissions", { p_team_id: team.id }),
      ])
    : [{ data: null }, { data: null }];
  if (!team && !isRoot && !isRealObserver) return null;
  // Signed in, but not on the team chosen at login: they count as signed out for this team.
  // Root and developers can open every team; an observer, every team in its group.
  if (team && !membership && !profile.is_developer && !isRoot && !(observerGroup && team.group === observerGroup)) return null;
  if (isRealObserver) {
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

  // Already capped by the team's ceiling: the lead gets everything that team may do. Root on
  // Brighton Serving (no team) may do everything.
  const permissions = new Set<string>(team ? ((perms as string[] | null) ?? []) : PERMISSIONS);
  const isLead: boolean = Boolean(membership?.is_lead) || isRoot || profile.is_developer;

  // Developers always work in a team (theirs falls back to DEFAULT_TEAM above).
  if (profile.is_developer && team) {
    const wanted = (await cookies()).get(VIEW_AS_COOKIE)?.value ?? null;
    const observerView = parseObserverView(wanted);
    if (observerView) {
      // See this team as its group's observer does: read-only, the worship app's pages, with what
      // that group's real observer account is allowed (managing permissions, seeing absences),
      // unless the developer picked those for this view.
      const { data: observer } = await admin
        .from("profiles")
        .select("observer_manages_permissions, observer_sees_absences")
        .eq("observer_group", team.group)
        .maybeSingle();
      const perms = new Set<string>(OBSERVER_PERMISSIONS);
      return {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        team,
        isLead: false,
        isRoot: false,
        isObserver: true,
        observerGroup: team.group,
        observerManagesPermissions: observerView.managesPermissions ?? Boolean(observer?.observer_manages_permissions),
        observerSeesAbsences: observerView.seesAbsences ?? Boolean(observer?.observer_sees_absences),
        isDeveloper: true,
        viewAs: VIEW_AS_OBSERVER,
        viewAsKey: wanted,
        viewingAsPerson: null,
        mustChangePassword: false,
        permissions: perms,
        can: (p) => perms.has(p),
      };
    }
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
    }
  }

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
    viewAs: null,
    viewAsKey: null,
    viewingAsPerson: null,
    mustChangePassword: Boolean(profile.must_change_password),
    permissions,
    can: (p) => permissions.has(p),
  };
});

/** A developer on their own full access: not acting as a person, not viewing as an observer. */
export function hasDeveloperAccess(user: Pick<CurrentUser, "isDeveloper" | "viewingAsPerson" | "isObserver">): boolean {
  return user.isDeveloper && !user.viewingAsPerson && !user.isObserver;
}

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
 * Media teams that also use the worship app's team pages: the roster, absences and the team
 * directory (and, for the lead, Manage permissions). Main Media for now.
 */
export function usesTeamPages(team: Pick<Team, "group" | "kind"> | null | undefined): boolean {
  return team?.kind === "worship" || (team?.kind === "media" && team.group === "main");
}

/**
 * Which pages a page is: one kind of team's ("worship", "media"); "team", a team page (roster,
 * absences, team directory) that worship teams and `usesTeamPages` media teams share; or "any"
 * (the app layout, which leaves the check to each page).
 */
export type PageKind = Team["kind"] | "team" | "any";

/**
 * Use at the top of protected pages. Sends signed-out users to the landing page, and people
 * signed into a different kind of team to that team's own interface (a media team member never
 * sees the worship app's pages, bar the team pages above, and the other way round).
 */
export async function requireUser(kind: PageKind = "worship"): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (user.mustChangePassword) redirect("/change-password");
  const allowed = kind === "any" || (kind === "team" ? usesTeamPages(user.team) : user.team?.kind === kind);
  // Root and observers aren't on any team: they always get their own view (the worship app's pages,
  // as "Brighton Serving"), whichever team they're looking at.
  if (user.team && !allowed && !user.isRoot && !user.isObserver) redirect(TEAM_HOME[user.team.kind]);
  // An observer's view is always the worship app's pages, even while looking at a media team.
  if (user.isObserver && kind === "media") redirect(TEAM_HOME.worship);
  return user;
}

/**
 * For pages about one team (its members, permissions, a roster, ...). On Brighton Serving, where
 * root and observers aren't in a team, it sends them to pick one, then back to `next` in it.
 */
export async function requireTeamUser(next: string, kind: PageKind = "worship"): Promise<TeamUser> {
  const user = await requireUser(kind);
  if (!user.team) redirect(`/teams/pick?next=${encodeURIComponent(next)}`);
  return user as TeamUser;
}

const CHANGE_PASSWORD_FIRST = "Choose a new password before doing anything else.";

export class PermissionError extends Error {
  constructor(permission: Permission) {
    super(`You don't have permission to do this (${permission}).`);
  }
}

/** Use in server actions before any write. Throws if the user lacks the permission. */
export async function requirePermission(permission: Permission): Promise<TeamUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (user.mustChangePassword) throw new Error(CHANGE_PASSWORD_FIRST);
  if (!user.can(permission)) throw new PermissionError(permission);
  return inTeam(user);
}

/** For lead-only actions in the current team (managing members and permissions). */
export async function requireLead(): Promise<TeamUser> {
  return inTeam(await requireLeadAnywhere());
}

/** Lead powers, team or not: a team's lead, or root and developers (root also on Brighton Serving). */
export async function requireLeadAnywhere(): Promise<CurrentUser> {
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
export async function requirePermissionsManager(): Promise<TeamUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (user.mustChangePassword) throw new Error(CHANGE_PASSWORD_FIRST);
  if (!user.isLead && !user.observerManagesPermissions) throw new Error("Only the team's lead can do this.");
  return inTeam(user);
}

/** Root, developers (not as someone else) and a permission-managing observer: above a team's lead, so can change the lead's access. */
export function overseesLeads(user: CurrentUser): boolean {
  return user.observerManagesPermissions || user.isRoot || hasDeveloperAccess(user);
}

/** For the root account (and developers): creating teams and setting their maximum permissions. */
export async function requireRoot(): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (user.mustChangePassword) throw new Error(CHANGE_PASSWORD_FIRST);
  if (!user.isRoot && !hasDeveloperAccess(user)) throw new Error("Only the root account can do this.");
  return user;
}
