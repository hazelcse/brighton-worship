import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { leaveOpen } from "@/lib/open-edits";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Let go of a session's editing lock. Called with navigator.sendBeacon when the editor's tab
 * closes, so the other worship leader doesn't have to wait for the lock to go stale. With the
 * unsaved edits in the body ({ plan, links }), they're kept, and Home says the session is still open
 * for editing (see lib/open-edits.ts).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  let body: { plan?: unknown; links?: unknown } | null = null;
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (body?.plan && (await leaveOpen(user, id, body.plan, body.links))) {
    revalidatePath(`/sessions/${id}`);
    revalidatePath("/home");
    return new Response(null, { status: 204 });
  }
  await createAdminClient().from("worship_sessions").update({ locked_by: null, locked_at: null }).eq("id", id).eq("locked_by", user.id);
  return new Response(null, { status: 204 });
}
