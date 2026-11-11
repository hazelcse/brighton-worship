import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { forwardToWorker as forward } from "@/lib/worker-proxy";

/** Work out the key of an uploaded songsheet before transposing it. Nothing is stored. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You are signed out. Please log in again." }, { status: 401 });
  if (!user.can("songs.transpose")) {
    return NextResponse.json({ error: "You don't have permission to transpose songsheets." }, { status: 403 });
  }
  const file = (await req.formData()).get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a .docx songsheet." }, { status: 400 });
  }
  if (!/\.docx$/i.test(file.name)) {
    return NextResponse.json(
      { error: "Only .docx songsheets are supported. Open it in Word and use Save As → Word Document (.docx)." },
      { status: 400 },
    );
  }
  const body = new FormData();
  body.append("file", file, file.name);
  return forward("/analyze", body);
}
