"use server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The landing page showed band change notices up to `upTo` (the newest one's time): they won't be
 * shown again. Only ever moves forward. No revalidate: they stay on screen for this visit.
 */
export async function markHomeBandSeen(upTo: string): Promise<void> {
  const user = await getCurrentUser();
  // A developer looking as someone else mustn't use up that person's notices.
  if (!user || user.viewingAsPerson) return;
  const at = new Date(upTo);
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 60_000) return;
  await createAdminClient().from("profiles").update({ home_band_seen_at: at.toISOString() }).eq("id", user.id).lt("home_band_seen_at", at.toISOString());
}
