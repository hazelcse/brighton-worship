"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { memberKinds } from "@/lib/teams";
import type { ActionResult } from "@/app/(app)/team/permissions/actions";

/** Someone on both a worship and a media team: which one they land on when they log in. */
export async function setLandingKind(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "You are signed out. Please log in again." };
  if (user.viewingAsPerson) return { ok: false, message: "Developers can't change someone else's settings." };
  const kind = formData.get("landing");
  if (kind !== "worship" && kind !== "media") return { ok: false, message: "Choose where to land." };
  const kinds = await memberKinds(user.id);
  if (!kinds.has("worship") || !kinds.has("media")) return { ok: false, message: "You're only on one kind of team." };
  const { error } = await createAdminClient().from("profiles").update({ landing_kind: kind }).eq("id", user.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}
