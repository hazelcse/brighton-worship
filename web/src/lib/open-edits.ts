import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalisePlan, sessionAccess, sessionLinks } from "@/lib/sessions";
import type { PlanLink, PlanSection } from "@/lib/session-plan";

/**
 * Sessions a worship leader left while still in edit mode (worship_session_open_edits). Their
 * unsaved edits wait here, the lock is let go, and Home says the session is still open for editing
 * until they go back and save (the floppy disk) or stop editing (the ×).
 */

/** Biggest plan + links kept (as JSON). A real plan is a few kB. */
const MAX_BYTES = 400_000;

/**
 * They've left the builder mid-edit: keep the edits and let go of the lock. Only while the lock is
 * still theirs: if someone else has it now, the edits were already dropped (and they were told).
 */
export async function leaveOpen(user: CurrentUser, id: string, plan: unknown, links: unknown): Promise<boolean> {
  if (!Array.isArray(plan) || JSON.stringify([plan, links ?? []]).length > MAX_BYTES) return false;
  const db = createAdminClient();
  const { data: row } = await db.from("worship_sessions").select("id, roster_session_id, status, locked_by").eq("id", id).maybeSingle();
  if (!row || row.locked_by !== user.id) return false;
  if (!(await sessionAccess(user, row)).canEdit) return false;
  const { error } = await db
    .from("worship_session_open_edits")
    .upsert(
      { session_id: id, member_id: user.id, plan, links: Array.isArray(links) ? links : [], left_at: new Date().toISOString() },
      { onConflict: "session_id,member_id" },
    );
  if (error) return false;
  await db.from("worship_sessions").update({ locked_by: null, locked_at: null }).eq("id", id).eq("locked_by", user.id);
  return true;
}

/** Saved or stopped editing: the session isn't open for editing any more. */
export async function clearOpenEdit(userId: string, id: string): Promise<void> {
  await createAdminClient().from("worship_session_open_edits").delete().eq("session_id", id).eq("member_id", userId);
}

export type OpenEdit = {
  plan: PlanSection[];
  links: PlanLink[];
  leftAt: string;
  /** Someone saved or published this session after they left, so saving these edits replaces that. */
  changedSince: boolean;
};

/** The edits this person left open on this session, if any. */
export async function loadOpenEdit(userId: string, id: string): Promise<OpenEdit | null> {
  const db = createAdminClient();
  const [{ data: e }, { data: s }] = await Promise.all([
    db.from("worship_session_open_edits").select("plan, links, left_at").eq("session_id", id).eq("member_id", userId).maybeSingle(),
    db.from("worship_sessions").select("updated_at, draft_updated_at, published_at").eq("id", id).maybeSingle(),
  ]);
  if (!e) return null;
  const left = new Date(e.left_at as string).getTime();
  const after = (t: unknown) => typeof t === "string" && new Date(t).getTime() > left;
  return {
    plan: normalisePlan(e.plan),
    links: sessionLinks(e.links),
    leftAt: e.left_at as string,
    changedSince: Boolean(s) && (after(s!.updated_at) || after(s!.draft_updated_at) || after(s!.published_at)),
  };
}

/** For Home: every session this person left open for editing, soonest first. */
export async function loadMyOpenEdits(userId: string): Promise<{ id: string; name: string; date: string }[]> {
  const { data } = await createAdminClient()
    .from("worship_session_open_edits")
    .select("session_id, worship_sessions(service_name, date)")
    .eq("member_id", userId);
  return (data ?? [])
    .map((r) => {
      const s = r.worship_sessions as unknown as { service_name: string; date: string } | null;
      return s ? { id: r.session_id as string, name: s.service_name, date: s.date } : null;
    })
    .filter((x): x is { id: string; name: string; date: string } => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}
