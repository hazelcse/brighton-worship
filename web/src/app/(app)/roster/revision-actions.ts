"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyRevision, createRevision, revisionOf } from "@/lib/roster-revision";

export type RevisionState = { ok: boolean; message: string | null };

function fail(e: unknown): RevisionState {
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
}

async function audit(actorId: string, action: string, target: string, details: object = {}) {
  await createAdminClient().from("audit_log").insert({ actor_id: actorId, action, target, details });
}

/**
 * Root only: start editing a published roster. The edits go into a copy; everyone keeps seeing the
 * published roster until it's republished. Opens the edit already in progress if there is one.
 */
export async function startRosterRevision(rosterId: string): Promise<RevisionState> {
  let revisionId: string;
  try {
    const user = await getCurrentUser();
    if (!user?.isLead) return { ok: false, message: "Only the lead can edit a published roster." };
    const db = createAdminClient();
    const existing = await revisionOf(rosterId, db);
    if (existing) {
      revisionId = existing;
    } else {
      revisionId = await createRevision(rosterId, user.id, db);
      await audit(user.id, "roster.revision_start", rosterId, { revisionId });
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/roster/${rosterId}`);
  redirect(`/roster/${revisionId}/generated`);
}

/**
 * Root only: the edited copy takes the published roster's place. Changes go onto the published
 * roster itself (so serve requests, session plans and covers stay attached), and everyone added,
 * taken off, given another part, or on a session that moved is told in their updates.
 */
export async function republishRoster(revisionId: string): Promise<RevisionState> {
  let publishedId: string;
  try {
    const user = await getCurrentUser();
    if (!user?.isLead) return { ok: false, message: "Only the lead can republish a roster." };
    const db = createAdminClient();
    const r = await applyRevision(revisionId, user.id, db);
    publishedId = r.publishedId;
    await audit(user.id, "roster.republish", publishedId, { revisionId, ...r.summary });
    // Re-score the published roster so its listed problems match the changes. It takes a while,
    // so it runs after the response; the roster page refreshes itself.
    const id = publishedId;
    after(async () => {
      try {
        const { workerFetch } = await import("@/lib/worker");
        // full: its baseline is now the republished line-up, so there are no "edits" to compare,
        // but hand-placed people (e.g. someone outside the session's ministry) still need flagging.
        await workerFetch(`/rosters/${id}/evaluate?full=true`, { method: "POST" }, 120_000);
      } catch {
        // The roster is republished either way; its problems are refreshed on the next check.
      }
    });
  } catch (e) {
    return fail(e);
  }
  // Rosters, calendars, session plans and the home page all read the published roster.
  revalidatePath("/", "layout");
  redirect(`/roster/${publishedId}`);
}

/**
 * Root only: undo every change in the edit so far. The edit starts again as a fresh copy of the
 * published roster, and root stays on the editing page.
 */
export async function resetRosterRevision(revisionId: string): Promise<RevisionState> {
  let freshId: string;
  try {
    const user = await getCurrentUser();
    if (!user?.isLead) return { ok: false, message: "Only the lead can edit a published roster." };
    const db = createAdminClient();
    const { data: rev } = await db.from("rosters").select("status, revision_of").eq("id", revisionId).maybeSingle();
    if (!rev || rev.status !== "revision") return { ok: false, message: "There's no edit in progress for this roster." };
    const publishedId = rev.revision_of as string;
    const { error } = await db.from("rosters").delete().eq("id", revisionId);
    if (error) throw error;
    freshId = await createRevision(publishedId, user.id, db);
    await audit(user.id, "roster.revision_reset", publishedId, { revisionId, freshId });
  } catch (e) {
    return fail(e);
  }
  redirect(`/roster/${freshId}/generated`);
}
