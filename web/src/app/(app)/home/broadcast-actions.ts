"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, requireRoot } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type BroadcastResult = { ok: boolean; message: string | null };

const fail = (e: unknown): BroadcastResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong." });

function refresh() {
  revalidatePath("/home");
  revalidatePath("/roster");
}

/** Root: send a message to the whole team's landing page. */
export async function createBroadcast(input: { title: string; message: string; requiresAck: boolean; ackMessage: string }): Promise<BroadcastResult> {
  try {
    const user = await requireRoot();
    const title = input.title.trim();
    const message = input.message.trim();
    const ackMessage = input.requiresAck ? input.ackMessage.trim() : "";
    if (!title) return { ok: false, message: "Give it a title." };
    if (!message) return { ok: false, message: "Write a message." };
    if (title.length > 200) return { ok: false, message: "Keep the title under 200 characters." };
    if (message.length > 5000 || ackMessage.length > 2000) return { ok: false, message: "That's too long." };
    if (input.requiresAck && !ackMessage) return { ok: false, message: "Write what people are acknowledging." };

    const db = createAdminClient();
    const { data, error } = await db
      .from("broadcasts")
      .insert({ title, message, requires_ack: input.requiresAck, ack_message: input.requiresAck ? ackMessage : null, created_by: user.id })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await db.from("audit_log").insert({ actor_id: user.id, action: "broadcast.create", target: data.id, details: { title, requiresAck: input.requiresAck } });
    refresh();
    return { ok: true, message: input.requiresAck ? "Sent. Acknowledgements show under Actionables." : "Sent to the whole team." };
  } catch (e) {
    return fail(e);
  }
}

/** Close a broadcast on your landing page: dismissing it, or ticking the acknowledgement. */
export async function respondToBroadcast(id: string, acknowledge: boolean): Promise<BroadcastResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, message: "You are signed out. Please log in again." };
    const db = createAdminClient();
    const { data: b } = await db.from("broadcasts").select("id, requires_ack").eq("id", id).maybeSingle();
    if (!b) {
      refresh();
      return { ok: true, message: null }; // deleted in the meantime
    }
    if (b.requires_ack && !acknowledge) return { ok: false, message: "Tick the acknowledgement to close this one." };
    const { error } = await db
      .from("broadcast_responses")
      .upsert({ broadcast_id: id, member_id: user.id }, { onConflict: "broadcast_id,member_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    if (b.requires_ack) await db.from("audit_log").insert({ actor_id: user.id, action: "broadcast.acknowledge", target: id });
    refresh();
    return { ok: true, message: null };
  } catch (e) {
    return fail(e);
  }
}

/** Root: take a broadcast down for everyone. */
export async function deleteBroadcast(id: string): Promise<BroadcastResult> {
  try {
    const user = await requireRoot();
    const db = createAdminClient();
    const { data, error } = await db.from("broadcasts").delete().eq("id", id).select("title").maybeSingle();
    if (error) throw new Error(error.message);
    if (data) await db.from("audit_log").insert({ actor_id: user.id, action: "broadcast.delete", target: id, details: { title: data.title } });
    refresh();
    return { ok: true, message: null };
  } catch (e) {
    return fail(e);
  }
}
