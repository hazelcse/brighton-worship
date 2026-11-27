import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { workerFetch, type DriveDuplicate } from "@/lib/worker";

/** Song editors: the song's songsheets in the Google Drive folder, to compare (see duplicate-songsheets.tsx). */
export async function GET(_req: Request, { params }: { params: Promise<{ songId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out. Please log in again." }, { status: 401 });
  if (!user.can("songs.edit")) return NextResponse.json({ error: "Only people who can edit songs can compare songsheets." }, { status: 403 });
  const { songId } = await params;
  try {
    const { files } = await workerFetch<{ files: DriveDuplicate[] }>(`/drive/songs/${encodeURIComponent(songId)}/duplicates`, {}, 120_000);
    return NextResponse.json({ files }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Google Drive couldn't be reached." }, { status: 502 });
  }
}
