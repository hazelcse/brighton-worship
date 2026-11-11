"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, requirePermission } from "@/lib/auth";
import { cleanAbsence, type AbsenceInput } from "@/lib/absence";
import { absenceClashes, releaseCoverAfterAbsence, type AbsenceClash } from "@/lib/serving";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSessionDetail, type SessionDetail } from "@/lib/sessions";

export type AbsenceResult = {
  ok: boolean;
  message: string | null;
  /** Not saved: it falls on sessions they're serving at, which need someone to cover them first. */
  clashes?: AbsenceClash[];
};

function fail(e: unknown): AbsenceResult {
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
}

/** Only the person who made an absence may change it, root included. Returns them and its current dates. */
async function requireOwner(id: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  const { data } = await createAdminClient().from("absences").select("member_id, starts_on, ends_on").eq("id", id).maybeSingle();
  if (!data) throw new Error("That absence no longer exists.");
  if (data.member_id !== user.id) throw new Error("You can only change your own absences.");
  return { user, old: { startsOn: data.starts_on as string, endsOn: data.ends_on as string } };
}

/**
 * Add or change an absence. If it falls on a session the person is serving at, confirmed or not
 * answered yet (the service or its rehearsal), nothing is saved and the clashes come back: the absence is then added together with
 * the cover requests (saveAbsenceWithCover).
 */
export async function saveAbsence(input: AbsenceInput): Promise<AbsenceResult> {
  try {
    const clean = cleanAbsence(input);
    if ("error" in clean) return { ok: false, message: clean.error };
    const { startsOn, endsOn, reason } = clean;

    const db = createAdminClient();
    const owner = input.id ? await requireOwner(input.id) : null;
    const user = owner ? owner.user : await requirePermission("roster.view");
    const clashes = await absenceClashes(user.id, startsOn, endsOn);
    if (clashes.length) return { ok: false, message: null, clashes };

    if (input.id && owner) {
      const { error } = await db
        .from("absences")
        .update({ starts_on: startsOn, ends_on: endsOn, reason, updated_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) return { ok: false, message: error.message };
      await db.from("audit_log").insert({ actor_id: user.id, action: "absence.update", target: input.id, details: { startsOn, endsOn, reason } });
      // Days it no longer covers: their cover requests come down.
      await releaseCoverAfterAbsence(user.id, owner.old);
    } else {
      const { data, error } = await db
        .from("absences")
        .insert({ member_id: user.id, starts_on: startsOn, ends_on: endsOn, reason })
        .select("id")
        .single();
      if (error) return { ok: false, message: error.message };
      await db.from("audit_log").insert({ actor_id: user.id, action: "absence.create", target: data.id, details: { startsOn, endsOn, reason } });
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout"); // the schedule, and the roster's red names for anyone away
  return { ok: true, message: null };
}

export async function deleteAbsence(id: string): Promise<AbsenceResult> {
  try {
    const { user, old } = await requireOwner(id);
    const db = createAdminClient();
    const { error } = await db.from("absences").delete().eq("id", id);
    if (error) return { ok: false, message: error.message };
    await db.from("audit_log").insert({ actor_id: user.id, action: "absence.delete", target: id });
    // They can make those days now: take down the cover requests nobody has taken yet.
    await releaseCoverAfterAbsence(user.id, old);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster", "layout"); // the schedule, and the roster's red names for anyone away
  return { ok: true, message: null };
}

/**
 * A session's details for the calendar's session panel (a rehearsal opens the session it's for).
 * null if it doesn't exist or isn't one the viewer can see.
 */
export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const user = await getCurrentUser();
  if (!user || !user.can("roster.view")) return null;
  const id = sessionId.split(":")[0]; // "<id>:rehearsal" -> the session
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return loadSessionDetail(user, id);
}
