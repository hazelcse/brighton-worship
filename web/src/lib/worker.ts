import "server-only";

/** Calls the songsheet worker (worker/), which stores, converts and scans songsheets. */
export async function workerFetch<T>(path: string, init: RequestInit = {}, timeoutMs = 90_000): Promise<T> {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!url || !token) throw new Error("The songsheet worker isn't configured (WORKER_URL / WORKER_TOKEN).");

  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new Error("The songsheet scanner isn't reachable right now. Please try again in a minute.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `The songsheet scanner returned an error (${res.status}).`);
  }
  return (await res.json()) as T;
}

export type UploadResult = {
  file_name: string;
  version_id?: string;
  song_id?: string | null;
  status: "done" | "failed" | "duplicate" | "exists";
  title?: string | null;
  key?: string | null;
  issues?: { code: string; severity: "error" | "warning" | "info"; message: string }[];
  error?: string;
  /** After replacing a songsheet: whether Google Drive got the new file too. */
  drive?: { status: "updated" | "not_in_drive" | "not_configured" | "failed"; message: string };
};
