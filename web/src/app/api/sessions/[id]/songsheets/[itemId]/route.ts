import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sessionAccess } from "@/lib/sessions";
import { sheetKeysFor, songsheetInKey } from "@/lib/session-songsheets";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One song of a session as a PDF songsheet in the session's key (transposed and stored the first
 * time). For anyone who can see the session. ?download=1 sends it as a download. ?to=1: for a song
 * that changes key, the sheet in the key it changes to (when the first one doesn't cover it).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out. Please log in again." }, { status: 401 });
  const { id, itemId } = await params;
  if (!UUID.test(id) || !UUID.test(itemId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = createAdminClient();
  const [{ data: plan }, { data: item }] = await Promise.all([
    db.from("worship_sessions").select("roster_session_id, status").eq("id", id).maybeSingle(),
    db
      .from("worship_session_items")
      .select("id, kind, song_id, key, transpose_to, worship_session_sections!inner(session_id)")
      .eq("id", itemId)
      .eq("worship_session_sections.session_id", id)
      .maybeSingle(),
  ]);
  if (!plan || !item || item.kind !== "song" || !item.song_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const access = await sessionAccess(user, plan);
  // The band sees songsheets once the plan's published; its worship leaders, any time.
  if (!access.canEdit && !(access.canView && plan.status === "published")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const search = new URL(req.url).searchParams;
    let key = item.key as string | null;
    if (search.get("to") === "1") {
      const keys = (await sheetKeysFor([item as { id: string; song_id: string; key: string | null; transpose_to: string | null }]))[item.id];
      if (!keys || keys.length < 2) return NextResponse.json({ error: "This song's songsheet already covers its key change." }, { status: 404 });
      key = keys[1];
    }
    const sheet = await songsheetInKey(item.song_id, key);
    const download = search.has("download");
    return new Response(sheet.pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(sheet.fileName)}`,
        "X-File-Name": encodeURIComponent(sheet.fileName),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The songsheet couldn't be made." }, { status: 502 });
  }
}
