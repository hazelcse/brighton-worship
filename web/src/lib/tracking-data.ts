import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABEL, todayYmd } from "@/lib/roster";
import { keyLabel } from "@/lib/session-plan";
import { BAND_COLUMNS, ROLE_TO_BAND, isSunday, type Band, type PendingSession, type SessionRecord, type TrackedMinistry, type TrackedSong } from "@/lib/tracking";

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
