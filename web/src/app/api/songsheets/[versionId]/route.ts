import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Download a songsheet (the .docx copy) with its original file name. */
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!user.can("songs.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { versionId } = await params;
  const db = createAdminClient();
  const { data: v } = await db
    .from("song_versions")
    .select("file_name, original_path, docx_path")
    .eq("id", versionId)
    .maybeSingle();
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: blob, error } = await db.storage.from("songsheets").download(v.docx_path ?? v.original_path);
  if (error || !blob) return NextResponse.json({ error: "Couldn't load the file" }, { status: 500 });

  const name = v.file_name.replace(/\.doc$/i, ".docx");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new Response(blob, {
    headers: {
      "Content-Type": DOCX,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
