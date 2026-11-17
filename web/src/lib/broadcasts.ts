import "server-only";
import { teamMemberIds } from "@/lib/teams";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth";

/**
 * Broadcasts: root's messages to the whole team (active members, not developers), shown on
 * everyone's landing page until they dismiss it, or tick the acknowledgement when one is required.
 * The person who sent it isn't counted as a recipient.
 */
export type Broadcast = {
  id: string;
  title: string;
  message: string;
  requiresAck: boolean;
  ackMessage: string | null;
  createdAt: string;
  createdBy: string | null;
};

type Row = {
  id: string;
  title: string;
  message: string;
  requires_ack: boolean;
  ack_message: string | null;
  created_at: string;
  created_by: string | null;
};

const SELECT = "id, title, message, requires_ack, ack_message, created_at, created_by";

const toBroadcast = (r: Row): Broadcast => ({
  id: r.id,
  title: r.title,
  message: r.message,
  requiresAck: r.requires_ack,
  ackMessage: r.ack_message,
  createdAt: r.created_at,
  createdBy: r.created_by,
});

/** The signed-in team's broadcasts still waiting on this person, newest first. */
export async function loadMyBroadcasts(user: CurrentUser): Promise<Broadcast[]> {
  // Developers aren't on the team (unless they're viewing as someone).
  if (user.isDeveloper && !user.viewingAsPerson) return [];
  const db = createAdminClient();
  const [{ data: rows, error }, { data: done }] = await Promise.all([
    db.from("broadcasts").select(SELECT).eq("team_id", user.team.id).order("created_at", { ascending: false }),
    db.from("broadcast_responses").select("broadcast_id").eq("member_id", user.id),
  ]);
  if (error) throw new Error(error.message);
  const answered = new Set((done ?? []).map((d) => d.broadcast_id as string));
  return ((rows ?? []) as Row[]).filter((r) => r.created_by !== user.id && !answered.has(r.id)).map(toBroadcast);
}

export type AckPerson = { id: string; name: string; at: string | null };
export type BroadcastStatus = Broadcast & { acknowledged: AckPerson[]; pending: AckPerson[]; total: number };

/** The lead: the team's broadcasts that need acknowledging, with who on the team has and who hasn't. */
export async function loadBroadcastActionables(teamId: string): Promise<BroadcastStatus[]> {
  const db = createAdminClient();
  const memberIds = await teamMemberIds(teamId);
  const [{ data: rows, error }, { data: people }] = await Promise.all([
    db.from("broadcasts").select(SELECT).eq("team_id", teamId).eq("requires_ack", true).order("created_at", { ascending: false }),
    db.from("profiles").select("id, full_name, email").in("id", memberIds).eq("is_active", true).eq("is_developer", false).order("full_name"),
  ]);
  if (error) throw new Error(error.message);
  const list = (rows ?? []) as Row[];
  if (!list.length) return [];
  const { data: responses } = await db
    .from("broadcast_responses")
    .select("broadcast_id, member_id, responded_at")
    .in(
      "broadcast_id",
      list.map((r) => r.id),
    );
  const at = new Map((responses ?? []).map((r) => [`${r.broadcast_id}:${r.member_id}`, r.responded_at as string]));
  return list.map((r) => {
    const team = (people ?? []).filter((p) => p.id !== r.created_by);
    const all = team.map((p) => ({ id: p.id as string, name: (p.full_name as string) || (p.email as string), at: at.get(`${r.id}:${p.id}`) ?? null }));
    return {
      ...toBroadcast(r),
      acknowledged: all.filter((p) => p.at).sort((a, b) => a.at!.localeCompare(b.at!)),
      pending: all.filter((p) => !p.at),
      total: all.length,
    };
  });
}
