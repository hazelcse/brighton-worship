import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { ATTACHED_ROLES, ROLE_LABEL, SINGING_ROLES, todayYmd } from "@/lib/roster";

/**
 * Confirming who serves. Publishing a roster asks everyone on it, once per session, whether they
 * can serve (serve_requests). Someone who can't asks another person directly or puts the session
 * on the requests board (cover_requests). Whoever covers either takes over (replaces them) or
 * swaps: the requester takes one of the coverer's sessions in return, once both agree on which
 * (swap_proposals).
 */

export type ServeStatus = "pending" | "accepted" | "declined";

export type SessionInfo = {
  id: string;
  date: string;
  name: string;
  /** The band's rehearsal for it, which everyone serving has to make too. */
  rehearsal?: string | null;
};

export type Candidate = { id: string; name: string };

/** Someone who plays the part, as offered when asking for cover. */
export type CoverCandidate = Candidate & {
  /**
   * Of the band leader / talkback that come with the place (nobody else in the band can take them
   * over), the ones they can do: they'd take those over too.
   */
  bandRoles: string[];
  /** Can't be asked: away that day or at its rehearsal, already serving, or can't do any of the band roles that come with it. */
  unavailable?: "absent" | "serving" | "band";
  /** The band roles that come with the place (so "can't do TB" can be said). */
  withPlace?: string[];
  /**
   * Their load in this roster's quarter: the weights of the sessions they're on added up (a Sunday
   * is 1, a Prayer & Praise 0.6; cancelled ones don't count), as the generator counts it. Unknown: left out.
   */
  load?: number;
  /** The one to ask: free, with the lightest load (ties: whoever's next session is furthest away). */
  recommended?: boolean;
  /**
   * They don't normally serve at this session: outside its ministry (EM / CM) or its type (Sunday /
   * Prayer & Praise), as the lead's picker and the generator see it. Listed after those who do.
   */
  unusual?: boolean;
};

/** One of the coverer's sessions the requester would take in a swap. */
export type SwapOption = SessionInfo & { role: string };

export type Proposal = {
  id: string;
  counterpart: Candidate;
  offer: SwapOption;
  /** Proposed by the viewer: waiting for the other person. */
  byMe: boolean;
};

export type PendingRequest = {
  id: string;
  role: string;
  session: SessionInfo;
  candidates: CoverCandidate[];
  /** Band leader / talkback they're also doing there, with who in the band could take each over. */
  bandRoles: BandRoleChoice[];
};

/** A band leader / talkback role someone is stepping out of, and who in that band could take it. */
export type BandRoleChoice = { role: string; candidates: Candidate[] };

/** Someone asking a bandmate to take over their band leader / talkback at a session. */
export type HandoverItem = {
  id: string;
  role: string;
  session: SessionInfo;
  from: Candidate;
  target: Candidate;
  status: "open" | "refused";
  /** The asker's own: who else they could ask (after a "can't"). */
  candidates?: Candidate[];
};

export type CoverItem = {
  id: string;
  role: string;
  session: SessionInfo;
  status: "open" | "refused";
  /** Who can't serve. */
  from: Candidate;
  /** Asked directly; null when it's on the board. */
  target: Candidate | null;
  /** Board items: whether the viewer can cover it (plays the part, free that day, not already serving). */
  canTake?: boolean;
  whyNot?: string;
  /** The requester's own items: people they could ask instead (including greyed-out ones who can't be asked). */
  candidates?: CoverCandidate[];
  /** Swap proposals still waiting: for the requester, every one; for others, the ones with them. */
  proposals: Proposal[];
  /** The requester's own: their absence that clashes with this session, if any (it can't be left uncovered). */
  away?: AwayAbsence | null;
  /** The requester's own: band leader / talkback they still hold there, and who could take each. */
  bandRoles?: BandRoleChoice[];
};

/** An absence of the viewer's, as shown when it clashes with a session they're on. */
export type AwayAbsence = { id: string; startsOn: string; endsOn: string; reason: string };

/** A session the viewer is still rostered on while away, with nobody being asked to cover it. */
export type AwayClash = {
  session: SessionInfo;
  role: string;
  absence: AwayAbsence;
  /** Who could cover it, and who could take over their band leader / talkback. */
  candidates: CoverCandidate[];
  bandRoles: BandRoleChoice[];
};

export type RequestsBoard = {
  pending: PendingRequest[];
  /** People asking the viewer directly. */
  incoming: CoverItem[];
  /** The viewer's own requests that haven't been covered yet. */
  mine: CoverItem[];
  /** Bandmates asking the viewer to take over their band leader / talkback. */
  handoversIn: HandoverItem[];
  /** The viewer's own band leader / talkback handovers still waiting, or turned down. */
  handoversMine: HandoverItem[];
  /** Sessions they're away for but still rostered on, with no request open: they need sorting. */
  awayUncovered: AwayClash[];
};

export type UpdateKind =
  | "declined"
  | "asked"
  | "posted"
  | "taken"
  | "refused"
  | "cancelled"
  | "swap_proposed"
  | "swap_declined"
  | "swapped"
  | "band_role_asked"
  | "band_role_taken"
  | "band_role_refused"
  | "band_role_missing"
  | "session_updated"
  // Root republished an edited roster: told only to the person it's about.
  | "roster_added"
  | "roster_removed"
  | "roster_part_changed"
  | "roster_session_changed"
  // ...and to each bandmate of a session whose line-up changed (detail: who moved).
  | "roster_band_changed"
  // A team lead added someone to their team, or removed them: told to root only (detail: their name).
  | "member_added"
  | "member_removed"
  // Another team's lead linked their ad hoc service to one of this team's sessions, or unlinked it
  // (by hand, or by moving or deleting theirs): told to this team's lead (detail: "Main Media's
  // Baptism"; reason: "deleted" / "moved" / null).
  | "service_linked"
  | "service_unlinked";

/** The kinds a republished roster sends, one per person affected. */
export const ROSTER_CHANGE_KINDS: UpdateKind[] = ["roster_added", "roster_removed", "roster_part_changed", "roster_session_changed", "roster_band_changed"];

/** Another team's lead linking to or unlinking from one of this team's sessions: its lead hears. */
export const LINK_KINDS: UpdateKind[] = ["service_linked", "service_unlinked"];

/** A lead adding or removing someone: about a team, not a session, and only root hears. */
export const MEMBER_KINDS: UpdateKind[] = ["member_added", "member_removed"];

export type UpdateItem = {
  id: string;
  kind: UpdateKind;
  role: string | null;
  session: SessionInfo | null;
  otherSession: SessionInfo | null;
  /** For swaps: the part played at otherSession (the session offered in return). */
  otherRole: string | null;
  /**
   * For swaps the viewer is in: which side was theirs to give up ("session" = the request's own,
   * "other" = the one offered in return). null when they're not one of the two.
   */
  mySide: "session" | "other" | null;
  actor: string;
  member: string | null;
  reason: string | null;
  /** For roster changes: what changed, in words (the part before → after, a session's new time…). */
  detail: string | null;
  /** About a media team's roster: its people are a crew, not a band. */
  crew?: boolean;
  createdAt: string;
  /** Not seen before (and not the viewer's own doing). */
  isNew: boolean;
  /** The viewer made this change themselves. */
  byMe: boolean;
  /** About a session the viewer is rostered on (either side of a swap), or about the viewer. */
  concernsMe: boolean;
  /** When what it was about got sorted (the place covered, the role taken over), if it has. */
  resolvedAt: string | null;
  /** Where clicking it goes (a session's plan was updated: its page). */
  href: string | null;
  /** For a member added or removed: the team's name. */
  team: string | null;
};

/** A session the viewer is rostered on, for the calendar. */
export type MySession = SessionInfo & {
  kind: string;
  role: string;
  /** For a rehearsal: the service or event it's for. */
  forSession?: { date: string; name: string; kind: string };
};

type Db = ReturnType<typeof createAdminClient>;

/** Ask everyone on a just-published roster to confirm each session they're on. */
export async function createServeRequests(rosterId: string) {
  const db = createAdminClient();
  const { data: sessions, error: sErr } = await db
    .from("roster_sessions")
    .select("id")
    .eq("roster_id", rosterId)
    .eq("cancelled", false)
    .gte("date", todayYmd()); // sessions already past need no answer
  if (sErr) throw sErr;
  const ids = (sessions ?? []).map((s) => s.id);
  if (!ids.length) return;
  const { data: assignments, error: aErr } = await db
    .from("roster_assignments")
    .select("session_id, member_id, role")
    .in("session_id", ids);
  if (aErr) throw aErr;
  const rows = (assignments ?? []).map((a) => ({ roster_id: rosterId, session_id: a.session_id, member_id: a.member_id, role: a.role }));
  if (!rows.length) return;
  const { error } = await db.from("serve_requests").upsert(rows, { onConflict: "session_id,member_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** Sessions of every published roster, keyed by id. Only these count for requests and updates. */
type PublishedSession = SessionInfo & { kind: string; rehearsal: string | null; teamId: string };

async function publishedSessions(db: Db = createAdminClient(), teamId?: string): Promise<Map<string, PublishedSession>> {
  // Every team's by default (someone's own sessions, on any team they're on); one team's with teamId.
  let q = db.from("rosters").select("id, team_id").eq("status", "published");
  if (teamId) q = q.eq("team_id", teamId);
  const { data: rosters } = await q;
  const rosterIds = (rosters ?? []).map((r) => r.id);
  const teamOf = new Map((rosters ?? []).map((r) => [r.id as string, r.team_id as string]));
  if (!rosterIds.length) return new Map();
  const { data } = await db
    .from("roster_sessions")
    .select("id, date, name, kind, rehearsal_date, roster_id")
    .in("roster_id", rosterIds)
    .eq("cancelled", false);
  return new Map(
    (data ?? []).map((s) => [s.id, { id: s.id, date: s.date, name: s.name, kind: s.kind, rehearsal: (s.rehearsal_date as string | null) ?? null, teamId: teamOf.get(s.roster_id as string)! }]),
  );
}

/** An active person, with what they play on each team they're on (their profile there), by team id. */
type Person = { id: string; name: string; plays: Map<string, string[]> };

async function activePeople(db: Db = createAdminClient()): Promise<Map<string, Person>> {
  const { data } = await db
    .from("profiles")
    .select("id, full_name, email, team_members(team_id, instruments)")
    .eq("is_active", true)
    .eq("is_developer", false);
  return new Map(
    (data ?? []).map((p) => {
      const teams = (p.team_members ?? []) as { team_id: string; instruments: string[] | null }[];
      return [p.id, { id: p.id, name: p.full_name || p.email, plays: new Map(teams.map((t) => [t.team_id, t.instruments ?? []])) }];
    }),
  );
}

/** What someone plays on this team: [] when they aren't on it (a person on two teams can play different parts on each). */
const playsOn = (p: Person | undefined, teamId: string | undefined): string[] => (p && teamId ? (p.plays.get(teamId) ?? []) : []);

/** The team whose roster a session is on. */
async function sessionTeam(db: Db, sessionId: string): Promise<string | undefined> {
  const { data } = await db.from("roster_sessions").select("rosters!inner(team_id)").eq("id", sessionId).maybeSingle();
  return (data?.rosters as unknown as { team_id: string } | null)?.team_id;
}

const info = (s: SessionInfo & { kind?: string }): SessionInfo => ({ id: s.id, date: s.date, name: s.name, rehearsal: s.rehearsal ?? null });

/**
 * Everyone else who plays this part, for covering the requester's place on this session: free ones
 * first, then the ones who can't be asked (greyed out), each saying why. Someone can't be asked if
 * they're on that session or another that day, away that day or at its rehearsal, or can't do any of the band
 * leader / talkback that comes with the place (nobody else in the band can take it over).
 */
export async function coverOptions(
  sessionId: string,
  role: string,
  requesterId: string,
  db: Db = createAdminClient(),
  /** Check against this rehearsal day instead of the stored one (a rehearsal about to move; null = none). */
  rehearsalOn?: string | null,
): Promise<CoverCandidate[]> {
  const [{ data: session }, people, { data: serving }, withPlace] = await Promise.all([
    db.from("roster_sessions").select("date, kind, ministry, rehearsal_date, roster_id, rosters!inner(team_id)").eq("id", sessionId).maybeSingle(),
    activePeople(db),
    db.from("roster_assignments").select("member_id").eq("session_id", sessionId),
    bandRolesWithPlace(sessionId, requesterId, db),
  ]);
  if (!session) return [];
  // Only people on this session's team, by what they play there.
  const teamId = (session.rosters as unknown as { team_id: string }).team_id;
  const rehearsal = rehearsalOn === undefined ? session.rehearsal_date : rehearsalOn;
  const days = [session.date, ...(rehearsal ? [rehearsal] : [])];
  const [{ data: away }, { data: quarter }, { data: profiles }] = await Promise.all([
    db
      .from("absences")
      .select("member_id")
      .or(days.map((d) => `and(starts_on.lte.${d},ends_on.gte.${d})`).join(",")),
    db.from("roster_sessions").select("id, date, weight").eq("roster_id", session.roster_id).eq("cancelled", false),
    db.from("team_members").select("user_id, em_percent, serves").eq("team_id", teamId),
  ]);
  // Whether they normally serve at this session: its ministry and type (the same test as the lead's picker).
  const profileOf = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const pnp = String(session.kind ?? "").endsWith("_pnp");
  const normallyServes = (id: string) => {
    const p = profileOf.get(id);
    const em = p?.em_percent ?? null;
    const ministryOk = session.ministry === "em" ? em === null || em > 0 : session.ministry === "cm" ? em === null || em < 100 : true;
    const serves = p?.serves ?? "both";
    const servesOk = serves === "both" || (serves === "pnp" ? pnp : !pnp);
    return ministryOk && servesOk;
  };
  const dateOf = new Map((quarter ?? []).map((s) => [s.id as string, s.date as string]));
  const weightOf = new Map((quarter ?? []).map((s) => [s.id as string, Number(s.weight ?? 1)]));
  const { data: places } = dateOf.size
    ? await db.from("roster_assignments").select("member_id, session_id").in("session_id", [...dateOf.keys()])
    : { data: [] };
  // Each person's load this quarter, and how close their nearest session is to this one (days).
  const load = new Map<string, number>();
  const nearest = new Map<string, number>();
  const at = Date.parse(session.date);
  for (const p of places ?? []) {
    const id = p.member_id as string;
    load.set(id, Math.round(((load.get(id) ?? 0) + weightOf.get(p.session_id as string)!) * 100) / 100);
    const gap = Math.abs(Date.parse(dateOf.get(p.session_id as string)!) - at) / 86_400_000;
    nearest.set(id, Math.min(nearest.get(id) ?? Infinity, gap));
  }
  // On this session, or another one that day (nobody serves two sessions on one date).
  const onIt = new Set([
    ...(serving ?? []).map((s) => s.member_id as string),
    ...(places ?? []).filter((p) => dateOf.get(p.session_id as string) === session.date).map((p) => p.member_id as string),
  ]);
  const absent = new Set((away ?? []).map((a) => a.member_id as string));
  const out = [...people.values()]
    .filter((p) => p.id !== requesterId && playsOn(p, teamId).includes(role))
    .map((p): CoverCandidate => {
      const bandRoles = withPlace.filter((r) => playsOn(p, teamId).includes(r));
      const unavailable = onIt.has(p.id) ? "serving" : absent.has(p.id) ? "absent" : withPlace.length && !bandRoles.length ? "band" : undefined;
      return {
        id: p.id,
        name: p.name,
        bandRoles,
        load: load.get(p.id) ?? 0,
        ...(unavailable ? { unavailable } : {}),
        ...(withPlace.length ? { withPlace } : {}),
        ...(normallyServes(p.id) ? {} : { unusual: true }),
      };
    })
    // Free and normally at this session, then free but not normally, then those who can't be asked.
    .sort(
      (a, b) =>
        Number(Boolean(a.unavailable)) - Number(Boolean(b.unavailable)) ||
        Number(Boolean(a.unusual)) - Number(Boolean(b.unusual)) ||
        a.name.localeCompare(b.name),
    );
  // Recommend someone who normally serves here; only if nobody does, someone who doesn't.
  const free = out.filter((c) => !c.unavailable);
  const best = (free.some((c) => !c.unusual) ? free.filter((c) => !c.unusual) : free)
    .sort((a, b) => a.load! - b.load! ||(nearest.get(b.id) ?? Infinity) - (nearest.get(a.id) ?? Infinity) || a.name.localeCompare(b.name))[0];
  if (best) best.recommended = true;
  return out;
}

/** Who could be asked to cover this part on this session (see coverOptions). */
export async function coverCandidates(sessionId: string, role: string, requesterId: string, db: Db = createAdminClient()): Promise<CoverCandidate[]> {
  return (await coverOptions(sessionId, role, requesterId, db)).filter((c) => !c.unavailable);
}

// ---------------------------------------------------------------------------
// Band leader and talkback when someone steps out
// ---------------------------------------------------------------------------

export const BAND_ROLES: readonly string[] = ATTACHED_ROLES;
export const bandRoleLabel = (role: string) => ROLE_LABEL[role] ?? role;

/** Is this person in this team's admin permission group? (Root is checked separately.) */
export async function isAdmin(userId: string, teamId: string, db: Db = createAdminClient()): Promise<boolean> {
  const { data } = await db
    .from("user_groups")
    .select("groups!inner(name, team_id)")
    .eq("user_id", userId)
    .eq("groups.name", "admin")
    .eq("groups.team_id", teamId)
    .limit(1);
  return Boolean(data?.length);
}

/**
 * Who in this session's band could take over a band leader / talkback role: playing an instrument
 * there (not singing), able to do the role, not doing it already, and not stepping out themselves.
 */
export async function bandRoleCandidates(sessionId: string, role: string, exclude: string[], db: Db = createAdminClient()): Promise<Candidate[]> {
  const [{ data: band }, people, { data: leaving }, teamId] = await Promise.all([
    db.from("roster_assignments").select("member_id, role, also_roles").eq("session_id", sessionId),
    activePeople(db),
    db.from("cover_requests").select("member_id").eq("session_id", sessionId).in("status", ["open", "refused"]),
    sessionTeam(db, sessionId),
  ]);
  const out = new Set(exclude);
  for (const l of leaving ?? []) out.add(l.member_id as string);
  const seen = new Set<string>();
  return (band ?? [])
    .filter((b) => {
      const id = b.member_id as string;
      if (out.has(id) || seen.has(id) || SINGING_ROLES.includes(b.role as string)) return false;
      if (((b.also_roles as string[] | null) ?? []).includes(role)) return false;
      if (!playsOn(people.get(id), teamId).includes(role)) return false;
      seen.add(id);
      return true;
    })
    .map((b) => ({ id: b.member_id as string, name: people.get(b.member_id)?.name ?? "Someone" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The band leader / talkback that go with this person's place if someone covers it: ones they still
 * hold there, not being handed over, that nobody else in the band can take (or everyone who could
 * has said they can't). Whoever covers the place takes over the ones they can do.
 */
export async function bandRolesWithPlace(sessionId: string, memberId: string, db: Db = createAdminClient()): Promise<string[]> {
  const [{ data: mine }, { data: handovers }] = await Promise.all([
    db.from("roster_assignments").select("also_roles").eq("session_id", sessionId).eq("member_id", memberId).maybeSingle(),
    db.from("handover_requests").select("role, member_id, target_id, status").eq("session_id", sessionId).in("status", ["open", "refused"]),
  ]);
  const already = new Set((handovers ?? []).filter((h) => h.status === "open").map((h) => h.role as string));
  const refusers = (role: string) =>
    (handovers ?? []).filter((h) => h.status === "refused" && h.role === role && h.member_id === memberId).map((h) => h.target_id as string);
  const held = ((mine?.also_roles as string[] | null) ?? []).filter((r) => BAND_ROLES.includes(r) && !already.has(r));
  const nobody = await Promise.all(held.map(async (r) => !(await bandRoleCandidates(sessionId, r, [memberId, ...refusers(r)], db)).length));
  return held.filter((_, i) => nobody[i]);
}

/** The band leader / talkback this person is doing at a session, each with who could take it over. */
export async function bandRolesToHandOver(sessionId: string, memberId: string, db: Db = createAdminClient()): Promise<BandRoleChoice[]> {
  const [{ data: mine }, { data: asked }] = await Promise.all([
    db.from("roster_assignments").select("also_roles").eq("session_id", sessionId).eq("member_id", memberId).maybeSingle(),
    db.from("handover_requests").select("role").eq("session_id", sessionId).eq("member_id", memberId).eq("status", "open"),
  ]);
  // Ones already being handed over aren't asked about again.
  const already = new Set((asked ?? []).map((h) => h.role as string));
  const held = ((mine?.also_roles as string[] | null) ?? []).filter((r) => BAND_ROLES.includes(r) && !already.has(r));
  return Promise.all(held.map(async (role) => ({ role, candidates: await bandRoleCandidates(sessionId, role, [memberId], db) })));
}

export type BandRolePick = { role: string; targetId: string | null };
type BandRolePlan = { role: string; targetId: string | null }[];

/**
 * Check, before anything is saved, who takes over each band leader / talkback role they're doing:
 * the one they picked, or the only person who can. Nobody can: null (root and admins are told).
 * Already being handed over: left alone.
 */
export async function planBandRoles(sessionId: string, memberId: string, picks: BandRolePick[] = [], db: Db = createAdminClient()): Promise<BandRolePlan> {
  const [choices, { data: open }] = await Promise.all([
    bandRolesToHandOver(sessionId, memberId, db),
    db.from("handover_requests").select("role").eq("session_id", sessionId).eq("member_id", memberId).eq("status", "open"),
  ]);
  const asked = new Set((open ?? []).map((h) => h.role as string));
  const plan: BandRolePlan = [];
  for (const c of choices) {
    if (asked.has(c.role)) continue;
    if (!c.candidates.length) {
      plan.push({ role: c.role, targetId: null });
      continue;
    }
    const picked = picks.find((p) => p.role === c.role)?.targetId ?? (c.candidates.length === 1 ? c.candidates[0]!.id : null);
    if (!picked) throw new Error(`Choose who to ask to take over ${bandRoleLabel(c.role).toLowerCase()}.`);
    if (!c.candidates.some((x) => x.id === picked)) throw new Error(`That person can't take over ${bandRoleLabel(c.role).toLowerCase()}. Pick someone else.`);
    plan.push({ role: c.role, targetId: picked });
  }
  return plan;
}

async function logRosterUpdate(
  db: Db,
  row: { kind: UpdateKind; session_id: string; role: string; actor_id: string; member_id?: string | null; reason?: string | null; other_session_id?: string | null },
) {
  await db.from("roster_updates").insert(row);
}

/** Ask a bandmate to take over a band leader / talkback role. */
export async function askHandover(db: Db, sessionId: string, role: string, memberId: string, targetId: string) {
  await db.from("handover_requests").update({ status: "cancelled", closed_at: new Date().toISOString() }).eq("session_id", sessionId).eq("role", role).eq("member_id", memberId).eq("status", "open");
  const { error } = await db.from("handover_requests").insert({ session_id: sessionId, role, member_id: memberId, target_id: targetId });
  if (error) throw error;
  await logRosterUpdate(db, { kind: "band_role_asked", session_id: sessionId, role, actor_id: memberId, member_id: targetId });
}

/**
 * Tell root and admins a session is losing (or has lost) a band leader / talkback its band needs,
 * unless someone else there still does it or they've already been told.
 */
export async function flagMissingBandRole(db: Db, sessionId: string, role: string, actorId: string, leaving: string | null = null) {
  const [{ data: session }, { data: holders }, { data: already }] = await Promise.all([
    db.from("roster_sessions").select("composition").eq("id", sessionId).maybeSingle(),
    db.from("roster_assignments").select("member_id").eq("session_id", sessionId).contains("also_roles", [role]),
    db.from("roster_updates").select("id").eq("session_id", sessionId).eq("role", role).eq("kind", "band_role_missing").is("resolved_at", null).limit(1),
  ]);
  const needs = Number(((session?.composition as Record<string, number> | null) ?? {})[role] ?? 0) > 0;
  if (!needs || already?.length) return;
  if ((holders ?? []).some((h) => h.member_id !== leaving)) return;
  await logRosterUpdate(db, { kind: "band_role_missing", session_id: sessionId, role, actor_id: actorId });
}

/** Carry out a plan from planBandRoles once the person's step-out has been saved. */
export async function handOverBandRoles(db: Db, sessionId: string, memberId: string, plan: BandRolePlan) {
  for (const p of plan) {
    if (p.targetId) await askHandover(db, sessionId, p.role, memberId, p.targetId);
    else await flagMissingBandRole(db, sessionId, p.role, memberId, memberId);
  }
}

/** Mark updates about a situation as resolved (e.g. a place covered, a band role taken over). */
export async function resolveUpdates(db: Db, where: { sessionId: string; kinds: UpdateKind[]; actorId?: string; role?: string }) {
  let q = db.from("roster_updates").update({ resolved_at: new Date().toISOString() }).eq("session_id", where.sessionId).in("kind", where.kinds).is("resolved_at", null);
  if (where.actorId) q = q.eq("actor_id", where.actorId);
  if (where.role) q = q.eq("role", where.role);
  await q;
}

/** The person's absence covering this session's date or its rehearsal, if any. */
export async function awayFor(db: Db, userId: string, sessionId: string): Promise<AwayAbsence | null> {
  const { data: s } = await db.from("roster_sessions").select("date, rehearsal_date").eq("id", sessionId).maybeSingle();
  if (!s) return null;
  const days = [s.date as string, ...(s.rehearsal_date ? [s.rehearsal_date as string] : [])];
  const { data } = await db
    .from("absences")
    .select("id, starts_on, ends_on, reason")
    .eq("member_id", userId)
    .or(days.map((d) => `and(starts_on.lte.${d},ends_on.gte.${d})`).join(","))
    .order("starts_on")
    .limit(1);
  const a = data?.[0];
  return a ? { id: a.id, startsOn: a.starts_on, endsOn: a.ends_on, reason: a.reason } : null;
}

/**
 * Rehearsals this person's worship leader said they can miss (moved to a day they're away, going
 * ahead without a sub), as "sessionId|rehearsalDate". Stale ones (the rehearsal moved again) don't
 * match the session's rehearsal any more, so they no longer count.
 */
export async function excusedRehearsals(db: Db, userId: string): Promise<Set<string>> {
  const { data } = await db.from("rehearsal_excusals").select("session_id, rehearsal_date").eq("member_id", userId);
  return new Set((data ?? []).map((e) => `${e.session_id}|${e.rehearsal_date}`));
}

/** A session someone is serving at (confirmed, or not answered yet) that falls in an absence they're adding. */
export type AbsenceClash = {
  session: SessionInfo;
  role: string;
  /** They haven't answered "can you serve?" yet: adding the absence answers it with "can't". */
  unanswered: boolean;
  /** Which of its days the absence covers. */
  on: ("service" | "rehearsal")[];
  /** Who could cover it (including greyed-out ones who can't be asked). */
  candidates: CoverCandidate[];
  /** Band leader / talkback they're also doing there, with who in the band could take each over. */
  bandRoles: BandRoleChoice[];
};

/**
 * Upcoming sessions the person is serving at, confirmed ("I can serve") or not answered yet, whose
 * date or rehearsal falls between these dates. Sessions they've already asked someone to cover
 * don't count.
 */
export async function absenceClashes(userId: string, startsOn: string, endsOn: string): Promise<AbsenceClash[]> {
  const db = createAdminClient();
  const today = todayYmd();
  const [sessions, { data: places }, { data: answers }, { data: covers }, excused] = await Promise.all([
    publishedSessions(db),
    db.from("roster_assignments").select("session_id, role").eq("member_id", userId),
    db.from("serve_requests").select("session_id, status").eq("member_id", userId).in("status", ["accepted", "pending"]),
    db.from("cover_requests").select("session_id").eq("member_id", userId).in("status", ["open", "refused"]),
    excusedRehearsals(db, userId),
  ]);
  const status = new Map((answers ?? []).map((r) => [r.session_id as string, r.status as "accepted" | "pending"]));
  const handled = new Set((covers ?? []).map((c) => c.session_id));
  const inRange = (d: string) => d >= startsOn && d <= endsOn;
  const found = (places ?? []).flatMap((p) => {
    const s = sessions.get(p.session_id);
    if (!s || s.date < today || !status.has(s.id) || handled.has(s.id)) return [];
    const on = [...(inRange(s.date) ? (["service"] as const) : []), ...(s.rehearsal && inRange(s.rehearsal) && !excused.has(`${s.id}|${s.rehearsal}`) ? (["rehearsal"] as const) : [])];
    return on.length ? [{ s, role: p.role as string, on, unanswered: status.get(s.id) === "pending" }] : [];
  });
  const clashes = await Promise.all(
    found.map(async ({ s, role, on, unanswered }) => ({
      session: info(s),
      role,
      unanswered,
      on,
      candidates: await coverOptions(s.id, role, userId),
      bandRoles: await bandRolesToHandOver(s.id, userId, db),
    })),
  );
  return clashes.sort((a, b) => a.session.date.localeCompare(b.session.date) || a.session.name.localeCompare(b.session.name));
}

/**
 * An absence was deleted, or changed to cover fewer days: for each upcoming session the old dates
 * covered (the service or its rehearsal) that no other absence still clashes with, take down the
 * person's cover requests nobody has taken yet (with their swap offers), and put "can you serve?"
 * back to unanswered if it was declined, so they're asked again.
 */
export async function releaseCoverAfterAbsence(userId: string, old: { startsOn: string; endsOn: string }) {
  const db = createAdminClient();
  const today = todayYmd();
  const [sessions, { data: places }, { data: away }] = await Promise.all([
    publishedSessions(db),
    db.from("roster_assignments").select("session_id, role").eq("member_id", userId),
    db.from("absences").select("starts_on, ends_on").eq("member_id", userId).gte("ends_on", today),
  ]);
  const inOld = (d: string | null) => Boolean(d) && d! >= old.startsOn && d! <= old.endsOn;
  const isAway = (d: string | null) => Boolean(d) && (away ?? []).some((a) => a.starts_on <= d! && a.ends_on >= d!);
  const freed = (places ?? []).filter((p) => {
    const s = sessions.get(p.session_id);
    return s && s.date >= today && (inOld(s.date) || inOld(s.rehearsal)) && !isAway(s.date) && !isAway(s.rehearsal);
  });
  if (!freed.length) return;
  const ids = freed.map((p) => p.session_id as string);
  const now = new Date().toISOString();

  const { data: covers } = await db
    .from("cover_requests")
    .update({ status: "cancelled", closed_at: now })
    .eq("member_id", userId)
    .in("session_id", ids)
    .in("status", ["open", "refused"])
    .select("id, session_id, role, target_id");
  if (covers?.length) {
    await db.from("swap_proposals").update({ status: "closed", closed_at: now }).in("cover_id", covers.map((c) => c.id)).eq("status", "pending");
    await db.from("roster_updates").insert(
      covers.map((c) => ({ kind: "cancelled", session_id: c.session_id, role: c.role, actor_id: userId, member_id: c.target_id })),
    );
  }
  await db
    .from("serve_requests")
    .update({ status: "pending", reason: null, responded_at: null })
    .eq("member_id", userId)
    .in("session_id", ids)
    .eq("status", "declined");
}

/**
 * Sessions the coverer could give the requester in a swap: the coverer's upcoming sessions where
 * the requester plays that part, isn't already serving, and isn't away (including during
 * `alsoAway`, an absence being added).
 */
export async function swapOptions(
  requesterId: string,
  counterpartId: string,
  excludeSessionId: string,
  alsoAway?: { startsOn: string; endsOn: string },
): Promise<SwapOption[]> {
  const db = createAdminClient();
  const today = todayYmd();
  const [sessions, people, { data: theirs }, { data: requesterServing }, { data: requesterAway }] = await Promise.all([
    publishedSessions(db),
    activePeople(db),
    db.from("roster_assignments").select("session_id, role").eq("member_id", counterpartId),
    db.from("roster_assignments").select("session_id").eq("member_id", requesterId),
    db.from("absences").select("starts_on, ends_on").eq("member_id", requesterId).gte("ends_on", today),
  ]);
  // What the requester plays on each session's team.
  const plays = (s: PublishedSession) => playsOn(people.get(requesterId), s.teamId);
  const serving = new Set((requesterServing ?? []).map((s) => s.session_id));
  const ranges = [...(requesterAway ?? []), ...(alsoAway ? [{ starts_on: alsoAway.startsOn, ends_on: alsoAway.endsOn }] : [])];
  const away = (date: string) => ranges.some((a) => a.starts_on <= date && a.ends_on >= date);
  return (theirs ?? [])
    .map((a) => ({ a, s: sessions.get(a.session_id) }))
    .filter(
      ({ a, s }) =>
        s && s.id !== excludeSessionId && s.date >= today && plays(s).includes(a.role) && !serving.has(s.id) && !away(s.date) && !(s.rehearsal && away(s.rehearsal)),
    )
    .map(({ a, s }) => ({ ...info(s!), role: a.role }))
    .sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
}

/** Pending swap proposals on these cover requests, keyed by cover id. */
async function pendingProposals(db: Db, coverIds: string[], sessions: Map<string, SessionInfo>, people: Map<string, Person>, viewerId: string) {
  const out = new Map<string, Proposal[]>();
  if (!coverIds.length) return out;
  const { data } = await db
    .from("swap_proposals")
    .select("id, cover_id, counterpart_id, offer_session_id, proposed_by")
    .in("cover_id", coverIds)
    .eq("status", "pending")
    .order("created_at");
  const offerRoles = new Map<string, string>();
  const pairs = (data ?? []).map((p) => `${p.offer_session_id}|${p.counterpart_id}`);
  if (pairs.length) {
    const { data: roles } = await db
      .from("roster_assignments")
      .select("session_id, member_id, role")
      .in("session_id", [...new Set((data ?? []).map((p) => p.offer_session_id))]);
    for (const r of roles ?? []) offerRoles.set(`${r.session_id}|${r.member_id}`, r.role);
  }
  for (const p of data ?? []) {
    const s = sessions.get(p.offer_session_id);
    const role = offerRoles.get(`${p.offer_session_id}|${p.counterpart_id}`);
    if (!s || !role) continue; // the offered session changed since; ignore
    out.set(p.cover_id, [
      ...(out.get(p.cover_id) ?? []),
      {
        id: p.id,
        counterpart: { id: p.counterpart_id, name: people.get(p.counterpart_id)?.name ?? "Someone" },
        offer: { ...info(s), role },
        byMe: p.proposed_by === viewerId,
      },
    ]);
  }
  return out;
}

/** Everything the requests box shows the viewer. */
export async function loadRequestsBoard(userId: string): Promise<RequestsBoard> {
  const db = createAdminClient();
  const today = todayYmd();
  const sessions = await publishedSessions(db);
  const ids = [...sessions.keys()].filter((id) => sessions.get(id)!.date >= today);
  if (!ids.length) return { pending: [], incoming: [], mine: [], handoversIn: [], handoversMine: [], awayUncovered: [] };

  const [people, { data: pendingRows }, { data: covers }, { data: myServing }, { data: myAway }, excused] = await Promise.all([
    activePeople(db),
    db.from("serve_requests").select("id, session_id, role").eq("member_id", userId).eq("status", "pending").in("session_id", ids),
    db.from("cover_requests").select("id, session_id, member_id, role, target_id, status").in("status", ["open", "refused"]).in("session_id", ids),
    db.from("roster_assignments").select("session_id, role").eq("member_id", userId).in("session_id", ids),
    db.from("absences").select("id, starts_on, ends_on, reason").eq("member_id", userId).gte("ends_on", today),
    excusedRehearsals(db, userId),
  ]);
  const person = (id: string | null): Candidate | null => (id ? { id, name: people.get(id)?.name ?? "Someone" } : null);
  const byDate = <T extends { session: SessionInfo }>(xs: T[]) =>
    xs.sort((a, b) => a.session.date.localeCompare(b.session.date) || a.session.name.localeCompare(b.session.name));
  const serving = new Set((myServing ?? []).map((s) => s.session_id));

  // A pending request only counts while they're still on that session.
  const pending = await Promise.all(
    (pendingRows ?? [])
      .filter((r) => serving.has(r.session_id))
      .map(async (r) => ({
        id: r.id,
        role: r.role,
        session: info(sessions.get(r.session_id)!),
        candidates: await coverOptions(r.session_id, r.role, userId),
        bandRoles: await bandRolesToHandOver(r.session_id, userId, db),
      })),
  );

  const proposals = await pendingProposals(db, (covers ?? []).map((c) => c.id), sessions, people, userId);
  // The absence (if any) covering a session's date or its rehearsal.
  // A rehearsal their worship leader said they can miss doesn't count.
  const awayAt = (s: SessionInfo): AwayAbsence | null => {
    const days = [s.date, ...(s.rehearsal && !excused.has(`${s.id}|${s.rehearsal}`) ? [s.rehearsal] : [])];
    const a = (myAway ?? []).find((x) => days.some((d) => x.starts_on <= d && x.ends_on >= d));
    return a ? { id: a.id, startsOn: a.starts_on, endsOn: a.ends_on, reason: a.reason } : null;
  };
  const incoming: CoverItem[] = [];
  const mine: CoverItem[] = [];
  for (const c of covers ?? []) {
    const all = proposals.get(c.id) ?? [];
    const item: CoverItem = {
      id: c.id,
      role: c.role,
      session: info(sessions.get(c.session_id)!),
      status: c.status as "open" | "refused",
      from: person(c.member_id)!,
      target: person(c.target_id),
      proposals: all.filter((p) => p.counterpart.id === userId),
    };
    if (c.member_id === userId) {
      mine.push({
        ...item,
        proposals: all,
        candidates: await coverOptions(c.session_id, c.role, userId),
        away: awayAt(item.session),
        bandRoles: await bandRolesToHandOver(c.session_id, userId, db),
      });
    } else if (c.status === "open" && c.target_id === userId) {
      // Only the person asked sees a request: there's no requests board for everyone else.
      incoming.push(item);
    }
  }
  // Band leader / talkback handovers: asked of the viewer, and the viewer's own still to settle.
  const { data: handovers } = await db
    .from("handover_requests")
    .select("id, session_id, role, member_id, target_id, status, created_at")
    .or(`target_id.eq.${userId},member_id.eq.${userId}`)
    .in("session_id", ids)
    .order("created_at");
  const handoversIn: HandoverItem[] = [];
  const latest = new Map<string, NonNullable<typeof handovers>[number]>();
  for (const h of handovers ?? []) {
    if (h.target_id === userId && h.status === "open") {
      handoversIn.push({ id: h.id, role: h.role, session: info(sessions.get(h.session_id)!), from: person(h.member_id)!, target: person(h.target_id)!, status: "open" });
    }
    if (h.member_id === userId) latest.set(`${h.session_id}|${h.role}`, h); // oldest first, so the last one wins
  }
  const handoversMine: HandoverItem[] = await Promise.all(
    [...latest.values()]
      .filter((h) => h.status === "open" || h.status === "refused")
      .map(async (h) => ({
        id: h.id,
        role: h.role,
        session: info(sessions.get(h.session_id)!),
        from: person(h.member_id)!,
        target: person(h.target_id)!,
        status: h.status as "open" | "refused",
        candidates: h.status === "refused" ? await bandRoleCandidates(h.session_id, h.role, [userId, h.target_id], db) : undefined,
      })),
  );
  // Checked on every load: rostered while away, and nothing open asking anyone to cover it.
  const asking = new Set((covers ?? []).filter((c) => c.member_id === userId).map((c) => c.session_id));
  const awayUncovered: AwayClash[] = await Promise.all(
    (myServing ?? [])
      .map((m) => ({ m, s: info(sessions.get(m.session_id)!) }))
      .filter(({ m, s }) => !asking.has(m.session_id) && awayAt(s))
      .map(async ({ m, s }) => ({
        session: s,
        role: m.role as string,
        absence: awayAt(s)!,
        candidates: await coverOptions(s.id, m.role as string, userId),
        bandRoles: await bandRolesToHandOver(s.id, userId, db),
      })),
  );
  return {
    awayUncovered: byDate(awayUncovered),
    pending: byDate(pending),
    incoming: byDate(incoming),
    mine: byDate(mine),
    handoversIn: byDate(handoversIn),
    handoversMine: byDate(handoversMine),
  };
}

/** One open request, as the viewer sees it on the calendar before covering it. */
export type CoverDetail = {
  id: string;
  role: string;
  session: SessionInfo;
  from: Candidate;
  /** Asked directly (to the viewer). */
  direct: boolean;
  canCover: boolean;
  whyNot?: string;
  /** Band leader / talkback that come with the place that the viewer would take over too. */
  alsoTake: string[];
  /** The viewer's sessions the requester could take in a swap. */
  swapOptions: SwapOption[];
  /** Proposals between the viewer and the requester still waiting. */
  proposals: Proposal[];
};

export async function loadCoverDetail(coverId: string, userId: string): Promise<CoverDetail | null> {
  const db = createAdminClient();
  const { data: c } = await db
    .from("cover_requests")
    .select("id, session_id, member_id, role, target_id, status")
    .eq("id", coverId)
    .maybeSingle();
  if (!c || c.status !== "open" || c.member_id === userId) return null;
  // Only the person asked directly (old board posts aren't open to anyone any more).
  if (c.target_id !== userId) return null;
  const [sessions, people] = await Promise.all([publishedSessions(db), activePeople(db)]);
  const session = sessions.get(c.session_id);
  if (!session) return null;

  const me = people.get(userId);
  const mine = (await coverOptions(c.session_id, c.role, c.member_id, db)).find((p) => p.id === userId);
  let whyNot: string | undefined;
  if (!mine || mine.unavailable) {
    const { data: awayOnDay } = await db.from("absences").select("id").eq("member_id", userId).lte("starts_on", session.date).gte("ends_on", session.date).limit(1);
    whyNot = !mine || !playsOn(me, session.teamId).includes(c.role)
      ? "You don't play this part."
      : mine.unavailable === "serving"
        ? "You're already serving that day."
        : mine.unavailable === "band"
          ? `${(mine.withPlace ?? []).map(bandRoleLabel).join(" and ")} ${mine.withPlace?.length === 1 ? "comes" : "come"} with this place and nobody else in the band can do ${mine.withPlace?.length === 1 ? "it" : "them"}: you'd need to be able to do ${mine.withPlace?.length === 1 ? "it" : "at least one"}.`
          : awayOnDay?.length || !session.rehearsal
            ? "You're away that day."
            : "You're away on the rehearsal day.";
  }
  const proposals = (await pendingProposals(db, [c.id], sessions, people, userId)).get(c.id) ?? [];
  return {
    id: c.id,
    role: c.role,
    session: info(session),
    from: { id: c.member_id, name: people.get(c.member_id)?.name ?? "Someone" },
    direct: c.target_id === userId,
    canCover: !whyNot,
    whyNot,
    alsoTake: whyNot ? [] : (mine?.bandRoles ?? []),
    swapOptions: whyNot ? [] : await swapOptions(c.member_id, userId, c.session_id),
    proposals: proposals.filter((p) => p.counterpart.id === userId),
  };
}

/** The viewer's sessions on published rosters, and their rehearsals (kind "rehearsal"), for the calendar. */
export async function loadMySessions(userId: string): Promise<MySession[]> {
  const db = createAdminClient();
  const [sessions, { data }] = await Promise.all([
    publishedSessions(db),
    db.from("roster_assignments").select("session_id, role").eq("member_id", userId),
  ]);
  return (data ?? [])
    .filter((a) => sessions.has(a.session_id))
    .flatMap((a) => {
      const s = sessions.get(a.session_id)!;
      const session: MySession = { ...info(s), kind: s.kind, role: a.role };
      return s.rehearsal
        ? [
            session,
            {
              id: `${s.id}:rehearsal`,
              date: s.rehearsal,
              name: `Rehearsal: ${s.name}`,
              kind: "rehearsal",
              role: a.role,
              forSession: { date: s.date, name: s.name, kind: s.kind },
            },
          ]
        : [session];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Only the two people involved see asks, refusals and swap proposals: who asked and who was asked.
 * (Old requests-board posts too.) The band hears once a take-over or swap is confirmed.
 */
const PRIVATE: UpdateKind[] = [
  "asked",
  "posted",
  "refused",
  "cancelled",
  "swap_proposed",
  "swap_declined",
  "band_role_asked",
  "band_role_refused",
  ...ROSTER_CHANGE_KINDS,
];
/** Swaps not done yet: leads don't see these unless they're one of the two people. */
const SWAP_PENDING: UpdateKind[] = ["swap_proposed", "swap_declined"];
/** Root hears nothing about swaps, on any roster. */
const SWAPS: UpdateKind[] = [...SWAP_PENDING, "swapped"];
/** Only root and admins (and whoever caused it) see these. */
const FOR_ADMINS: UpdateKind[] = ["band_role_missing"];

/**
 * Recent roster changes, newest first. Root sees everything but swaps, with reasons, plus leads
 * adding and removing people on every team. Everyone else sees
 * changes they're part of, and changes to the bands they're in (the session, and for a swap the
 * session offered in return): not changes to other bands, even ones using their instrument.
 */
export function loadUpdates(user: { id: string; isLead: boolean; isRoot: boolean; team: { id: string } | null }): Promise<UpdateItem[]> {
  // No team: root on Brighton Serving, which hears about every team's sessions.
  return updatesFor(user.id, user.isLead, user.isRoot, user.team?.id ?? null);
}

/** Leads adding or removing people, on every team (root is app-wide): root's alone. */
export async function logMemberChange(
  actor: { id: string; isRoot: boolean; team: { id: string } },
  kind: "member_added" | "member_removed",
  memberId: string | null,
  name: string,
) {
  if (actor.isRoot) return; // root did it: nothing to tell root
  await createAdminClient().from("roster_updates").insert({ kind, team_id: actor.team.id, actor_id: actor.id, member_id: memberId, detail: name });
}

/** How long a roster update stays in the inbox. */
const UPDATE_LIFETIME_DAYS = 14;

/** Once per request per person: the nav's inbox and the landing page both need it. */
const updatesFor = cache(async (userId: string, isLead: boolean, isRoot: boolean, teamId: string | null): Promise<UpdateItem[]> => {
  const user = { id: userId, isLead, isRoot };
  const db = createAdminClient();
  const columns = "id, kind, session_id, other_session_id, role, actor_id, member_id, reason, detail, created_at, resolved_at, team_id";
  // Updates expire from the inbox after two weeks (the rows stay in the database).
  const since = new Date(Date.now() - UPDATE_LIFETIME_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Only the signed-in team's sessions: a lead or admin of one team doesn't hear about another's.
  // Root also hears about leads adding or removing people, on every team.
  // A team's lead also hears about other teams linking to (or unlinking from) its sessions.
  const leadOfTeam = user.isLead && !user.isRoot && teamId;
  const [sessions, { data: memberRows }, { data: teamRows }, { data: linkRows }] = await Promise.all([
    publishedSessions(db, teamId ?? undefined),
    user.isRoot
      ? db.from("roster_updates").select(columns).in("kind", MEMBER_KINDS).gte("created_at", since).order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as never[] }),
    db.from("teams").select("id, name, kind"),
    leadOfTeam
      ? db.from("roster_updates").select(columns).in("kind", LINK_KINDS).eq("team_id", teamId).gte("created_at", since).order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const teamKind = new Map((teamRows ?? []).map((t) => [t.id as string, t.kind as string]));
  // Sessions on a published roster now (before cancelled ones are added for naming): a link notice
  // opens the lead's service page only for these.
  const live = new Set(sessions.keys());
  const teamName = new Map((teamRows ?? []).map((t) => [t.id as string, t.name as string]));
  if (!sessions.size && !memberRows?.length && !linkRows?.length) return [];
  // Roster changes are also about sessions since cancelled or deleted: fetched on their own.
  let changes = db.from("roster_updates").select(columns).in("kind", ROSTER_CHANGE_KINDS).gte("created_at", since);
  // Bandmates' notes are one per person: root gets only their own, so they don't crowd the limit.
  changes = user.isLead ? changes.or(`kind.neq.roster_band_changed,member_id.eq.${user.id}`) : changes.eq("member_id", user.id);
  const none = Promise.resolve({ data: [] as never[] });
  const [{ data: onSessions }, { data: changeRows }, people, { data: me }, { data: mine }] = await Promise.all([
    sessions.size
      ? db
          .from("roster_updates")
          .select(columns)
          .in("session_id", [...sessions.keys()])
          .neq("kind", "roster_band_changed") // fetched with the roster changes, for the person they're for
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(300)
      : none,
    sessions.size ? changes.order("created_at", { ascending: false }).limit(100) : none,
    activePeople(db),
    db.from("profiles").select("updates_seen_at").eq("id", user.id).maybeSingle(),
    db.from("roster_assignments").select("session_id").eq("member_id", user.id),
  ]);
  const seenIds = new Set((onSessions ?? []).map((u) => u.id));
  const changeIds = new Set((changeRows ?? []).map((u) => u.id));
  const all = [
    ...(onSessions ?? []),
    ...(changeRows ?? []).filter((u) => !seenIds.has(u.id)),
    ...(memberRows ?? []),
    ...(linkRows ?? []).filter((u) => !seenIds.has(u.id) && !changeIds.has(u.id)),
  ].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  // Sessions roster changes mention that aren't live any more (cancelled), for naming them.
  const missing = [...new Set(all.flatMap((u) => (u.session_id && !sessions.has(u.session_id) ? [u.session_id as string] : [])))];
  if (missing.length) {
    let extraQ = db.from("roster_sessions").select("id, date, name, kind, rehearsal_date, rosters!inner(team_id)").in("id", missing);
    if (teamId) extraQ = extraQ.eq("rosters.team_id", teamId);
    const { data: extra } = await extraQ;
    for (const s of extra ?? []) {
      const team = (s.rosters as unknown as { team_id: string } | null)?.team_id ?? teamId ?? "";
      sessions.set(s.id, { id: s.id, date: s.date, name: s.name, kind: s.kind, rehearsal: (s.rehearsal_date as string | null) ?? null, teamId: team });
    }
  }
  // Roster changes on other teams' sessions are left out (every update is about a session).
  const data = all.filter((u) => !u.session_id || sessions.has(u.session_id));
  const admin = user.isLead || (teamId ? await isAdmin(user.id, teamId, db) : false);
  const mySessions = new Set((mine ?? []).map((m) => m.session_id));
  const seenAt = me?.updates_seen_at ? new Date(me.updates_seen_at).getTime() : 0;
  const name = (id: string | null) => (id ? (people.get(id)?.name ?? "Someone") : null);
  const sessionInfo = (id: string | null) => {
    const s = id ? sessions.get(id) : undefined;
    return s ? info(s) : null;
  };

  // Older direct asks with a swap logged both "asked" and "swap_proposed" for the one request, the
  // ask just before the swap: keep only the swap proposal. An ask logged after a swap proposal is
  // the swap being dropped for a plain take-over, and stays.
  const swapAt = new Map<string, number[]>();
  for (const u of data ?? []) {
    if (u.kind !== "swap_proposed") continue;
    const k = `${u.session_id}|${u.actor_id}|${u.member_id}`;
    swapAt.set(k, [...(swapAt.get(k) ?? []), new Date(u.created_at).getTime()]);
  }
  const duplicateAsk = (u: { kind: string; session_id: string; actor_id: string; member_id: string | null; created_at: string }) => {
    if (u.kind !== "asked") return false;
    const askedAt = new Date(u.created_at).getTime();
    return (swapAt.get(`${u.session_id}|${u.actor_id}|${u.member_id}`) ?? []).some((t) => t >= askedAt && t - askedAt < 60_000);
  };

  // The part at each offered swap session: whichever of the two people is rostered on it (the one
  // asked before the swap, the requester after). Usually the same instrument as the request.
  const otherIds = [...new Set((data ?? []).flatMap((u) => (u.other_session_id ? [u.other_session_id as string] : [])))];
  const { data: otherRows } = otherIds.length
    ? await db.from("roster_assignments").select("session_id, member_id, role").in("session_id", otherIds)
    : { data: [] as { session_id: string; member_id: string; role: string }[] };
  const roleAt = new Map((otherRows ?? []).map((r) => [`${r.session_id}|${r.member_id}`, r.role as string]));
  const otherRole = (u: { other_session_id: string | null; actor_id: string; member_id: string | null; role: string | null }) =>
    u.other_session_id
      ? (roleAt.get(`${u.other_session_id}|${u.member_id}`) ?? roleAt.get(`${u.other_session_id}|${u.actor_id}`) ?? u.role)
      : null;

  // "Session … has been updated" opens that session's plan (once they've confirmed serving on it;
  // until then, their requests, where they confirm).
  const updatedIds = [...new Set(data.filter((u) => u.kind === "session_updated").map((u) => u.session_id as string))];
  const [{ data: plans }, { data: confirmedRows }] = updatedIds.length
    ? await Promise.all([
        db.from("worship_sessions").select("id, roster_session_id").in("roster_session_id", updatedIds),
        db.from("serve_requests").select("session_id").eq("member_id", user.id).eq("status", "accepted").in("session_id", updatedIds),
      ])
    : [{ data: [] as { id: string; roster_session_id: string }[] }, { data: [] as { session_id: string }[] }];
  const planFor = new Map((plans ?? []).map((p) => [p.roster_session_id as string, p.id as string]));
  const confirmed = new Set((confirmedRows ?? []).map((r) => r.session_id as string));
  const href = (u: { kind: string; session_id: string; team_id?: string | null; detail?: string | null }) => {
    // A link notice: the lead's own service page (Services), while the session's on a published roster.
    if (LINK_KINDS.includes(u.kind as UpdateKind)) {
      if (!live.has(u.session_id) || !u.team_id) return null;
      return `${teamKind.get(u.team_id as string) === "media" ? "/services" : "/sessions/services"}/${u.session_id}`;
    }
    // A media crew's copy: the worship team's plan (detail: its id), on their Projection page.
    if (u.kind === "session_updated" && teamKind.get(sessions.get(u.session_id)?.teamId ?? "") === "media") {
      return u.detail ? `/projection/${u.detail}` : null;
    }
    if (u.kind !== "session_updated" || !planFor.has(u.session_id)) return null;
    return user.isLead || confirmed.has(u.session_id) ? `/sessions/${planFor.get(u.session_id)}` : "/roster#requests";
  };

  const mySide = (u: { kind: string; session_id: string; other_session_id: string | null; actor_id: string; member_id: string | null }) => {
    if (!u.other_session_id || !u.kind.startsWith("swap") || (u.actor_id !== user.id && u.member_id !== user.id)) return null;
    // Once swapped, each holds the other's session, so their own side is the one they no longer have.
    const swapped = u.kind === "swapped";
    if (mySessions.has(u.session_id)) return swapped ? "other" : "session";
    if (mySessions.has(u.other_session_id)) return swapped ? "session" : "other";
    return null;
  };

  // Root sees each roster edit as the band hears it: one "changed the band" note per session, not a
  // row per person moved (rows from one edit are saved together, so they share a timestamp). A
  // session's date/time change, told to everyone on it, is likewise shown once.
  const MOVES: Record<string, number> = { roster_removed: 0, roster_added: 1, roster_part_changed: 2 };
  const collapse = <T extends (typeof data)[number]>(rows: T[]): T[] => {
    if (!user.isLead) return rows;
    const groups = new Map<string, { row: T; parts: [number, string][] }>();
    const out: T[] = [];
    for (const u of rows) {
      const isMove = u.kind in MOVES;
      if (!u.session_id || (!isMove && u.kind !== "roster_session_changed")) {
        out.push(u);
        continue;
      }
      const k = `${u.kind === "roster_session_changed" ? "s" : "m"}|${u.actor_id}|${u.session_id}|${u.created_at}`;
      let g = groups.get(k);
      if (!g) {
        g = { row: { ...u, kind: isMove ? "roster_band_changed" : u.kind, member_id: null }, parts: [] };
        groups.set(k, g);
        out.push(g.row);
      }
      if (!isMove) continue;
      const who = name(u.member_id) ?? "Someone";
      const role = (ROLE_LABEL[u.role as string] ?? u.role ?? "").toLowerCase();
      const detail = (u.detail as string | null) ?? null;
      const text =
        u.kind === "roster_removed"
          ? `${who} off ${role}`
          : u.kind === "roster_added"
            ? `${who} on ${role}${detail ? ` and ${detail}` : ""}`
            : `${who} ${(detail ?? "").toLowerCase()}`;
      g.parts.push([MOVES[u.kind], text]);
    }
    for (const g of groups.values()) {
      if (g.row.kind === "roster_band_changed") g.row.detail = g.parts.sort((a, b) => a[0] - b[0]).map(([, t]) => t).join(", ");
    }
    return out;
  };

  const visible = (data ?? [])
    .filter((u) => !duplicateAsk(u))
    .filter((u) => {
      const involved = u.actor_id === user.id || u.member_id === user.id;
      // Only fetched for root.
      if (MEMBER_KINDS.includes(u.kind as UpdateKind)) return true;
      // Only for the lead of the team whose session it's about (also fetched with its sessions' updates).
      if (LINK_KINDS.includes(u.kind as UpdateKind)) return Boolean(leadOfTeam) && u.team_id === teamId;
      // Root hears nothing about swaps, on any roster.
      if (user.isRoot && SWAPS.includes(u.kind as UpdateKind)) return false;
      // One copy per bandmate, for that bandmate only: whoever made the edit sees the changes themselves.
      if (u.kind === "roster_band_changed") return u.member_id === user.id && u.actor_id !== user.id;
      if (involved) return true;
      // The rest of a roster edit is one row per person moved, for that person: the band hears it
      // once, in their own "changed the band" note.
      if (ROSTER_CHANGE_KINDS.includes(u.kind as UpdateKind)) return user.isLead;
      // Leads hear about a swap once it's done, not while it's only proposed (or turned down).
      if (user.isLead) return !SWAP_PENDING.includes(u.kind as UpdateKind);
      if (FOR_ADMINS.includes(u.kind as UpdateKind)) return admin;
      if (PRIVATE.includes(u.kind as UpdateKind)) return false;
      return mySessions.has(u.session_id) || Boolean(u.other_session_id && mySessions.has(u.other_session_id));
    });
  return collapse(visible)
    .slice(0, 150)
    .map((u) => ({
      id: u.id,
      kind: u.kind as UpdateKind,
      role: u.role,
      session: sessionInfo(u.session_id),
      otherSession: sessionInfo(u.other_session_id),
      otherRole: otherRole(u),
      mySide: mySide(u),
      actor: name(u.actor_id) ?? "Someone",
      member: name(u.member_id),
      reason: user.isLead || u.actor_id === user.id ? u.reason : null,
      detail: (u.detail as string | null) ?? null,
      crew: teamKind.get(u.team_id as string) === "media",
      createdAt: u.created_at,
      isNew: u.actor_id !== user.id && new Date(u.created_at).getTime() > seenAt,
      byMe: u.actor_id === user.id,
      concernsMe:
        u.member_id === user.id || mySessions.has(u.session_id) || Boolean(u.other_session_id && mySessions.has(u.other_session_id)),
      resolvedAt: (u.resolved_at as string | null) ?? null,
      href: href(u),
      team: u.team_id ? (teamName.get(u.team_id as string) ?? null) : null,
    }));
});

/**
 * "sessionId|memberId" -> status, for colouring names on this quarter's roster. Anyone who can't
 * make it shows as declined, however that came about: they said so, they've asked for cover (e.g.
 * after adding an absence), or they're away on the day or at its rehearsal.
 */
export async function loadServeStatuses(rosterId: string): Promise<Record<string, ServeStatus>> {
  const db = createAdminClient();
  const today = todayYmd(); // past sessions aren't coloured
  const { data } = await db
    .from("serve_requests")
    .select("session_id, member_id, status, roster_sessions!inner(date, rehearsal_date)")
    .eq("roster_id", rosterId)
    .gte("roster_sessions.date", today);
  const rows = data ?? [];
  if (!rows.length) return {};

  const sessionIds = [...new Set(rows.map((r) => r.session_id as string))];
  const memberIds = [...new Set(rows.map((r) => r.member_id as string))];
  const [{ data: covers }, { data: away }] = await Promise.all([
    db.from("cover_requests").select("session_id, member_id").in("session_id", sessionIds).in("status", ["open", "refused"]),
    db.from("absences").select("member_id, starts_on, ends_on").in("member_id", memberIds).gte("ends_on", today),
  ]);
  const covering = new Set((covers ?? []).map((c) => `${c.session_id}|${c.member_id}`));
  const isAway = (memberId: string, date: string | null) =>
    Boolean(date) && (away ?? []).some((a) => a.member_id === memberId && a.starts_on <= date! && a.ends_on >= date!);

  return Object.fromEntries(
    rows.map((r) => {
      const key = `${r.session_id}|${r.member_id}`;
      const s = r.roster_sessions as unknown as { date: string; rehearsal_date: string | null };
      const cant = covering.has(key) || isAway(r.member_id, s.date) || isAway(r.member_id, s.rehearsal_date);
      return [key, cant ? "declined" : (r.status as ServeStatus)];
    }),
  );
}
