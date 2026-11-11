import "server-only";
import { NextResponse } from "next/server";

/** Send a multipart request to the songsheet worker and stream its response back (files or JSON). */
export async function forwardToWorker(path: string, body: FormData) {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!url || !token) return NextResponse.json({ error: "The songsheet worker isn't configured." }, { status: 500 });
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: "POST",
      body,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "The transposer isn't reachable right now. Please try again in a minute." }, { status: 503 });
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { detail?: string } | null;
    return NextResponse.json({ error: err?.detail ?? "The transposer couldn't process this songsheet." }, { status: res.status });
  }
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  for (const h of ["content-type", "content-disposition", "x-file-name", "x-transpose-report"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Songsheets are small (tens of KB): buffer rather than piping the worker's stream through.
  return new Response(await res.arrayBuffer(), { headers });
}
