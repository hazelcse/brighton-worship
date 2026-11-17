import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABEL, todayYmd } from "@/lib/roster";
import { keyLabel } from "@/lib/session-plan";
import { BAND_COLUMNS, ROLE_TO_BAND, isSunday, type Band, type PendingSession, type ServiceRecord, type SessionRecord, type TrackedMinistry, type TrackedSong } from "@/lib/tracking";
import { loadTeams } from "@/lib/teams";
import { ROLE_CATALOGUE, ROLE_LABEL as TEAM_ROLE_LABEL } from "@/lib/team-config";

/** Session tracking data, one team's (the lead only: callers check). */

type Db = ReturnType<typeof createAdminClient>;

/**
 * Every confirmed session, plus each session marked as no session (with its reason) on a published
 * roster once its date has come, newest first.
 */
export async function loadRecords(teamId: string): Promise<SessionRecord[]> {
  const db = createAdminClient();
  const [{ data, error }, cancelled] = await Promise.all([
    db
      .from("session_records")
      .select("id, date, ministry, kind, service_name, band, songs, links, comments")
      .eq("team_id", teamId)
      .order("date", { ascending: false })
      .order("service_name"),
    cancelledRows(db, teamId),
  ]);
  if (error) throw error;
  const records: SessionRecord[] = (data ?? []).map((r) => ({
    id: r.id,
    date: r.date,
    ministry: r.ministry as TrackedMinistry,
    kind: r.kind,
    serviceName: r.service_name,
    band: (r.band as Band) ?? {},
    songs: (r.songs as TrackedSong[]) ?? [],
    links: (r.links as string[]) ?? [],
    comments: r.comments ?? "",
  }));
  const noSessions: SessionRecord[] = cancelled.map((s) => ({
    id: `no-session-${s.id}`,
    date: s.date,
    ministry: s.ministry as TrackedMinistry,
    kind: s.kind,
    serviceName: s.name,
    band: {},
    songs: [],
    links: [],
    comments: "",
    cancelReason: (s.cancel_reason as string) || "No session",
  }));
  return [...records, ...noSessions].sort((a, b) => b.date.localeCompare(a.date) || a.serviceName.localeCompare(b.serviceName));
}

/** The services that have a media crew: EM Sunday service and EM PnP (Main Media), YF Saturday (Youth Media). */
const CREW_KINDS = new Set(["em_sunday", "em_pnp", "saturday"]);

/**
 * Root's Tracking: every worship team's tracked sessions (Main and Youth), newest first, each with
 * the media crew of its group on that date (from the media team's published or archived roster).
 */
export async function loadAllServices(): Promise<ServiceRecord[]> {
  const db = createAdminClient();
  const teams = await loadTeams();
  const worship = teams.filter((t) => t.kind === "worship");
  const media = teams.filter((t) => t.kind === "media");
  const perTeam = await Promise.all(worship.map(async (t) => ({ team: t, records: await loadRecords(t.id) })));
  const all = perTeam.flatMap(({ team, records }) => records.map((r) => ({ r, team })));

  // Media crews on the dates of services that have one: "main|2026-11-22" -> role -> names.
  const crewDates = [...new Set(all.filter(({ r }) => CREW_KINDS.has(r.kind) && r.cancelReason === undefined).map(({ r }) => r.date))];
  const crew = new Map<string, Map<string, string[]>>();
  if (crewDates.length && media.length) {
    const { data: sessions } = await db
      .from("roster_sessions")
      .select("id, date, rosters!inner(team_id, status)")
      .in("rosters.team_id", media.map((t) => t.id))
      .in("rosters.status", ["published", "archived"])
      .in("date", crewDates)
      .eq("cancelled", false);
    const groupOf = new Map(media.map((t) => [t.id, t.group]));
    const keyOf = new Map(
      (sessions ?? []).map((s) => [s.id as string, `${groupOf.get((s.rosters as unknown as { team_id: string }).team_id)}|${s.date}`]),
    );
    const { data: rows } = keyOf.size
      ? await db.from("roster_assignments").select("session_id, member_id, role").in("session_id", [...keyOf.keys()])
      : { data: [] as { session_id: string; member_id: string; role: string }[] };
    const ids = [...new Set((rows ?? []).map((r) => r.member_id as string))];
    const { data: people } = ids.length
      ? await db.from("profiles").select("id, full_name, email").in("id", ids)
      : { data: [] as { id: string; full_name: string; email: string }[] };
    const name = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));
    for (const r of rows ?? []) {
      const key = keyOf.get(r.session_id as string)!;
      const byRole = crew.get(key) ?? new Map<string, string[]>();
      const who = name.get(r.member_id as string) ?? "Someone";
      const names = byRole.get(r.role as string) ?? [];
      if (!names.includes(who)) byRole.set(r.role as string, [...names, who]);
      crew.set(key, byRole);
    }
  }
  const roleOrder: string[] = ROLE_CATALOGUE.map((r) => r.value);

  return all
    .map(({ r, team }) => {
      const byRole = crew.get(`${team.group}|${r.date}`);
      return {
        ...r,
        group: team.group,
        team: team.name,
        crew: CREW_KINDS.has(r.kind)
          ? [...(byRole ?? new Map<string, string[]>()).entries()]
              .sort(([a], [b]) => roleOrder.indexOf(a) - roleOrder.indexOf(b))
              .map(([role, names]) => ({ role: TEAM_ROLE_LABEL[role] ?? role, names }))
          : null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.serviceName.localeCompare(b.serviceName));
}

/** Sessions marked as no session on published (or archived) rosters, today or earlier. */
async function cancelledRows(db: Db, teamId: string) {
  const { data: rosters } = await db.from("rosters").select("id").eq("team_id", teamId).in("status", ["published", "archived"]);
  const ids = (rosters ?? []).map((r) => r.id as string);
  if (!ids.length) return [];
  const { data, error } = await db
    .from("roster_sessions")
    .select("id, date, kind, name, ministry, cancel_reason")
    .in("roster_id", ids)
    .eq("cancelled", true)
    .lte("date", todayYmd());
  if (error) throw error;
  return data ?? [];
}

/**
 * Roster sessions that have happened (today or earlier) and aren't in tracking yet, oldest first.
 * Ones whose tracked copy was deleted (tracking_removed) stay out.
 */
async function pendingRows(db: Db, teamId: string) {
  const { data: rosters } = await db.from("rosters").select("id").eq("team_id", teamId).in("status", ["published", "archived"]);
  const ids = (rosters ?? []).map((r) => r.id as string);
  if (!ids.length) return [];
  const [{ data: sessions }, { data: done }] = await Promise.all([
    db
      .from("roster_sessions")
      .select("id, date, kind, name, ministry")
      .in("roster_id", ids)
      .eq("cancelled", false)
      .eq("tracking_removed", false)
      .lte("date", todayYmd())
      .order("date")
      .order("name"),
    db.from("session_records").select("roster_session_id").eq("team_id", teamId).not("roster_session_id", "is", null),
  ]);
  const recorded = new Set((done ?? []).map((d) => d.roster_session_id as string));
  return (sessions ?? []).filter((s) => !recorded.has(s.id));
}

export async function countPending(teamId: string): Promise<number> {
  return (await pendingRows(createAdminClient(), teamId)).length;
}

/** Brighton Serving: sessions waiting to be confirmed on every worship team. */
export async function countPendingAll(): Promise<number> {
  const db = createAdminClient();
  const teams = (await loadTeams()).filter((t) => t.kind === "worship");
  const counts = await Promise.all(teams.map((t) => pendingRows(db, t.id)));
  return counts.reduce((n, rows) => n + rows.length, 0);
}

/** Pending sessions with their band and the songs of their plan, filled in for root to check. */
export async function loadPending(teamId: string): Promise<PendingSession[]> {
  const db = createAdminClient();
  const rows = await pendingRows(db, teamId);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);

  const [{ data: assignments }, { data: plans }] = await Promise.all([
    db.from("roster_assignments").select("session_id, member_id, role").in("session_id", ids),
    db
      .from("worship_sessions")
      .select("roster_session_id, worship_session_sections(name, position, worship_session_items(position, kind, title, artist, key, transpose_to, lead_id))")
      .in("roster_session_id", ids),
  ]);

  type Item = {
    position: number;
    kind: string;
    title: string;
    artist: string | null;
    key: string | null;
    transpose_to: string | null;
    lead_id: string | null;
  };
  type Sec = { name: string; position: number; worship_session_items: Item[] };
  // Songs in plan order; each remembers whether it was in a "Closing Song" section.
  const songsOf = new Map<string, (Item & { closing: boolean })[]>();
  for (const p of plans ?? []) {
    const items = ((p.worship_session_sections ?? []) as Sec[])
      .sort((a, b) => a.position - b.position)
      .flatMap((sec) => [...sec.worship_session_items].sort((a, b) => a.position - b.position).map((i) => ({ ...i, closing: /closing/i.test(sec.name ?? "") })))
      .filter((i) => i.kind === "song" && i.title);
    songsOf.set(p.roster_session_id as string, items);
  }

  const personIds = new Set<string>([...(assignments ?? []).map((a) => a.member_id as string), ...[...songsOf.values()].flat().flatMap((i) => (i.lead_id ? [i.lead_id] : []))]);
  const { data: people } = personIds.size
    ? await db
        .from("profiles")
        .select("id, full_name, email")
        .in("id", [...personIds])
    : { data: [] as { id: string; full_name: string; email: string }[] };
  const name = new Map((people ?? []).map((p) => [p.id, (p.full_name as string) || (p.email as string)]));
  const roleOrder = Object.keys(ROLE_LABEL);

  return rows.map((r) => {
    const band: Band = {};
    const mine = (assignments ?? [])
      .filter((a) => a.session_id === r.id)
      .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || (name.get(a.member_id) ?? "").localeCompare(name.get(b.member_id) ?? ""));
    for (const a of mine) {
      const col = ROLE_TO_BAND[a.role as string];
      if (!col) continue;
      (band[col] ??= []).push(name.get(a.member_id) ?? "Someone");
    }
    // Keep the table's column order.
    const ordered: Band = Object.fromEntries(BAND_COLUMNS.filter((c) => band[c.key]).map((c) => [c.key, band[c.key]]));
    const items = songsOf.get(r.id);
    // Sunday services: main set first, then the closing song(s) for Song 5.
    const sunday = isSunday(r.kind as string);
    const planSongs = sunday ? [...(items ?? []).filter((i) => !i.closing), ...(items ?? []).filter((i) => i.closing)] : (items ?? []);
    return {
      rosterSessionId: r.id,
      date: r.date,
      ministry: r.ministry as TrackedMinistry,
      kind: r.kind,
      serviceName: r.name,
      band: ordered,
      hasPlan: songsOf.has(r.id),
      songs: planSongs.map((i) => ({
        title: i.title,
        artist: i.artist ?? "",
        key: (keyLabel(i.key, i.transpose_to) ?? "").replace("→", " -> "),
        lead: i.lead_id ? (name.get(i.lead_id) ?? "") : "",
        ...(sunday && i.closing ? { closing: true } : {}),
      })),
    };
  });
}
