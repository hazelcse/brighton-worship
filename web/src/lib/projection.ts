import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayYmd } from "@/lib/roster";
import { ROLE_LABEL, type TeamGroup } from "@/lib/team-config";
import { keyLabel } from "@/lib/session-plan";
import { loadTeams, type Team } from "@/lib/teams";

/**
 * A media team's Projection page: the worship team's published session plans for the services the
 * media team serves at, so the projectionists can get the songs ready.
 *
 * A worship session is crewed by a media session when the services are the same: a standard one by
 * kind and date (same group), an ad hoc one by link (lib/service-links.ts). Members see the plans
 * of the services they're rostered on; the lead sees every upcoming published plan of the group's
 * worship teams (marked when their team isn't crewing it).
 */

export type ProjectionPlan = {
  /** The worship session plan's id (opens it under /projection). */
  id: string;
  date: string;
  name: string;
  /** The worship team whose plan it is. */
  team: string;
  songs: { title: string; key: string | null }[];
  /** The viewer's crew role at this service, if they're on it. */
  role: string | null;
  /** The viewer's media team serves at this service (standard, or linked ad hoc). */
  crewed: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  /** Published since the viewer last opened Projection (not by them). */
  fresh: boolean;
  /** Published again with changes (not its first publishing). */
  updated: boolean;
};

type Viewer = { id: string; isLead: boolean };

/** Upcoming published plans for a media team's Projection page, soonest first. */
export function loadProjection(viewer: Viewer, team: Pick<Team, "id" | "group" | "kind">): Promise<ProjectionPlan[]> {
  if (team.kind !== "media") return Promise.resolve([]);
  return projectionFor(viewer.id, viewer.isLead, team.id, team.group);
}

/** Run once per request (the nav, the home page and Projection all need it); keyed by plain values. */
const projectionFor = cache(async (viewerId: string, isLead: boolean, teamId: string, group: TeamGroup): Promise<ProjectionPlan[]> => {
  const viewer = { id: viewerId, isLead };
  const team = { id: teamId, group };
  const db = createAdminClient();
  const today = todayYmd();
  const worshipTeams = (await loadTeams()).filter((t) => t.group === team.group && t.kind === "worship");
  if (!worshipTeams.length) return [];
  const teamName = new Map(worshipTeams.map((t) => [t.id, t.name]));

  const [{ data: plans }, { data: crewRows }, { data: me }] = await Promise.all([
    db
      .from("worship_sessions")
      .select(
        "id, published_at, published_by, roster_sessions!inner(id, date, name, kind, link_id, cancelled, rosters!inner(team_id, status)), worship_session_sections(position, worship_session_items(position, kind, title, key, transpose_to))",
      )
      .eq("status", "published")
      .in("roster_sessions.rosters.team_id", worshipTeams.map((t) => t.id))
      .eq("roster_sessions.rosters.status", "published")
      .eq("roster_sessions.cancelled", false)
      .gte("roster_sessions.date", today),
    db
      .from("roster_sessions")
      .select("id, date, kind, link_id, rosters!inner(team_id, status)")
      .eq("rosters.team_id", team.id)
      .eq("rosters.status", "published")
      .eq("cancelled", false)
      .gte("date", today),
    db.from("profiles").select("sessions_seen_at").eq("id", viewer.id).maybeSingle(),
  ]);

  const crew = (crewRows ?? []).map((r) => ({ id: r.id as string, date: r.date as string, kind: (r.kind as string | null) ?? "custom", linkId: (r.link_id as string | null) ?? null }));
  const { data: mine } = crew.length
    ? await db.from("roster_assignments").select("session_id, role").eq("member_id", viewer.id).in("session_id", crew.map((c) => c.id))
    : { data: [] as { session_id: string; role: string }[] };
  const myRole = new Map((mine ?? []).map((m) => [m.session_id as string, m.role as string]));

  type Rs = { id: string; date: string; name: string; kind: string | null; link_id: string | null; rosters: { team_id: string } };
  type Sec = { position: number; worship_session_items: { position: number; kind: string; title: string; key: string | null; transpose_to: string | null }[] };
  const rows = (plans ?? []).map((p) => ({ plan: p, rs: p.roster_sessions as unknown as Rs }));

  // Which of them were republished with changes, and who published them.
  const ids = rows.map((r) => r.plan.id as string);
  const [{ data: revised }, { data: people }] = await Promise.all([
    ids.length ? db.from("worship_session_revisions").select("session_id").in("session_id", ids) : Promise.resolve({ data: [] as { session_id: string }[] }),
    (() => {
      const by = [...new Set(rows.flatMap((r) => (r.plan.published_by ? [r.plan.published_by as string] : [])))];
      return by.length ? db.from("profiles").select("id, full_name").in("id", by) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] });
    })(),
  ]);
  const wasRevised = new Set((revised ?? []).map((r) => r.session_id as string));
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string | null) || "Someone"]));
  const seenAt = (me?.sessions_seen_at as string | null | undefined) ?? null;

  return rows
    .flatMap(({ plan, rs }): ProjectionPlan[] => {
      const kind = rs.kind ?? "custom";
      // The media team's sessions at this service: same kind that day, or linked to it.
      const crewing = crew.filter((c) => (kind === "custom" ? Boolean(rs.link_id) && c.linkId === rs.link_id : c.kind === kind && c.date === rs.date));
      const roleHere = crewing.map((c) => myRole.get(c.id)).find(Boolean) ?? null;
      if (!viewer.isLead && !roleHere) return [];
      const publishedAt = (plan.published_at as string | null) ?? null;
      const songs = ((plan.worship_session_sections ?? []) as Sec[])
        .sort((a, b) => a.position - b.position)
        .flatMap((sec) => [...sec.worship_session_items].sort((a, b) => a.position - b.position))
        .filter((i) => i.kind === "song" && i.title)
        .map((i) => ({ title: i.title, key: keyLabel(i.key, i.transpose_to) }));
      return [
        {
          id: plan.id as string,
          date: rs.date,
          name: rs.name,
          team: teamName.get(rs.rosters.team_id) ?? "Worship",
          songs,
          role: roleHere ? (ROLE_LABEL[roleHere] ?? roleHere) : null,
          crewed: crewing.length > 0,
          publishedAt,
          publishedBy: plan.published_by ? (nameOf.get(plan.published_by as string) ?? null) : null,
          fresh: Boolean(publishedAt) && plan.published_by !== viewer.id && (!seenAt || publishedAt! > seenAt),
          updated: wasRevised.has(plan.id as string),
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
});

/**
 * Plans published (or republished with changes) for services the media team serves at, since the
 * viewer last opened Projection: members' own services; the lead's team's. For the nav badge and
 * the home page's notices. Only services the media team is linked to count.
 */
export async function loadNewlyPublishedForCrew(viewer: Viewer, team: Pick<Team, "id" | "group" | "kind">): Promise<ProjectionPlan[]> {
  return (await loadProjection(viewer, team)).filter((p) => p.fresh && p.crewed);
}

/** A plan on the viewer's Projection page (their access check for opening it). */
export async function projectionPlanVisible(viewer: Viewer, team: Pick<Team, "id" | "group" | "kind">, planId: string): Promise<boolean> {
  return (await loadProjection(viewer, team)).some((p) => p.id === planId);
}

/**
 * The media teams' sessions crewing a worship session (same group; standard: same kind that day,
 * ad hoc: linked), on published rosters and not called off. For telling those crews about changes.
 */
export async function crewSessionsFor(rosterSessionId: string): Promise<string[]> {
  const db = createAdminClient();
  const { data: w } = await db
    .from("roster_sessions")
    .select("date, kind, link_id, rosters!inner(team_id)")
    .eq("id", rosterSessionId)
    .maybeSingle();
  if (!w) return [];
  const teams = await loadTeams();
  const own = teams.find((t) => t.id === (w.rosters as unknown as { team_id: string }).team_id);
  if (!own || own.kind !== "worship") return [];
  const media = teams.filter((t) => t.group === own.group && t.kind === "media").map((t) => t.id);
  const kind = (w.kind as string | null) ?? "custom";
  if (!media.length || (kind === "custom" && !w.link_id)) return [];
  let q = db
    .from("roster_sessions")
    .select("id, rosters!inner(team_id, status)")
    .in("rosters.team_id", media)
    .eq("rosters.status", "published")
    .eq("cancelled", false);
  q = kind === "custom" ? q.eq("link_id", w.link_id as string) : q.eq("date", w.date as string).eq("kind", kind);
  const { data } = await q;
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Someone on a media team may read a published plan on their Projection page (and its songsheets),
 * though it's another team's session: added on top of sessionAccess's answer.
 */
export async function withProjectionAccess<A extends { canEdit: boolean; canView: boolean }>(
  user: { id: string; isLead: boolean; team: Pick<Team, "id" | "group" | "kind"> | null },
  planId: string,
  plan: { status: string },
  access: A,
): Promise<A> {
  if (access.canView || !user.team || user.team.kind !== "media" || plan.status !== "published") return access;
  return (await projectionPlanVisible({ id: user.id, isLead: user.isLead }, user.team, planId)) ? { ...access, canView: true } : access;
}
