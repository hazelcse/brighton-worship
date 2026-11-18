import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTeams, type Team } from "@/lib/teams";
import { followCustomSession } from "@/lib/roster-revision";

/**
 * Ad hoc services shared between teams (roster_sessions.link_id).
 *
 * A service is one event several teams serve at. Standard services (EM/CM Sunday, EM/CM PnP, YF
 * Saturday) are the same service on every team of a group just by their kind and date. Ad hoc ones
 * (kind "custom") are linked by a team's lead: each team's session for the event gets the same
 * link_id. Rules:
 *   - only teams of the same group (Main with Main, Youth with Youth), on the same date;
 *   - at most one session per team in a link;
 *   - linked sessions share one name: that of the session made first. Renaming one renames the
 *     rest; if the first is deleted the name simply stays with the others.
 *   - a link with one session left means "not linked" (it's cleared when we notice).
 *
 * Links are kept on the published (or draft) roster's sessions, never on a revision's copies: a
 * copy is resolved to the session it was copied from.
 */

type Db = ReturnType<typeof createAdminClient>;

export type LinkedSession = {
  id: string;
  date: string;
  name: string;
  kind: string;
  cancelled: boolean;
  linkId: string | null;
  createdAt: string;
  rosterId: string;
  rosterStatus: string;
  team: Team;
};

const COLUMNS = "id, date, name, kind, cancelled, link_id, created_at, source_session_id, roster_id, rosters!inner(team_id, status)";

type Row = {
  id: string;
  date: string;
  name: string;
  kind: string | null;
  cancelled: boolean;
  link_id: string | null;
  created_at: string;
  source_session_id: string | null;
  roster_id: string;
  rosters: { team_id: string; status: string };
};

function toSession(r: Row, teams: Map<string, Team>): LinkedSession | null {
  const team = teams.get(r.rosters.team_id);
  if (!team) return null;
  return {
    id: r.id,
    date: r.date,
    name: r.name,
    kind: r.kind ?? "custom",
    cancelled: r.cancelled,
    linkId: r.link_id,
    createdAt: r.created_at,
    rosterId: r.roster_id,
    rosterStatus: r.rosters.status,
    team,
  };
}

const teamMap = async () => new Map((await loadTeams()).map((t) => [t.id, t]));

/**
 * The session a link is kept on: the session itself, or, for a revision's copy, the published
 * session it was copied from. Null if there's none (a session added in a revision: it can be
 * linked once the roster is republished).
 */
export async function linkableSession(db: Db, sessionId: string): Promise<LinkedSession | null> {
  const teams = await teamMap();
  const { data } = await db.from("roster_sessions").select(COLUMNS).eq("id", sessionId).maybeSingle();
  const row = data as unknown as Row | null;
  if (!row) return null;
  if (row.rosters.status === "revision") {
    if (!row.source_session_id) return null;
    const { data: src } = await db.from("roster_sessions").select(COLUMNS).eq("id", row.source_session_id).maybeSingle();
    return src ? toSession(src as unknown as Row, teams) : null;
  }
  return toSession(row, teams);
}

/** Every session in a link (published and draft rosters only), oldest first. */
export async function linkMembers(db: Db, linkId: string): Promise<LinkedSession[]> {
  const teams = await teamMap();
  const { data } = await db
    .from("roster_sessions")
    .select(COLUMNS)
    .eq("link_id", linkId)
    .in("rosters.status", ["published", "draft"])
    .order("created_at");
  return ((data ?? []) as unknown as Row[]).flatMap((r) => toSession(r, teams) ?? []);
}

/** A link with fewer than two sessions left isn't a link: clear it. */
export async function tidyLink(db: Db, linkId: string | null | undefined) {
  if (!linkId) return;
  const members = await linkMembers(db, linkId);
  if (members.length < 2) await db.from("roster_sessions").update({ link_id: null }).eq("link_id", linkId);
}

/** Take a session out of its link (and clear the link if it's left with one session). */
export async function unlinkSession(db: Db, session: Pick<LinkedSession, "id" | "linkId">) {
  if (!session.linkId) return;
  const { error } = await db.from("roster_sessions").update({ link_id: null }).eq("id", session.id);
  if (error) throw error;
  await tidyLink(db, session.linkId);
}

/**
 * Give a session a new name, and the open revision's copy of it too (so republishing doesn't put
 * the old name back). The roster's "serve at" rules for it follow.
 */
async function rename(db: Db, s: LinkedSession, name: string) {
  if (s.name === name) return;
  const { error } = await db.from("roster_sessions").update({ name }).eq("id", s.id);
  if (error) throw error;
  await db.from("roster_sessions").update({ name }).eq("source_session_id", s.id);
  await followCustomSession(db, s.rosterId, { date: s.date, name: s.name }, { date: s.date, name });
}

/** Every other session linked to this one takes its (new) name. */
export async function renameLinked(db: Db, sessionId: string, name: string) {
  const s = await linkableSession(db, sessionId);
  if (!s?.linkId) return;
  for (const m of await linkMembers(db, s.linkId)) if (m.id !== s.id) await rename(db, m, name);
}

/** Who changed a link, and the session of theirs it's about (for the other teams' leads' inbox). */
export type LinkActor = { actorId: string; teamId: string; name: string };

/**
 * Tell the leads of the teams whose sessions are in `others` (their inbox) that `by`'s session was
 * linked to theirs ("service_linked") or taken out of the link ("service_unlinked"). `why`: how it
 * left ("deleted", "moved"), or null when it was unlinked by hand. The update is about the other
 * team's session; its team_id says whose lead hears.
 */
export async function notifyLinkChange(
  db: Db,
  by: LinkActor,
  kind: "service_linked" | "service_unlinked",
  others: Pick<LinkedSession, "id" | "team">[],
  why: "deleted" | "moved" | null = null,
) {
  const team = (await loadTeams()).find((t) => t.id === by.teamId);
  const rows = others
    .filter((o) => o.team.id !== by.teamId)
    .map((o) => ({
      kind,
      session_id: o.id,
      team_id: o.team.id,
      actor_id: by.actorId,
      detail: `${team?.name ?? "Another team"}'s ${by.name}`,
      reason: why,
    }));
  if (rows.length) await db.from("roster_updates").insert(rows);
}

/**
 * A linked session changed date or was deleted: it leaves the link (deleted ones are already
 * gone, so only the link needs tidying). With `by`, the other teams' leads are told.
 */
export async function afterLinkedSessionMoved(db: Db, sessionId: string, linkId: string | null, deleted = false, by?: LinkActor) {
  if (!linkId) return;
  const others = by ? (await linkMembers(db, linkId)).filter((m) => m.id !== sessionId) : [];
  if (!deleted) await db.from("roster_sessions").update({ link_id: null }).eq("id", sessionId);
  await tidyLink(db, linkId);
  if (by) await notifyLinkChange(db, by, "service_unlinked", others, deleted ? "deleted" : "moved");
}

/** Another team's ad hoc service that a session could be linked to. */
export type LinkCandidate = {
  /** The other team's session. */
  id: string;
  name: string;
  team: string;
  /** "published" or "draft". */
  rosterStatus: string;
  /** Every team in the link it's already in (its own team first). */
  teams: string[];
  /** Why it can't be picked (e.g. your team already has a session in that link), or null. */
  blocked: string | null;
};

/**
 * Other teams' ad hoc services in the same group on `date` (on published or draft rosters), for
 * linking `self` (a session of `team`, or null while it's being made) to one of them.
 */
export async function linkCandidates(db: Db, team: Team, date: string, self: LinkedSession | null): Promise<LinkCandidate[]> {
  const teams = await loadTeams();
  const others = teams.filter((t) => t.group === team.group && t.id !== team.id);
  if (!others.length) return [];
  const byId = new Map(teams.map((t) => [t.id, t]));
  const { data } = await db
    .from("roster_sessions")
    .select(COLUMNS)
    .in("rosters.team_id", others.map((t) => t.id))
    .in("rosters.status", ["published", "draft"])
    .eq("date", date)
    .eq("kind", "custom")
    .eq("cancelled", false)
    .order("created_at");
  const rows = ((data ?? []) as unknown as Row[]).flatMap((r) => toSession(r, byId) ?? []);
  // Who's already in each link the candidates are in.
  const linkIds = [...new Set(rows.flatMap((r) => (r.linkId ? [r.linkId] : [])))];
  const { data: linked } = linkIds.length
    ? await db.from("roster_sessions").select(COLUMNS).in("link_id", linkIds).in("rosters.status", ["published", "draft"])
    : { data: [] };
  const members = new Map<string, LinkedSession[]>();
  for (const r of ((linked ?? []) as unknown as Row[]).flatMap((x) => toSession(x, byId) ?? [])) {
    members.set(r.linkId!, [...(members.get(r.linkId!) ?? []), r]);
  }
  return rows.map((r) => {
    const inLink = r.linkId ? (members.get(r.linkId) ?? []) : [];
    const mine = inLink.find((m) => m.team.id === team.id && m.id !== self?.id);
    const linkTeams = [r.team.name, ...inLink.filter((m) => m.id !== r.id && m.id !== self?.id).map((m) => m.team.name)];
    return {
      id: r.id,
      name: r.name,
      team: r.team.name,
      rosterStatus: r.rosterStatus,
      teams: [...new Set(linkTeams)],
      blocked: mine ? `already linked to ${team.name}'s ${mine.name}` : null,
    };
  });
}

/**
 * Link `self` to `targetId`'s service (leaving any link it was in). `self` takes the name of the
 * link's first session. Returns the name it ended up with.
 */
export async function linkTo(db: Db, self: LinkedSession, targetId: string): Promise<string> {
  const target = await linkableSession(db, targetId);
  if (!target || target.rosterStatus === "revision") throw new Error("That service isn't on a roster any more.");
  if (target.kind !== "custom" || self.kind !== "custom") throw new Error("Only ad hoc services are linked by hand.");
  if (target.team.id === self.team.id) throw new Error("Pick another team's service.");
  if (target.team.group !== self.team.group) throw new Error(`Only ${self.team.group === "main" ? "Main" : "Youth"} teams' services can be linked.`);
  if (target.date !== self.date) throw new Error("Linked services have to be on the same day.");
  if (target.cancelled) throw new Error("That service has been called off.");
  if (target.linkId && target.linkId === self.linkId) return self.name; // already linked

  const members = target.linkId ? await linkMembers(db, target.linkId) : [target];
  const mine = members.find((m) => m.team.id === self.team.id && m.id !== self.id);
  if (mine) throw new Error(`${target.name} is already linked to ${self.team.name}'s ${mine.name}.`);

  await unlinkSession(db, self);
  const linkId = target.linkId ?? crypto.randomUUID();
  if (!target.linkId) {
    const { error } = await db.from("roster_sessions").update({ link_id: linkId }).eq("id", target.id);
    if (error) throw error;
  }
  const { error } = await db.from("roster_sessions").update({ link_id: linkId }).eq("id", self.id);
  if (error) throw error;
  // The service keeps the name of whichever team made it first.
  const first = [...members, self].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  await rename(db, self, first.name);
  if (first.id === self.id) for (const m of members) await rename(db, m, self.name);
  return first.name;
}

/**
 * For a roster's sessions (a revision's copies too): the other teams each linked ad hoc session is
 * linked with, by session id. Sessions that aren't linked are left out.
 */
export async function linkedTeamsFor(sessionIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!sessionIds.length) return out;
  const db = createAdminClient();
  const { data: rows } = await db.from("roster_sessions").select("id, link_id, source_session_id").in("id", sessionIds).eq("kind", "custom");
  const sourceOf = new Map((rows ?? []).filter((r) => r.source_session_id).map((r) => [r.id as string, r.source_session_id as string]));
  const { data: sources } = sourceOf.size
    ? await db.from("roster_sessions").select("id, link_id").in("id", [...sourceOf.values()])
    : { data: [] as { id: string; link_id: string | null }[] };
  const linkOfSource = new Map((sources ?? []).map((s) => [s.id as string, s.link_id as string | null]));
  // Each session's link, and the session the link is kept on (itself, or what it was copied from).
  const keyed = (rows ?? []).flatMap((r) => {
    const src = sourceOf.get(r.id as string);
    const linkId = src ? linkOfSource.get(src) : (r.link_id as string | null);
    return linkId ? [{ id: r.id as string, self: src ?? (r.id as string), linkId }] : [];
  });
  if (!keyed.length) return out;
  const teams = await teamMap();
  const { data: members } = await db
    .from("roster_sessions")
    .select(COLUMNS)
    .in("link_id", [...new Set(keyed.map((k) => k.linkId))])
    .in("rosters.status", ["published", "draft"]);
  const all = ((members ?? []) as unknown as Row[]).flatMap((r) => toSession(r, teams) ?? []);
  for (const k of keyed) {
    const others = all.filter((m) => m.linkId === k.linkId && m.id !== k.self).map((m) => m.team.name);
    if (others.length) out.set(k.id, [...new Set(others)]);
  }
  return out;
}
