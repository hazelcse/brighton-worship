import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sessionAccess } from "@/lib/sessions";
import { loadSessionSheet } from "@/lib/session-uploads";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A songsheet a worship leader attached to a song in this session, as a PDF. Its worship leaders
 * can open it any time (while editing too); the band once it's in the published plan.
 * ?download=1 sends it as a download.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; sheetId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out. Please log in again." }, { status: 401 });
  const { id, sheetId } = await params;
  if (!UUID.test(id) || !UUID.test(sheetId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = createAdminClient();
  const { data: plan } = await db.from("worship_sessions").select("roster_session_id, status").eq("id", id).maybeSingle();
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const access = await sessionAccess(user, plan);
  let fileName = "Songsheet.pdf";
  const { data: item } = await db
    .from("worship_session_items")
    .select("title, key, sheet, worship_session_sections!inner(session_id)")
    .eq("worship_session_sections.session_id", id)
    .eq("sheet->>id", sheetId.toLowerCase())
    .limit(1)
    .maybeSingle();
  if (!access.canEdit) {
    if (!access.canView || plan.status !== "published" || !item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (item) {
    const base = (item.title as string) || ((item.sheet as { file_name?: string } | null)?.file_name ?? "Songsheet").replace(/\.(pdf|docx)$/i, "");
    fileName = `${base}${item.key ? ` (${item.key})` : ""}.pdf`;
  }

  const pdf = await loadSessionSheet(id, sheetId.toLowerCase());
  if (!pdf) return NextResponse.json({ error: "This songsheet isn't available any more. Uploaded songsheets are deleted 30 days after the session." }, { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-File-Name": encodeURIComponent(fileName),
      "Cache-Control": "private, no-store",
    },
  });
}
