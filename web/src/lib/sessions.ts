import "server-only";
import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { CACHE_LIFE, SONGS_TAG } from "@/lib/cache-tags";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABEL, addDays, defaultRehearsalTime, defaultStartTime, hhmm, todayYmd } from "@/lib/roster";
import type { ReminderSession } from "@/lib/reminder";
import { LOCK_STALE_MS, cleanSheet, keyLabel, partCues, type BuildStage, type PartCue, type PlanLink, type PlanSection, type PlanStatus, type SeqStep, type SongType } from "@/lib/session-plan";
import type { CurrentUser } from "@/lib/auth";
import { sheetKeysFor } from "@/lib/session-songsheets";
import { loadTeams, type Team } from "@/lib/teams";
import { TEAM_GROUPS, type TeamGroup } from "@/lib/team-config";

/**
 * Session building. A session plan belongs to one service on one date (worship_sessions) and is
 * built by that service's worship leaders, once they've confirmed they're serving. Everyone else
 * rostered on it can read it once it's published.
 */

const WL = "worship leader";

type Db = ReturnType<typeof createAdminClient>;

export type RosterSessionInfo = { id: string; date: string; name: string; kind: string };

/**
 * The developer account (in its own view, not viewing as root, a group or a person) can build and
 * edit every session, not just ones it leads.
 */
export function buildsAnySession(user: Pick<CurrentUser, "isDeveloper" | "viewAs">): boolean {
  return user.isDeveloper && user.viewAs === null;
}

export type BuildableSession = RosterSessionInfo & {
  /** The viewer leads it (false for sessions the developer builds for others). */
  involved: boolean;
  stage: BuildStage;
  planId: string | null;
  /** The other worship leaders on it. */
  coLeaders: string[];
  lockedBy: string | null;
};

export type UpcomingPlan = {
  id: string;
  date: string;
  name: string;
  songs: { title: string; key: string | null }[];
  /** null: the viewer isn't on it (the developer looking at someone else's draft). */
  role: string | null;
  isLeader: boolean;
  /** Not published yet: only its worship leaders (and the developer) see it here. */
  draft: boolean;
  /** Published, with changes its worship leaders saved but haven't published (only they see this). */
  revised: boolean;
};

/**
 * Upcoming sessions of the team's published rosters, keyed by id. Each team sees only its own
 * sessions (Youth never sees Main Worship's, and the other way round), even someone on both. Run
 * once per request (the nav and the page both need it); callers only read the map.
 */
const upcomingPublishedSessions = cache(async (teamId: string): Promise<Map<string, RosterSessionInfo>> => {
  const db = createAdminClient();
  const { data: rosters } = await db.from("rosters").select("id").eq("status", "published").eq("team_id", teamId);
  const ids = (rosters ?? []).map((r) => r.id);
  if (!ids.length) return new Map();
  const { data } = await db
    .from("roster_sessions")
    .select("id, date, name, kind")
    .in("roster_id", ids)
    .eq("cancelled", false)
    .gte("date", todayYmd())
    .order("date");
  return new Map((data ?? []).map((s) => [s.id, { id: s.id, date: s.date, name: s.name, kind: s.kind ?? "custom" }]));
});

/** Sessions the person serves on and has confirmed (accepted), with their role. */
async function confirmedSessions(db: Db, userId: string): Promise<Map<string, string>> {
  const { data } = await db.from("serve_requests").select("session_id, role").eq("member_id", userId).eq("status", "accepted");
  return new Map((data ?? []).map((r) => [r.session_id, r.role]));
}

async function names(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await db.from("profiles").select("id, full_name, email").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, p.full_name || p.email]));
}

export function lockIsLive(lockedAt: string | null): boolean {
  return Boolean(lockedAt) && Date.now() - new Date(lockedAt!).getTime() < LOCK_STALE_MS;
}

/**
 * Upcoming sessions the person leads worship at and has confirmed, with how far each plan has got.
 * Also how many they lead but haven't confirmed yet (those can't be built until they do).
 */
export function loadBuildableSessions(
  userId: string,
  teamId: string,
  { all = false }: { all?: boolean } = {},
): Promise<{ sessions: BuildableSession[]; unconfirmed: number }> {
  return buildableSessions(userId, all, teamId);
}

/** Once per request per person: the Sessions page and the nav's publish reminder both need it. */
const buildableSessions = cache(async (userId: string, all: boolean, teamId: string): Promise<{ sessions: BuildableSession[]; unconfirmed: number }> => {
  const db = createAdminClient();
  const [sessions, confirmed, { data: mine }] = await Promise.all([
    upcomingPublishedSessions(teamId),
    confirmedSessions(db, userId),
    db.from("roster_assignments").select("session_id").eq("member_id", userId).eq("role", WL),
  ]);
  const leading = (mine ?? []).map((m) => m.session_id).filter((id) => sessions.has(id));
  const mineConfirmed = new Set(leading.filter((id) => confirmed.get(id) === WL));
  // The developer gets every upcoming session; everyone else, the ones they lead and have confirmed.
  const ids = all ? [...sessions.keys()] : [...mineConfirmed];
  const unconfirmed = all ? 0 : leading.length - ids.length;
  if (!ids.length) return { sessions: [], unconfirmed };

  const [{ data: leaders }, { data: plans }] = await Promise.all([
    db.from("roster_assignments").select("session_id, member_id").in("session_id", ids).eq("role", WL),
    db.from("worship_sessions").select("id, roster_session_id, status, locked_by, locked_at").in("roster_session_id", ids),
  ]);
  const people = await names(db, [
    ...new Set([...(leaders ?? []).map((l) => l.member_id), ...(plans ?? []).flatMap((p) => (p.locked_by ? [p.locked_by] : []))]),
  ]);
  const plan = new Map((plans ?? []).map((p) => [p.roster_session_id, p]));

  return {
    unconfirmed,
    sessions: ids
      .map((id) => sessions.get(id)!)
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
      .map((s) => {
        const p = plan.get(s.id);
        const lockedBy = p?.locked_by && p.locked_by !== userId && lockIsLive(p.locked_at) ? (people.get(p.locked_by) ?? "Someone") : null;
        return {
          ...s,
          involved: mineConfirmed.has(s.id),
          stage: (p?.status as PlanStatus | undefined) ?? "not_started",
          planId: p?.id ?? null,
          coLeaders: (leaders ?? []).filter((l) => l.session_id === s.id && l.member_id !== userId).map((l) => people.get(l.member_id) ?? "Someone"),
          lockedBy,
        };
      }),
  };
});

/** How long before a session its worship leaders are reminded to publish the plan. */
export const PUBLISH_REMINDER_DAYS = 14;

/** A session the person leads that's two weeks away or less and still has no published plan. */
export type PublishDueNotice = {
  rosterSessionId: string;
  planId: string | null;
  date: string;
  name: string;
  stage: BuildStage;
  /** Where the reminder takes them: the session's plan, or the builder list if not started. */
  href: string;
};

/**
 * Sessions the person leads (and has confirmed) that are within PUBLISH_REMINDER_DAYS and haven't
 * been published yet, soonest first. Shown until the plan is published.
 */
export const loadPublishDue = cache(async (userId: string, teamId: string): Promise<PublishDueNotice[]> => {
  const { sessions } = await loadBuildableSessions(userId, teamId);
  const cutoff = addDays(todayYmd(), PUBLISH_REMINDER_DAYS);
  return sessions
    .filter((s) => s.involved && s.stage !== "published" && s.date <= cutoff)
    .map((s) => ({
      rosterSessionId: s.id,
      planId: s.planId,
      date: s.date,
      name: s.name,
      stage: s.stage,
      href: s.planId ? `/sessions/${s.planId}` : `/sessions/build#session-${s.id}`,
    }));
});

/**
 * Published plans of upcoming sessions the person serves on and has confirmed, plus the drafts of
 * the ones they lead worship at (`draft: true`). `all` (the developer): every upcoming draft too.
 */
/**
 * `all`: the viewer builds any session (the developer), so sees every draft.
 * `everyone`: root's "all sessions" view: every upcoming published plan, not just the viewer's.
 */
export async function loadUpcomingPlans(
  userId: string,
  teamId: string,
  { all = false, everyone = false }: { all?: boolean; everyone?: boolean } = {},
): Promise<UpcomingPlan[]> {
  const db = createAdminClient();
  const [sessions, confirmed] = await Promise.all([upcomingPublishedSessions(teamId), confirmedSessions(db, userId)]);
  const ids = all || everyone ? [...sessions.keys()] : [...confirmed.keys()].filter((id) => sessions.has(id));
  if (!ids.length) return [];
  const { data: rows } = await db
    .from("worship_sessions")
    .select(
      "id, roster_session_id, status, draft_updated_at, worship_session_sections(position, worship_session_items(position, kind, title, key, transpose_to))",
    )
    .in("roster_session_id", ids)
    .in("status", ["published", "draft"]);
  // Leads it (or is the developer): sees its draft, and unpublished changes to its published plan.
  const builds = (id: string) => all || confirmed.get(id) === WL;
  const plans = (rows ?? []).filter((p) =>
    p.status === "published" ? everyone || confirmed.has(p.roster_session_id!) : builds(p.roster_session_id!),
  );
  type Sec = { position: number; worship_session_items: { position: number; kind: string; title: string; key: string | null; transpose_to: string | null }[] };
  return plans
    .map((p) => {
      const s = sessions.get(p.roster_session_id!)!;
      const role = confirmed.get(s.id) ?? null;
      const songs = ((p.worship_session_sections ?? []) as Sec[])
        .sort((a, b) => a.position - b.position)
        .flatMap((sec) => [...sec.worship_session_items].sort((a, b) => a.position - b.position))
        .filter((i) => i.kind === "song" && i.title)
        .map((i) => ({ title: i.title, key: keyLabel(i.key, i.transpose_to) }));
      const draft = p.status === "draft";
      const revised = !draft && builds(s.id) && Boolean(p.draft_updated_at);
      return {
        id: p.id,
        date: s.date,
        name: s.name,
        songs,
        role: role ? (ROLE_LABEL[role] ?? role) : null,
        isLeader: role === WL,
        draft,
        revised,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export type Access = {
  /** A confirmed worship leader of this session: may edit. */
  canEdit: boolean;
  canView: boolean;
};

/** What this person may do with a session plan. */
export async function sessionAccess(
  user: Pick<CurrentUser, "id" | "isLead" | "isDeveloper" | "viewAs" | "can" | "team">,
  plan: { roster_session_id: string | null; status: string },
): Promise<Access> {
  // Brighton Serving (root, outside every team): it may look at any plan; editing is done in its team.
  if (!user.team) return { canEdit: false, canView: user.isLead };
  if (!plan.roster_session_id) return { canEdit: buildsAnySession(user), canView: user.isLead };
  // Another team's session: not even its lead can open it from this team.
  if (!(await sessionInTeam(plan.roster_session_id, user.team.id))) return { canEdit: false, canView: false };
  const { data } = await createAdminClient()
    .from("serve_requests")
    .select("role, status")
    .eq("session_id", plan.roster_session_id)
    .eq("member_id", user.id)
    .maybeSingle();
  const confirmed = data?.status === "accepted";
  const canEdit = (confirmed && data?.role === WL) || buildsAnySession(user);
  // Others serving on it see it once it's published; root and session managers can always look;
  // sessions.view ("See every published session plan in the team") opens every published plan.
  const canView =
    canEdit ||
    (confirmed && data?.role === WL) ||
    user.isLead ||
    user.can("sessions.manage") ||
    (plan.status === "published" && (confirmed || user.can("sessions.view")));
  return { canEdit, canView };
}

/** Is this roster session on one of the team's rosters? */
export async function sessionInTeam(rosterSessionId: string, teamId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("roster_sessions")
    .select("id, rosters!inner(team_id)")
    .eq("id", rosterSessionId)
    .eq("rosters.team_id", teamId)
    .maybeSingle();
  return Boolean(data);
}

/** `you`: the viewer (cards highlight their name in their part's colour). */
export type BandMember = { id: string; name: string; role: string; also: string[]; you?: boolean };

export type Workbench = {
  id: string;
  date: string;
  service: string;
  serviceName: string;
  status: PlanStatus;
  /** The band's rehearsal for this session, if it has one. */
  rehearsalDate: string | null;
  /** "HH:MM": the rehearsal's time as set, else the usual one for its kind and day; null = none given. */
  rehearsalTime: string | null;
  /** "HH:MM": when the service starts (as set, else the usual), or null. */
  startTime: string | null;
  /** On a roster (so it can have a rehearsal), rather than an ad-hoc plan. */
  onRoster: boolean;
  band: BandMember[];
  /** The viewer's part in this session, if they're on it (e.g. "drums"). */
  myRole: string | null;
  /**
   * What the band sees: the published plan, or for a session never published, the draft (its
   * worship leaders' work so far).
   */
  plan: PlanSection[];
  /** Links for the whole session (on top of each song's own), from the same version as `plan`. */
  links: PlanLink[];
  /**
   * For the worship leaders of a published session: their revised copy, not published yet. null
   * when there's none (the draft is the published plan), and always null for everyone else.
   */
  revision: { plan: PlanSection[]; links: PlanLink[]; updatedAt: string | null; updatedBy: string | null } | null;
  /** Republished changes the viewer hasn't closed the box on yet, newest first. */
  changes: PlanRevisionNotice[];
  /**
   * The published plan the latest republishing replaced, for "Show changes" (added and taken out,
   * like a diff). null when it's never been republished, or was before the old plan was kept.
   */
  previous: { plan: PlanSection[]; links: PlanLink[]; publishedAt: string; publishedBy: string | null } | null;
  /**
   * Songs in `plan` that change key: item id -> the keys of their songsheets ([E] when the sheet
   * already covers the change, else [E, G]). Songs not listed have one sheet in their key.
   */
  sheetKeys: Record<string, string[]>;
  /** Someone else holds the editing lock right now. */
  lockedBy: { id: string; name: string } | null;
  updatedAt: string;
  updatedBy: string | null;
};

/** One time a revised plan was published, and what changed then. */
export type PlanRevisionNotice = { id: string; publishedAt: string; publishedBy: string | null; changes: string[] };

/** A plan as stored (tables or a saved revision), tidied into the editor's shape. */
export function normalisePlan(raw: unknown): PlanSection[] {
  type Item = Omit<PlanSection["items"][number], "bpm"> & { position?: number; bpm: number | string | null };
  type Sec = { id: string; name: string; position?: number; items?: Item[]; worship_session_items?: Item[] };
  const secs = (Array.isArray(raw) ? raw : []) as Sec[];
  const byPos = <T extends { position?: number }>(xs: T[]) => (xs.some((x) => x.position !== undefined) ? [...xs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : xs);
  return byPos(secs).map((sec) => ({
    id: sec.id,
    name: sec.name,
    items: byPos(sec.worship_session_items ?? sec.items ?? []).map((i) => ({
      id: i.id,
      kind: i.kind,
      song_id: i.song_id ?? null,
      lead_id: i.lead_id ?? null,
      title: i.title ?? "",
      type: (i.type as SongType | null) ?? null,
      bpm: i.bpm === null || i.bpm === undefined || i.bpm === "" ? null : Number(i.bpm),
      key: i.key ?? null,
      transpose_to: i.transpose_to ?? null,
      artist: i.artist ?? null,
      sequence: Array.isArray(i.sequence) ? i.sequence.map((st) => ({ ...st, parts: st.parts ?? [] })) : null,
      custom_elements: i.custom_elements ?? [],
      links: i.links ?? null,
      notes: i.notes ?? "",
      sheet: cleanSheet(i.sheet),
    })),
  }));
}

/** Session links as stored, tidied (anything malformed is left out). */
export function sessionLinks(raw: unknown): PlanLink[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((l): l is PlanLink => Boolean(l) && typeof l.url === "string" && l.url !== "")
    .map((l) => ({ label: typeof l.label === "string" ? l.label : "", url: l.url }));
}

/**
 * A session plan for the session page. `withRevision`: include the worship leaders' unpublished
 * revision (only for people who can edit).
 */
export async function loadWorkbench(id: string, userId: string, { withRevision = false }: { withRevision?: boolean } = {}) {
  const db = createAdminClient();
  const { data: s } = await db
    .from("worship_sessions")
    .select(
      "id, date, service, service_name, roster_session_id, status, locked_by, locked_at, updated_at, updated_by, links, draft_plan, draft_links, draft_updated_at, draft_updated_by, worship_session_sections(id, name, position, worship_session_items(id, position, kind, song_id, lead_id, title, type, bpm, key, transpose_to, artist, sequence, custom_elements, links, notes, sheet))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!s) return null;

  const [{ data: assignments }, { data: rs }, { data: revisions }, { data: latest }] = await Promise.all([
    s.roster_session_id
      ? db.from("roster_assignments").select("member_id, role, also_roles").eq("session_id", s.roster_session_id)
      : Promise.resolve({ data: [] as { member_id: string; role: string; also_roles: string[] | null }[] }),
    s.roster_session_id
      ? db.from("roster_sessions").select("kind, rehearsal_date, rehearsal_time, start_time").eq("id", s.roster_session_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("worship_session_revisions")
      .select("id, published_at, published_by, changes, worship_session_revision_dismissals(member_id)")
      .eq("session_id", id)
      .order("published_at", { ascending: false })
      .limit(10),
    db
      .from("worship_session_revisions")
      .select("published_at, published_by, plan_before, links_before")
      .eq("session_id", id)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  // Not their own publishing, and not ones they've closed.
  const unseen = (revisions ?? []).filter(
    (r) =>
      r.published_by !== userId &&
      !((r.worship_session_revision_dismissals ?? []) as { member_id: string }[]).some((d) => d.member_id === userId) &&
      ((r.changes as string[] | null) ?? []).length > 0,
  );
  const people = await names(db, [
    ...new Set([
      ...(assignments ?? []).map((a) => a.member_id),
      ...[s.locked_by, s.updated_by, s.draft_updated_by].filter((x): x is string => Boolean(x)),
      ...unseen.flatMap((r) => (r.published_by ? [r.published_by as string] : [])),
      ...(latest?.published_by ? [latest.published_by as string] : []),
    ]),
  ]);
  const order = (role: string) => {
    const i = Object.keys(ROLE_LABEL).indexOf(role);
    return i < 0 ? 99 : i;
  };

  const plan = normalisePlan(s.worship_session_sections);
  const hasRevision = withRevision && s.status === "published" && Array.isArray(s.draft_plan);

  const workbench: Workbench = {
    id: s.id,
    date: s.date,
    service: s.service,
    serviceName: s.service_name,
    status: s.status as PlanStatus,
    rehearsalDate: (rs?.rehearsal_date as string | null | undefined) ?? null,
    rehearsalTime: rs?.rehearsal_date
      ? (hhmm(rs.rehearsal_time as string | null) ?? defaultRehearsalTime((rs.kind as string | null) ?? "custom", rs.rehearsal_date as string))
      : null,
    startTime: rs ? (hhmm(rs.start_time as string | null) ?? defaultStartTime((rs.kind as string | null) ?? "custom")) : null,
    onRoster: Boolean(rs),
    band: (assignments ?? [])
      .map((a) => ({ id: a.member_id, name: people.get(a.member_id) ?? "Someone", role: a.role, also: (a.also_roles as string[]) ?? [] }))
      .sort((a, b) => order(a.role) - order(b.role) || a.name.localeCompare(b.name)),
    myRole: ((assignments ?? []).find((a) => a.member_id === userId)?.role as string | undefined) ?? null,
    plan,
    links: sessionLinks(s.links),
    sheetKeys: await sheetKeysFor(plan.flatMap((sec) => sec.items).filter((i) => i.kind === "song")),
    revision: hasRevision
      ? {
          plan: normalisePlan(s.draft_plan),
          // A revision saved before session links existed keeps the published ones.
          links: sessionLinks(s.draft_links ?? s.links),
          updatedAt: (s.draft_updated_at as string | null) ?? null,
          updatedBy: s.draft_updated_by ? (people.get(s.draft_updated_by as string) ?? null) : null,
        }
      : null,
    changes:
      s.status === "published"
        ? unseen.map((r) => ({
            id: r.id as string,
            publishedAt: r.published_at as string,
            publishedBy: r.published_by ? (people.get(r.published_by as string) ?? null) : null,
            changes: (r.changes as string[] | null) ?? [],
          }))
        : [],
    previous:
      s.status === "published" && latest && Array.isArray(latest.plan_before)
        ? {
            plan: normalisePlan(latest.plan_before),
            links: sessionLinks(latest.links_before),
            publishedAt: latest.published_at as string,
            publishedBy: latest.published_by ? (people.get(latest.published_by as string) ?? null) : null,
          }
        : null,
    lockedBy:
      s.locked_by && s.locked_by !== userId && lockIsLive(s.locked_at) ? { id: s.locked_by, name: people.get(s.locked_by) ?? "Someone" } : null,
    updatedAt: s.updated_at,
    updatedBy: s.updated_by ? (people.get(s.updated_by) ?? null) : null,
  };
  return { workbench, rosterSessionId: s.roster_session_id as string | null };
}

export type BankSong = {
  id: string;
  title: string;
  artist: string | null;
  type: SongType | null;
  bpm: number | null;
  language: "en" | "zh";
  key: string | null;
  keyDisplay: string | null;
};

/** Every song in the library, for the song bank list (filtered in the browser). Cached (see lib/cache-tags.ts). */
export async function loadSongBank(): Promise<BankSong[]> {
  "use cache: remote";
  cacheTag(SONGS_TAG);
  cacheLife(CACHE_LIFE);
  const { data, error } = await createAdminClient()
    .from("songs")
    .select("id, title, artist, type, bpm, language, original_key, song_versions(keys, key_display)")
    .order("title");
  if (error) throw error;
  return (data ?? []).map((s) => {
    const v = ((s.song_versions ?? []) as { keys: string[]; key_display: string | null }[])[0];
    return {
      id: s.id,
      title: s.title,
      artist: s.artist,
      type: s.type as SongType | null,
      bpm: s.bpm === null ? null : Number(s.bpm),
      language: s.language as "en" | "zh",
      key: v?.keys?.[0] ?? s.original_key ?? null,
      keyDisplay: v?.key_display ?? null,
    };
  });
}

/** One session as the viewer sees it: when, the band, and the plan once it's published. */
export type SessionDetail = {
  rosterSessionId: string;
  date: string;
  name: string;
  kind: string;
  rehearsal: string | null;
  /** As stored ("HH:MM:SS"); null = the default for its kind (see lib/reminder). */
  startTime: string | null;
  rehearsalTime: string | null;
  /** The viewer's part in it (null if they're not in it, e.g. root looking), and +BL / +TB. */
  role: string | null;
  also: string[];
  /** Whether they've confirmed they're serving (pending until they answer). */
  serveStatus: "pending" | "accepted" | "declined" | null;
  /** A media team's session: `band` is its crew. */
  crew: boolean;
  /** In role order (WL, vocalists, then the instruments; a crew: the media team's roles). */
  band: BandMember[];
  /** The worship leaders' plan, once published; null until then. A crew's: the crewed service's, songs only. */
  plan: {
    id: string;
    /** The plan's sections in order ("Main Set", "Closing Song", ...), each with its songs; empty ones left out. */
    sections: { name: string; songs: { title: string; key: string | null; lead: { id: string; name: string } | null }[] }[];
    canOpen: boolean;
    /** Where the worship leaders want more of the viewer's instrument. */
    cues: PartCue[];
  } | null;
};

export type NextSession = SessionDetail & {
  role: string;
  /** One of the viewer's later sessions whose rehearsal is tomorrow, if any (for the reminder). */
  rehearsalTomorrow: ReminderSession | null;
};

/** The soonest session (today or later) on a published roster that the person is rostered on. */
export async function loadNextSession(userId: string, teamId: string): Promise<NextSession | null> {
  const db = createAdminClient();
  const [sessions, { data: mine }] = await Promise.all([
    upcomingPublishedSessions(teamId),
    db.from("roster_assignments").select("session_id, role").eq("member_id", userId),
  ]);
  const next = (mine ?? [])
    .filter((a) => sessions.has(a.session_id))
    .map((a) => ({ ...sessions.get(a.session_id)!, role: a.role as string }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))[0];
  if (!next) return null;

  const tomorrow = addDays(todayYmd(), 1);
  const myIds = (mine ?? []).map((a) => a.session_id as string).filter((id) => sessions.has(id));
  const [detail, { data: rehearsing }] = await Promise.all([
    sessionDetail(db, userId, next.id),
    db
      .from("roster_sessions")
      .select("date, name, kind, rehearsal_date, start_time, rehearsal_time")
      .in("id", myIds)
      .eq("rehearsal_date", tomorrow)
      .order("date")
      .limit(1),
  ]);
  if (!detail) return null;
  const r = rehearsing?.[0];
  return {
    ...detail,
    role: next.role,
    rehearsalTomorrow: r
      ? { date: r.date, name: r.name, kind: r.kind ?? "custom", rehearsal: r.rehearsal_date, startTime: r.start_time, rehearsalTime: r.rehearsal_time }
      : null,
  };
}

/** The media team whose roster this session is on, or null (a worship team's session). */
async function mediaTeamOf(db: Db, sessionId: string): Promise<Team | null> {
  const { data } = await db.from("roster_sessions").select("rosters!inner(team_id)").eq("id", sessionId).maybeSingle();
  const teamId = (data?.rosters as unknown as { team_id: string } | null)?.team_id;
  const team = teamId ? (await loadTeams()).find((t) => t.id === teamId) : undefined;
  return team?.kind === "media" ? team : null;
}

/**
 * The worship service a media session crews, for its songs: a standard service is the worship
 * team's (same group) session that day of the same kind; an ad hoc one, the worship session it's
 * linked to (lib/service-links.ts), if any. Its published plan, as songs only (media members don't
 * open plans).
 */
async function crewedServicePlan(
  db: Db,
  userId: string,
  group: TeamGroup,
  s: { date: string; kind: string; name: string; linkId: string | null },
): Promise<SessionDetail["plan"]> {
  if (s.kind === "custom" && !s.linkId) return null;
  const worshipIds = (await loadTeams()).filter((t) => t.group === group && t.kind === "worship").map((t) => t.id);
  if (!worshipIds.length) return null;
  let q = db
    .from("roster_sessions")
    .select("id, name, kind, rosters!inner(team_id, status)")
    .in("rosters.team_id", worshipIds)
    .eq("rosters.status", "published")
    .eq("date", s.date)
    .eq("cancelled", false);
  q = s.kind === "custom" ? q.eq("link_id", s.linkId!) : q.eq("kind", s.kind);
  const { data } = await q;
  const service = (data ?? [])[0];
  const plan = service ? (await sessionDetail(db, userId, service.id as string))?.plan : null;
  return plan ? { ...plan, canOpen: false, cues: [] } : null;
}

/** Build one session's details for this viewer (no access check: callers do that). */
async function sessionDetail(db: Db, userId: string, sessionId: string): Promise<SessionDetail | null> {
  const [{ data: row }, { data: band }, { data: serve }, { data: plan }] = await Promise.all([
    db.from("roster_sessions").select("id, date, name, kind, rehearsal_date, start_time, rehearsal_time, link_id").eq("id", sessionId).maybeSingle(),
    db.from("roster_assignments").select("member_id, role, also_roles").eq("session_id", sessionId),
    db.from("serve_requests").select("status").eq("session_id", sessionId).eq("member_id", userId).maybeSingle(),
    db
      .from("worship_sessions")
      .select("id, worship_session_sections(name, position, worship_session_items(position, kind, title, key, transpose_to, lead_id, sequence))")
      .eq("roster_session_id", sessionId)
      .eq("status", "published")
      .maybeSingle(),
  ]);
  if (!row) return null;
  // A media team's session: its crew, with the songs of the worship service it crews.
  const media = await mediaTeamOf(db, sessionId);
  type Sec = {
    name: string;
    position: number;
    worship_session_items: {
      position: number;
      kind: string;
      title: string;
      key: string | null;
      transpose_to: string | null;
      lead_id: string | null;
      sequence: SeqStep[] | null;
    }[];
  };
  const sections = ((plan?.worship_session_sections ?? []) as Sec[])
    .sort((a, b) => a.position - b.position)
    .map((sec) => ({ name: sec.name, items: [...sec.worship_session_items].sort((a, b) => a.position - b.position) }));
  const items = sections.flatMap((sec) => sec.items);
  // Song leads too: one may have come off the session since the plan was made.
  const people = await names(db, [
    ...new Set([...(band ?? []).map((b) => b.member_id as string), ...items.flatMap((i) => (i.lead_id ? [i.lead_id] : []))]),
  ]);
  // The band's usual order, or a crew's: the media team's roles.
  const order = new Map((media ? media.config.roles : Object.keys(ROLE_LABEL)).map((r, i) => [r, i]));
  const serveStatus = (serve?.status as SessionDetail["serveStatus"]) ?? null;
  const me = (band ?? []).find((b) => b.member_id === userId);

  return {
    rosterSessionId: row.id,
    date: row.date,
    name: row.name,
    kind: row.kind ?? "custom",
    rehearsal: (row.rehearsal_date as string | null) ?? null,
    startTime: row.start_time ?? null,
    rehearsalTime: row.rehearsal_time ?? null,
    role: (me?.role as string | undefined) ?? null,
    also: (me?.also_roles as string[] | null) ?? [],
    serveStatus,
    crew: Boolean(media),
    band: (band ?? [])
      .map((b) => ({
        id: b.member_id as string,
        name: people.get(b.member_id) ?? "Someone",
        role: b.role as string,
        also: (b.also_roles as string[] | null) ?? [],
        you: b.member_id === userId,
      }))
      .sort((a, b) => (order.get(a.role) ?? 99) - (order.get(b.role) ?? 99) || a.name.localeCompare(b.name)),
    plan: media
      ? await crewedServicePlan(db, userId, media.group, { date: row.date, kind: row.kind ?? "custom", name: row.name, linkId: (row.link_id as string | null) ?? null })
      : plan
      ? {
          id: plan.id,
          // Same as the session page's own check: published plans open for people who've confirmed.
          canOpen: serveStatus === "accepted",
          sections: sections
            .map((sec) => ({
              name: sec.name,
              songs: sec.items
                .filter((i) => i.kind === "song" && i.title)
                .map((i) => ({
                  title: i.title,
                  key: keyLabel(i.key, i.transpose_to),
                  lead: i.lead_id ? { id: i.lead_id, name: people.get(i.lead_id) ?? "Someone" } : null,
                })),
            }))
            .filter((sec) => sec.songs.length > 0),
          cues: partCues(items as Parameters<typeof partCues>[0], (me?.role as string | undefined) ?? null),
        }
      : null,
  };
}

/**
 * One session's details, for the calendar. Members see sessions on a published roster that they're
 * in; root sees any session (the calendar shows root every service), an observer its group's.
 */
export async function loadSessionDetail(
  user: { id: string; isLead: boolean; isRoot?: boolean; observerGroup?: TeamGroup | null; team: { id: string } | null },
  sessionId: string,
): Promise<SessionDetail | null> {
  const db = createAdminClient();
  // An observer's calendar shows every session of its group's teams.
  if (user.observerGroup) {
    const { data } = await db.from("roster_sessions").select("rosters!inner(team_id)").eq("id", sessionId).maybeSingle();
    const teamId = (data?.rosters as unknown as { team_id: string } | null)?.team_id;
    const groupIds = new Set((await loadTeams()).filter((t) => t.group === user.observerGroup).map((t) => t.id));
    return teamId && groupIds.has(teamId) ? sessionDetail(db, user.id, sessionId) : null;
  }
  // Only the signed-in team's sessions, the lead included; root's calendar shows every team's.
  if (!user.isRoot && !(user.team && (await sessionInTeam(sessionId, user.team.id)))) return null;
  if (!user.isLead) {
    const { data } = await db
      .from("roster_assignments")
      .select("id, roster_sessions!inner(rosters!inner(status))")
      .eq("session_id", sessionId)
      .eq("member_id", user.id)
      .eq("roster_sessions.rosters.status", "published")
      .limit(1);
    if (!data?.length) return null;
  }
  return sessionDetail(db, user.id, sessionId);
}

/** One of the viewer's upcoming services, for the Roster page's "Your Services" gallery. */
export type MyService = {
  /** A media team's service: `band` is its crew. */
  crew: boolean;
  rosterSessionId: string;
  date: string;
  name: string;
  /** In role order (WL, vocalists, then the instruments). */
  band: BandMember[];
  /** The published plan's id (opens the session); null while it isn't published. */
  planId: string | null;
};

/**
 * Upcoming sessions on any published roster (this quarter's, and next quarter's once it's out)
 * that the person is rostered on and has confirmed, soonest first.
 */
export async function loadMyServices(userId: string, teamId: string): Promise<MyService[]> {
  const db = createAdminClient();
  const [sessions, { data: mine }, confirmed] = await Promise.all([
    upcomingPublishedSessions(teamId),
    db.from("roster_assignments").select("session_id").eq("member_id", userId),
    confirmedSessions(db, userId),
  ]);
  const ids = [...new Set((mine ?? []).map((m) => m.session_id as string))].filter((id) => sessions.has(id) && confirmed.has(id));
  if (!ids.length) return [];
  const [{ data: band }, { data: plans }] = await Promise.all([
    db.from("roster_assignments").select("session_id, member_id, role, also_roles").in("session_id", ids),
    db.from("worship_sessions").select("id, roster_session_id").in("roster_session_id", ids).eq("status", "published"),
  ]);
  const [people, team] = await Promise.all([
    names(db, [...new Set((band ?? []).map((b) => b.member_id as string))]),
    loadTeams().then((ts) => ts.find((t) => t.id === teamId)),
  ]);
  // A media team's crew, in its roles' order; otherwise the band's usual order.
  const crew = team?.kind === "media";
  const order = new Map((crew ? team.config.roles : Object.keys(ROLE_LABEL)).map((r, i) => [r, i]));
  const planFor = new Map((plans ?? []).map((p) => [p.roster_session_id as string, p.id as string]));
  return ids
    .map((id) => {
      const s = sessions.get(id)!;
      return {
        crew,
        rosterSessionId: id,
        date: s.date,
        name: s.name,
        // A crew doesn't open the worship team's plans.
        planId: crew ? null : (planFor.get(id) ?? null),
        band: (band ?? [])
          .filter((b) => b.session_id === id)
          .map((b) => ({
            id: b.member_id as string,
            name: people.get(b.member_id) ?? "Someone",
            role: b.role as string,
            also: (b.also_roles as string[] | null) ?? [],
            you: b.member_id === userId,
          }))
          .sort((a, b) => (order.get(a.role) ?? 99) - (order.get(b.role) ?? 99) || a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** A plan published (or published again) since the person last looked at Sessions. */
export type PublishedNotice = {
  planId: string;
  date: string;
  name: string;
  publishedBy: string | null;
  canOpen: boolean;
  /** Published again with changes (not its first publishing). */
  updated: boolean;
};

/**
 * Upcoming sessions the person is rostered on whose plan was published since they last looked at
 * Sessions, soonest first. Their own publishing doesn't count.
 */
export const loadNewlyPublished = cache(async (userId: string, teamId: string): Promise<PublishedNotice[]> => {
  const db = createAdminClient();
  const [sessions, { data: mine }, { data: me }, confirmed] = await Promise.all([
    upcomingPublishedSessions(teamId),
    db.from("roster_assignments").select("session_id").eq("member_id", userId),
    db.from("profiles").select("sessions_seen_at").eq("id", userId).maybeSingle(),
    confirmedSessions(db, userId),
  ]);
  const ids = (mine ?? []).map((m) => m.session_id as string).filter((id) => sessions.has(id));
  if (!ids.length) return [];
  let q = db
    .from("worship_sessions")
    .select("id, roster_session_id, published_by")
    .in("roster_session_id", ids)
    .eq("status", "published")
    .not("published_at", "is", null);
  if (me?.sessions_seen_at) q = q.gt("published_at", me.sessions_seen_at);
  const { data: plans } = await q;
  const fresh = (plans ?? []).filter((p) => p.published_by !== userId);
  const [people, { data: revised }] = await Promise.all([
    names(db, [...new Set(fresh.flatMap((p) => (p.published_by ? [p.published_by as string] : [])))]),
    fresh.length
      ? db.from("worship_session_revisions").select("session_id").in("session_id", fresh.map((p) => p.id as string))
      : Promise.resolve({ data: [] as { session_id: string }[] }),
  ]);
  const updated = new Set((revised ?? []).map((r) => r.session_id as string));
  return fresh
    .map((p) => {
      const s = sessions.get(p.roster_session_id!)!;
      return {
        planId: p.id as string,
        date: s.date,
        name: s.name,
        publishedBy: p.published_by ? (people.get(p.published_by) ?? null) : null,
        canOpen: confirmed.has(s.id),
        updated: updated.has(p.id as string),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
});

/** The weekday each group's services are on: Main on Sunday, Youth on Saturday (0 = Sunday). */
export const GROUP_SERVICE_DAY: Record<TeamGroup, number> = { main: 0, youth: 6 };

/** The next date (today included) that falls on this weekday. */
function nextWeekday(today: string, weekday: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const now = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(today, (weekday - now + 7) % 7);
}

/** Who's on a media team's roster that day, by role. */
export type CrewMember = { id: string; name: string; role: string; team: string; session: string };

/**
 * The standard services that have a media crew (the rest are a session and a band only): EM Sunday
 * service and EM PnP (Main Media), and the YF Saturday service (Youth Media).
 */
const CREW_KINDS = new Set(["em_sunday", "em_pnp", "saturday"]);

/**
 * A service, as root and the observer see it. Usually a worship team's session on a published
 * roster (its plan and band) with, for the services that have one, the media crew of the same
 * group: for a standard service, the media team's session of the same kind that day; for an ad hoc
 * one, the media sessions linked to it (lib/service-links.ts). A media team's session that crews no
 * worship session (e.g. an ad hoc event needing only a crew) is a service of its own: `session` is
 * then the media session (its crew where the band would be) and `crew` is null.
 */
export type Service = {
  date: string;
  group: TeamGroup;
  /** The session's team, and its slug for opening its plans (root works in one team at a time). */
  team: string;
  teamSlug: string;
  session: SessionDetail;
  /** The media crew (empty when none is published yet); null for a service without one (CM, unlinked ad hoc). */
  crew: CrewMember[] | null;
  /** Every team serving at it (the session's team, then the crew's). */
  teamIds: string[];
  /** Each of those teams' own session in it (team id -> roster session id), for its Services page. */
  sessionIdByTeam: Record<string, string>;
};

type ServiceRow = { id: string; date: string; name: string; kind: string; linkId: string | null; team: Team };

/**
 * Every service from `from` to `to` (inclusive), soonest first. With `group`, only that group's
 * teams (an observer's view, or a team's own).
 */
async function servicesBetween(viewerId: string, from: string, to: string, group?: TeamGroup): Promise<Service[]> {
  const db = createAdminClient();
  const everyTeam = await loadTeams();
  const teams = everyTeam.filter((t) => !group || t.group === group);
  if (!teams.length) return [];
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const { data } = await db
    .from("roster_sessions")
    .select("id, date, name, kind, start_time, link_id, rosters!inner(team_id, status)")
    .in("rosters.team_id", teams.map((t) => t.id))
    .eq("rosters.status", "published")
    .gte("date", from)
    .lte("date", to)
    .eq("cancelled", false)
    .order("date")
    .order("start_time", { nullsFirst: false })
    .order("name");
  const rows: ServiceRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    date: r.date as string,
    name: r.name as string,
    kind: (r.kind as string | null) ?? "custom",
    linkId: (r.link_id as string | null) ?? null,
    team: teamById.get((r.rosters as unknown as { team_id: string }).team_id)!,
  }));
  const worship = rows.filter((r) => r.team.kind === "worship");
  const media = rows.filter((r) => r.team.kind === "media");

  // Ad hoc worship sessions linked to a media team's session (published or still a draft): they
  // have a crew, even if it isn't published yet.
  const linkIds = [...new Set(worship.flatMap((w) => (w.kind === "custom" && w.linkId ? [w.linkId] : [])))];
  const { data: linkRows } = linkIds.length
    ? await db.from("roster_sessions").select("link_id, rosters!inner(team_id, status)").in("link_id", linkIds).in("rosters.status", ["published", "draft"])
    : { data: [] };
  const allTeams = new Map(everyTeam.map((t) => [t.id, t]));
  const crewedLinks = new Set(
    (linkRows ?? [])
      .filter((r) => allTeams.get((r.rosters as unknown as { team_id: string }).team_id)?.kind === "media")
      .map((r) => r.link_id as string),
  );

  // Each worship session's crew: same kind that day (standard), or linked to it (ad hoc).
  const used = new Set<string>();
  const paired = worship.map((w) => {
    const crew = media.filter((m) =>
      w.kind === "custom"
        ? Boolean(w.linkId) && m.linkId === w.linkId
        : m.kind === w.kind && m.date === w.date && m.team.group === w.team.group,
    );
    for (const m of crew) used.add(m.id);
    const hasCrew = w.kind === "custom" ? Boolean(w.linkId && crewedLinks.has(w.linkId)) : CREW_KINDS.has(w.kind);
    return { w, crew, hasCrew };
  });
  // Media sessions that crew no worship session: services of their own.
  const alone = media.filter((m) => !used.has(m.id));

  const crewIds = [...used];
  const [details, aloneDetails, { data: crewRows }] = await Promise.all([
    Promise.all(paired.map(({ w }) => sessionDetail(db, viewerId, w.id))),
    Promise.all(alone.map((m) => sessionDetail(db, viewerId, m.id))),
    crewIds.length
      ? db.from("roster_assignments").select("member_id, role, session_id").in("session_id", crewIds)
      : Promise.resolve({ data: [] as { member_id: string; role: string; session_id: string }[] }),
  ]);
  const people = await names(db, [...new Set((crewRows ?? []).map((r) => r.member_id as string))]);
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const crewOf = (sessionIds: string[]): CrewMember[] =>
    (crewRows ?? [])
      .filter((r) => sessionIds.includes(r.session_id as string))
      .map((r) => {
        const m = mediaById.get(r.session_id as string)!;
        return { id: r.member_id as string, name: people.get(r.member_id as string) ?? "Someone", role: r.role as string, team: m.team.name, session: m.name };
      });

  // In the order the sessions came (date, start time, name), but a day's ad hoc services after its
  // standard ones (they're taken to be later in the day).
  const order = new Map(
    [...rows]
      .sort((a, b) => a.date.localeCompare(b.date) || Number(a.kind === "custom") - Number(b.kind === "custom"))
      .map((r, i) => [r.id, i]),
  );
  const services: (Service & { at: number })[] = [
    ...paired.flatMap(({ w, crew, hasCrew }, i) => {
      const d = details[i];
      if (!d) return [];
      return [
        {
          at: order.get(w.id)!,
          date: w.date,
          group: w.team.group,
          team: w.team.name,
          teamSlug: w.team.slug,
          // Root can open any published plan.
          session: { ...d, plan: d.plan && { ...d.plan, canOpen: true } },
          crew: hasCrew || crew.length ? crewOf(crew.map((m) => m.id)) : null,
          teamIds: [...new Set([w.team.id, ...crew.map((m) => m.team.id)])],
          sessionIdByTeam: Object.fromEntries([...crew.map((m) => [m.team.id, m.id]), [w.team.id, w.id]]),
        },
      ];
    }),
    ...alone.flatMap((m, i) => {
      const d = aloneDetails[i];
      if (!d) return [];
      return [{ at: order.get(m.id)!, date: m.date, group: m.team.group, team: m.team.name, teamSlug: m.team.slug, session: d, crew: null, teamIds: [m.team.id], sessionIdByTeam: { [m.team.id]: m.id } }];
    }),
  ];
  services.sort((a, b) => a.at - b.at);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return services.map(({ at, ...s }) => s);
}

/**
 * Root's Services page: every team's services over the next `days` days, soonest first. An
 * observer's: only its group's (`group`).
 */
export async function loadServices(viewerId: string, days = 28, group?: TeamGroup): Promise<Service[]> {
  const today = todayYmd();
  return servicesBetween(viewerId, today, addDays(today, days - 1), group);
}

/**
 * A team's Services page: the services it serves at over the next `days` days. Its standard
 * services (with the other teams serving at them) and its own ad hoc ones, linked or not; another
 * team's ad hoc service shows only once it's linked to one of this team's.
 */
export async function loadTeamServices(viewerId: string, team: Pick<Team, "id" | "group">, days = 28): Promise<Service[]> {
  return (await loadServices(viewerId, days, team.group)).filter((s) => s.teamIds.includes(team.id));
}

/** One day of an observer's coming week: that day's services. */
export type ServiceDay = {
  date: string;
  services: Service[];
};

/**
 * An observer's home page: every day in the coming week (today and the six after) on which its
 * group has a service on a published roster, e.g. the YF Saturday service and any ad hoc events,
 * with each one's session, band and media crew (or the crew alone, for one that only has a crew).
 */
export async function loadGroupWeek(viewerId: string, group: TeamGroup): Promise<ServiceDay[]> {
  const today = todayYmd();
  const services = await servicesBetween(viewerId, today, addDays(today, 6), group);
  const dates = [...new Set(services.map((s) => s.date))].sort();
  return dates.map((date) => ({ date, services: services.filter((s) => s.date === date) }));
}

/** One group's coming service, for root's home page. */
export type ServiceOverview = {
  group: TeamGroup;
  /** The worship team (e.g. "Main Worship"); null if the group has none. */
  team: string | null;
  date: string;
  /** That day's services (e.g. EM and CM Sunday services), each with its plan, band and crew. */
  services: Service[];
};

/**
 * Root's home page: for each group, its coming service day (Main: Sunday, Youth: Saturday) and that
 * day's services. Root is on no team, so this looks across every team.
 */
export async function loadServiceOverview(viewerId: string): Promise<ServiceOverview[]> {
  const today = todayYmd();
  const [services, teams] = await Promise.all([servicesBetween(viewerId, today, addDays(today, 6)), loadTeams()]);
  return TEAM_GROUPS.map((group): ServiceOverview => {
    const date = nextWeekday(today, GROUP_SERVICE_DAY[group]);
    return {
      group,
      team: teams.find((t) => t.group === group && t.kind === "worship")?.name ?? null,
      date,
      services: services.filter((s) => s.group === group && s.date === date),
    };
  });
}

/** One team's part in a service: its session, with its band or crew. */
export type ServiceTeam = {
  team: { id: string; name: string; kind: string; slug: string };
  rosterStatus: string;
  session: SessionDetail;
};

/** A service as one of its teams' leads sees it on their Services page. */
export type ServiceDetailView = {
  date: string;
  name: string;
  kind: string;
  /** The lead's own team's session in it. */
  ownSessionId: string;
  /** Every team serving at it, the lead's own first. */
  teams: ServiceTeam[];
  /**
   * The session (songs and sequence): the worship team's plan. null when no worship team serves
   * at it (e.g. an ad hoc service needing only a crew); `plan` null when it isn't published yet.
   */
  session: { team: string; plan: PlanSection[] | null; planId: string | null; canOpen: boolean } | null;
};

/** The team whose roster a session is on (e.g. for an observer opening one of its group's services). */
export async function sessionTeam(sessionId: string): Promise<Team | null> {
  const { data } = await createAdminClient().from("roster_sessions").select("rosters!inner(team_id)").eq("id", sessionId).maybeSingle();
  const teamId = (data?.rosters as unknown as { team_id: string } | undefined)?.team_id;
  if (!teamId) return null;
  return (await loadTeams()).find((t) => t.id === teamId) ?? null;
}

/**
 * A service, from one of its teams' session (`sessionId`, on that team's published roster): every
 * team serving at it (standard: the group's sessions of the same kind that day; ad hoc: the
 * sessions linked to it, published or draft) and the worship team's published plan. Null if the
 * session isn't the team's, or isn't on a published roster.
 */
export async function loadServiceDetail(viewerId: string, team: Team, sessionId: string): Promise<ServiceDetailView | null> {
  const db = createAdminClient();
  const { data: own } = await db
    .from("roster_sessions")
    .select("id, date, name, kind, link_id, cancelled, rosters!inner(team_id, status)")
    .eq("id", sessionId)
    .maybeSingle();
  const ownRoster = own?.rosters as unknown as { team_id: string; status: string } | undefined;
  if (!own || own.cancelled || ownRoster?.team_id !== team.id || ownRoster.status !== "published") return null;
  const kind = (own.kind as string | null) ?? "custom";
  const everyTeam = await loadTeams();
  const groupTeams = everyTeam.filter((t) => t.group === team.group);
  const teamById = new Map(groupTeams.map((t) => [t.id, t]));

  // The other teams' sessions in it: by kind and date (standard), or by link (ad hoc).
  let members: { id: string; teamId: string; status: string }[] = [{ id: own.id, teamId: team.id, status: "published" }];
  if (kind !== "custom" || own.link_id) {
    let q = db
      .from("roster_sessions")
      .select("id, rosters!inner(team_id, status)")
      .in("rosters.team_id", groupTeams.map((t) => t.id))
      .eq("cancelled", false)
      .neq("id", own.id);
    q = kind === "custom" ? q.eq("link_id", own.link_id as string).in("rosters.status", ["published", "draft"]) : q.eq("date", own.date).eq("kind", kind).eq("rosters.status", "published");
    const { data } = await q;
    const others = (data ?? []).map((r) => {
      const ro = r.rosters as unknown as { team_id: string; status: string };
      return { id: r.id as string, teamId: ro.team_id, status: ro.status };
    });
    // One per team (the first, published before draft).
    const seen = new Set([team.id]);
    for (const o of others.sort((a, b) => (a.status === "published" ? 0 : 1) - (b.status === "published" ? 0 : 1))) {
      if (seen.has(o.teamId)) continue;
      seen.add(o.teamId);
      members.push(o);
    }
  }
  members = members.filter((m) => teamById.has(m.teamId));

  const details = await Promise.all(members.map((m) => sessionDetail(db, viewerId, m.id)));
  const teams: ServiceTeam[] = members.flatMap((m, i) => {
    const d = details[i];
    const t = teamById.get(m.teamId)!;
    return d ? [{ team: { id: t.id, name: t.name, kind: t.kind, slug: t.slug }, rosterStatus: m.status, session: d }] : [];
  });

  // The session: the worship team's published plan, in full (songs and their sequences).
  const worship = teams.find((t) => t.team.kind === "worship");
  let session: ServiceDetailView["session"] = null;
  if (worship) {
    const { data: ws } = await db
      .from("worship_sessions")
      .select(
        "id, worship_session_sections(id, name, position, worship_session_items(id, position, kind, song_id, lead_id, title, type, bpm, key, transpose_to, artist, sequence, custom_elements, links, notes, sheet))",
      )
      .eq("roster_session_id", worship.session.rosterSessionId)
      .eq("status", "published")
      .maybeSingle();
    session = {
      team: worship.team.name,
      plan: ws ? normalisePlan(ws.worship_session_sections) : null,
      planId: (ws?.id as string | undefined) ?? null,
      // Only the worship team's own lead opens the plan itself.
      canOpen: Boolean(ws) && worship.team.id === team.id,
    };
  }
  return { date: own.date as string, name: own.name as string, kind, ownSessionId: own.id as string, teams, session };
}
