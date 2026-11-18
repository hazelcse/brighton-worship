import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sessionAccess } from "@/lib/sessions";
import { withProjectionAccess } from "@/lib/projection";
import { cleanSheet, majorKey } from "@/lib/session-plan";
import { loadSessionSheet } from "@/lib/session-uploads";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A songsheet a worship leader attached to a song in this session, as a PDF. Its worship leaders
 * can open it any time (while editing too); the band once it's in the published plan.
 * ?download=1 sends it as a download.
 *
 * A Word sheet is shown transposed to the song's key: ?key= (the key in the page, which while
 * editing may not be saved yet) and ?from= (the key it's written in). Without them, the saved song's.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; sheetId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out. Please log in again." }, { status: 401 });
  const { id, sheetId } = await params;
  if (!UUID.test(id) || !UUID.test(sheetId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = createAdminClient();
  const { data: plan } = await db.from("worship_sessions").select("roster_session_id, status").eq("id", id).maybeSingle();
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Media teams read the plans on their Projection page too.
  const access = await withProjectionAccess(user, id, plan, await sessionAccess(user, plan));
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

  const url = new URL(req.url);
  const saved = item ? cleanSheet(item.sheet) : null;
  // The sheet as saved, or (an editor's unsaved one) as the page describes it.
  const sheet = saved ?? {
    id: sheetId.toLowerCase(),
    file_name: "Songsheet.docx",
    format: "docx" as const,
    key: majorKey(url.searchParams.get("from")),
    transposable: true,
  };
  if (url.searchParams.has("from") && access.canEdit) sheet.key = majorKey(url.searchParams.get("from")) ?? sheet.key;
  const songKey = majorKey(url.searchParams.get("key")) ?? majorKey(item?.key as string | null);
  const shownKey = sheet.transposable && songKey ? songKey : (sheet.key ?? null);

  let pdf: Blob | null;
  try {
    pdf = await loadSessionSheet(id, sheet, songKey);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "This songsheet couldn't be transposed." }, { status: 502 });
  }
  if (!pdf) return NextResponse.json({ error: "This songsheet isn't available any more. Uploaded songsheets are deleted 30 days after the session." }, { status: 404 });

  const base = (item?.title as string) || (saved?.file_name ?? "Songsheet").replace(/\.(pdf|docx)$/i, "");
  const fileName = `${base}${shownKey ? ` (${shownKey})` : ""}.pdf`;
  const download = url.searchParams.has("download");
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-File-Name": encodeURIComponent(fileName),
      "Cache-Control": "private, no-store",
    },
  });
}
