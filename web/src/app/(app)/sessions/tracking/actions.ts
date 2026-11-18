"use server";

import { revalidatePath } from "next/cache";
import { requireLead, requireLeadAnywhere } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SESSION_TYPES, todayYmd, type RegularKind } from "@/lib/roster";
import { sessionInTeam } from "@/lib/sessions";
import { cleanRecordInput, type RecordInput } from "@/lib/tracking";

export type TrackingResult = { ok: boolean; message: string | null };

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

function refresh() {
  revalidatePath("/sessions/tracking");
  revalidatePath("/sessions/tracking/pending");
}

/** Root confirms a session that has happened: it joins the tracking views. */
export async function confirmSession(rosterSessionId: string, input: RecordInput): Promise<TrackingResult> {
  try {
    const user = await requireLead();
    const db = createAdminClient();
    const { data: s } = await db.from("roster_sessions").select("id, date, kind, name, ministry, cancelled").eq("id", rosterSessionId).maybeSingle();
    if (!s || s.cancelled || !(await sessionInTeam(s.id, user.team.id))) throw new Error("This session doesn't exist any more.");
    if (s.date > todayYmd()) throw new Error("This session hasn't happened yet.");
    const clean = cleanRecordInput(input, s.kind);
    const { error } = await db.from("session_records").insert({
      roster_session_id: s.id,
      team_id: user.team.id,
      date: s.date,
      ministry: s.ministry,
      kind: s.kind,
      service_name: s.name,
      band: clean.band,
      songs: clean.songs,
      links: clean.links,
      comments: clean.comments,
      confirmed_by: user.id,
      updated_by: user.id,
    });
    if (error) throw new Error(error.code === "23505" ? "This session is already in tracking." : error.message);
    refresh();
    return { ok: true, message: "Saved to tracking." };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

/**
 * Root deletes tracked sessions, for good: one that came from a roster doesn't go back to Pending
 * (its roster session is marked tracking_removed). "No session" rows come from roster setup and
 * aren't deleted here.
 */
export async function deleteRecords(ids: string[]): Promise<TrackingResult> {
  try {
    const user = await requireLeadAnywhere();
    const wanted = [...new Set(ids)].filter((id) => typeof id === "string" && !id.startsWith("no-session-"));
    if (!wanted.length) throw new Error("Nothing to delete.");
    const db = createAdminClient();
    // Only this team's records (root's Tracking shows every worship team's).
    const del = db.from("session_records").delete().in("id", wanted);
    const { data, error } = await (user.isRoot || !user.team ? del : del.eq("team_id", user.team.id)).select("id, roster_session_id");
    if (error) throw new Error(error.message);
    // Keep their roster sessions out of Pending.
    const fromRoster = (data ?? []).flatMap((r) => (r.roster_session_id ? [r.roster_session_id as string] : []));
    if (fromRoster.length) {
      const { error: mErr } = await db.from("roster_sessions").update({ tracking_removed: true }).in("id", fromRoster);
      if (mErr) throw new Error(mErr.message);
    }
    refresh();
    const n = data?.length ?? 0;
    return { ok: true, message: `Deleted ${n} session${n === 1 ? "" : "s"}.` };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

/**
 * A media lead takes sessions out of their Tracking (Services \u203a Tracking), for good: the roster
 * keeps them (marked tracking_removed). Only their own team's sessions that have happened; "no
 * session" rows aren't deleted.
 */
export async function deleteCrewRecords(ids: string[]): Promise<TrackingResult> {
  try {
    const user = await requireLead();
    if (user.team.kind !== "media") throw new Error("Only a media team's lead can do this here.");
    const wanted = [...new Set(ids)].filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
    if (!wanted.length) throw new Error("Nothing to delete.");
    const db = createAdminClient();
    const { data: rosters } = await db.from("rosters").select("id").eq("team_id", user.team.id);
    const { data, error } = await db
      .from("roster_sessions")
      .update({ tracking_removed: true })
      .in("id", wanted)
      .in("roster_id", (rosters ?? []).map((r) => r.id as string))
      .eq("cancelled", false)
      .lte("date", todayYmd())
      .select("id");
    if (error) throw new Error(error.message);
    revalidatePath("/services/tracking");
    const n = data?.length ?? 0;
    return { ok: true, message: `Deleted ${n} session${n === 1 ? "" : "s"}.` };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

/** Root corrects a tracked session. */
export async function updateRecord(id: string, input: RecordInput): Promise<TrackingResult> {
  try {
    const user = await requireLeadAnywhere();
    const db = createAdminClient();
    // Root's Tracking shows every worship team's records; a lead only edits their own team's.
    const found = db.from("session_records").select("kind, team_id").eq("id", id);
    const { data: rec } = await (user.isRoot || !user.team ? found : found.eq("team_id", user.team.id)).maybeSingle();
    if (!rec) throw new Error("This session isn't in tracking any more.");
    const clean = cleanRecordInput(input, rec.kind);
    const { data, error } = await db
      .from("session_records")
      .update({
        band: clean.band,
        songs: clean.songs,
        links: clean.links,
        comments: clean.comments,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("team_id", rec.team_id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("This session isn't in tracking any more.");
    refresh();
    return { ok: true, message: "Saved." };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

/** A session added by hand on the Pending page (not from a roster): when, which kind, and what it's called. */
export type NewSessionInput = { date: string; kind: string; ministry: "em" | "cm" | "any"; serviceName: string };

/**
 * Root adds a whole new session to tracking by hand (one that wasn't on a roster, or from before
 * the app): its date, kind and name, and the same band, songs, links and comments as any other.
 */
export async function createRecord(session: NewSessionInput, input: RecordInput): Promise<TrackingResult> {
  try {
    const user = await requireLead();
    const date = String(session.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose the session's date.");
    if (date > todayYmd()) throw new Error("Only sessions that have happened go in tracking.");
    // The team's own kinds of session, or "custom" for anything else.
    const kinds: string[] = [...user.team.config.sessionKinds, "custom"];
    const kind = kinds.includes(session.kind) ? session.kind : "custom";
    const regular = kind === "custom" ? null : SESSION_TYPES[kind as RegularKind];
    const ministry = regular ? regular.ministry : user.team.config.memberFields.ministry && (session.ministry === "em" || session.ministry === "cm") ? session.ministry : "any";
    const serviceName = String(session.serviceName ?? "").trim().replace(/\s+/g, " ") || regular?.name || "";
    if (!serviceName) throw new Error("Give the session a name.");
    const clean = cleanRecordInput(input, kind);
    const { error } = await createAdminClient().from("session_records").insert({
      team_id: user.team.id,
      date,
      ministry,
      kind,
      service_name: serviceName,
      band: clean.band,
      songs: clean.songs,
      links: clean.links,
      comments: clean.comments,
      confirmed_by: user.id,
      updated_by: user.id,
    });
    if (error) throw new Error(error.message);
    refresh();
    return { ok: true, message: "Saved to tracking." };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

/**
 * Root deletes a pending session: it leaves Pending for good without going into tracking (its
 * roster session is marked tracking_removed). The roster itself doesn't change.
 */
export async function deletePending(rosterSessionId: string): Promise<TrackingResult> {
  try {
    const user = await requireLead();
    if (!(await sessionInTeam(rosterSessionId, user.team.id))) throw new Error("This session doesn't exist any more.");
    const { error } = await createAdminClient().from("roster_sessions").update({ tracking_removed: true }).eq("id", rosterSessionId);
    if (error) throw new Error(error.message);
    refresh();
    return { ok: true, message: "Deleted." };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}
