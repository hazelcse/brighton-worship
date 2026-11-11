import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * One preview page as a PNG (/preview/1, /preview/2, ...) or the whole sheet as a PDF (/preview/pdf).
 * Previews never change for a given songsheet (a replaced sheet gets a new id), so they can be cached.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string; page: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!user.can("songs.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { versionId, page } = await params;
  const isPdf = page === "pdf";
  const n = Number(page);
  if (!isPdf && !(Number.isInteger(n) && n >= 1 && n <= 20)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = createAdminClient();
  const { data: v } = await db
    .from("song_versions")
    .select("file_sha256, file_name, preview_pages")
    .eq("id", versionId)
    .maybeSingle();
  if (!v || !v.preview_pages || (!isPdf && n > v.preview_pages)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const path = `previews/${v.file_sha256}/${isPdf ? "sheet.pdf" : `${n}.png`}`;
  const { data: blob, error } = await db.storage.from("songsheets").download(path);
  if (error || !blob) return NextResponse.json({ error: "Couldn't load the preview" }, { status: 500 });

  const headers: Record<string, string> = {
    "Content-Type": isPdf ? "application/pdf" : "image/png",
    "Cache-Control": "private, max-age=604800, immutable",
  };
  if (isPdf) {
    const name = v.file_name.replace(/\.docx$/i, ".pdf");
    headers["Content-Disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(name)}`;
  }
  return new Response(blob, { headers });
}
