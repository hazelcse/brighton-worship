import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { workerFetch } from "@/lib/worker";

/** How many preview pages a songsheet has. Makes the preview first if it doesn't exist yet. */
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!user.can("songs.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { versionId } = await params;
  const { data: v } = await createAdminClient()
    .from("song_versions")
    .select("preview_pages")
    .eq("id", versionId)
    .maybeSingle();
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (v.preview_pages) return NextResponse.json({ pages: v.preview_pages });

  try {
    const r = await workerFetch<{ pages: number; error?: string }>(`/versions/${versionId}/preview`, { method: "POST" }, 120_000);
    if (!r.pages) return NextResponse.json({ error: "A preview couldn't be made for this songsheet." }, { status: 500 });
    return NextResponse.json({ pages: r.pages });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Preview failed." }, { status: 503 });
  }
}
