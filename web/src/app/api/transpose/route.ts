import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { forwardToWorker as forward } from "@/lib/worker-proxy";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Generate a transposed songsheet (.docx). Nothing is stored.
 *   multipart form: target_key | semitones, and either song_id (library song) or file (upload)
 * Responds with the .docx, plus X-File-Name and X-Transpose-Report headers.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out. Please log in again." }, { status: 401 });
  if (!user.can("songs.transpose")) {
    return NextResponse.json({ error: "You don't have permission to transpose songsheets." }, { status: 403 });
  }

  const form = await req.formData();
  const songId = String(form.get("song_id") ?? "");
  const file = form.get("file");
  const body = new FormData();
  for (const k of ["target_key", "semitones", "from_key", "format"]) {
    const v = form.get(k);
    if (typeof v === "string" && v) body.append(k, v);
  }

  let path: string;
  if (songId) {
    if (!/^[0-9a-f-]{36}$/i.test(songId)) return NextResponse.json({ error: "Unknown song." }, { status: 400 });
    path = `/transpose/song/${songId}`;
  } else if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Songsheets must be 10 MB or smaller." }, { status: 413 });
    body.append("file", file, file.name);
    path = "/transpose/upload";
  } else {
    return NextResponse.json({ error: "Choose a song or upload a songsheet." }, { status: 400 });
  }

  return forward(path, body);
}
