import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Let go of a session's editing lock. Called with navigator.sendBeacon when the editor's tab
 * closes, so the other worship leader doesn't have to wait for the lock to go stale.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  await createAdminClient().from("worship_sessions").update({ locked_by: null, locked_at: null }).eq("id", id).eq("locked_by", user.id);
  return new Response(null, { status: 204 });
}
