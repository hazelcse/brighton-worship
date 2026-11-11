"use server";

import { revalidatePath } from "next/cache";
import { requireRoot } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayYmd } from "@/lib/roster";
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
    const user = await requireRoot();
    const db = createAdminClient();
    const { data: s } = await db.from("roster_sessions").select("id, date, kind, name, ministry, cancelled").eq("id", rosterSessionId).maybeSingle();
    if (!s || s.cancelled) throw new Error("This session doesn't exist any more.");
    if (s.date > todayYmd()) throw new Error("This session hasn't happened yet.");
    const clean = cleanRecordInput(input, s.kind);
    const { error } = await db.from("session_records").insert({
      roster_session_id: s.id,
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
 * Root deletes tracked sessions. A deleted session that came from a roster goes back to Pending,
 * so it can be confirmed again. "No session" rows come from roster setup and aren't deleted here.
 */
export async function deleteRecords(ids: string[]): Promise<TrackingResult> {
  try {
    await requireRoot();
    const wanted = [...new Set(ids)].filter((id) => typeof id === "string" && !id.startsWith("no-session-"));
    if (!wanted.length) throw new Error("Nothing to delete.");
    const db = createAdminClient();
    const { data, error } = await db.from("session_records").delete().in("id", wanted).select("id");
    if (error) throw new Error(error.message);
    refresh();
    const n = data?.length ?? 0;
    return { ok: true, message: `Deleted ${n} session${n === 1 ? "" : "s"}.` };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

/** Root corrects a tracked session. */
export async function updateRecord(id: string, input: RecordInput): Promise<TrackingResult> {
  try {
    const user = await requireRoot();
    const db = createAdminClient();
    const { data: rec } = await db.from("session_records").select("kind").eq("id", id).maybeSingle();
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
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("This session isn't in tracking any more.");
    refresh();
    return { ok: true, message: "Saved." };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}
