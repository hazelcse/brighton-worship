import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

/** Song editors: one of the song's Google Drive songsheets as a PDF, to compare (not stored). */
export async function GET(_req: Request, { params }: { params: Promise<{ songId: string; fileId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out. Please log in again." }, { status: 401 });
  if (!user.can("songs.edit")) return NextResponse.json({ error: "Only people who can edit songs can compare songsheets." }, { status: 403 });
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!url || !token) return NextResponse.json({ error: "The songsheet worker isn't configured." }, { status: 500 });

  const { songId, fileId } = await params;
  let res: Response;
  try {
    res = await fetch(`${url}/drive/songs/${encodeURIComponent(songId)}/files/${encodeURIComponent(fileId)}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "The songsheet scanner isn't reachable right now. Please try again in a minute." }, { status: 503 });
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { detail?: string } | null;
    return NextResponse.json({ error: err?.detail ?? "This songsheet couldn't be shown." }, { status: res.status });
  }
  const name = res.headers.get("x-file-name");
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
      ...(name ? { "X-File-Name": name, "Content-Disposition": `inline; filename*=UTF-8''${name}` } : {}),
    },
  });
}
