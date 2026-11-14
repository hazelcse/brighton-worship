import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanSheet, majorKey, type SheetScan, type SongType, type UploadedSheet } from "@/lib/session-plan";
import { workerFetch } from "@/lib/worker";

/**
 * Songsheets a worship leader attaches to one session's song themselves (PDF or .docx), instead of
 * a song from the bank. They stay with the session: not added to the library, and removed once
 * nothing in the session uses them (see sweepSessionUploads), and all of them 30 days after the
 * session's date (purgeExpiredUploads).
 *
 * Stored in the private songsheets bucket as session-uploads/<session id>/<sheet id>.pdf. A .docx
 * is turned into a PDF by the worker when it's attached (and scanned to fill in the details), so the
 * band always gets a PDF, the same as for bank songs.
 */

const BUCKET = "songsheets";
const folder = (sessionId: string) => `session-uploads/${sessionId}`;
export const sheetPath = (sessionId: string, sheetId: string) => `${folder(sessionId)}/${sheetId}.pdf`;

/** Files attached this recently are never swept: they may be in an editor's unsaved edits. */
const GRACE_MS = 30 * 60_000;

type WorkerSheet = {
  title: string | null;
  artist: string | null;
  key: string | null;
  bpm: number | null;
  type: string | null;
  sections: string[];
  sequence: string[];
  youtube_links: string[];
  pdf_base64: string;
};

const TYPES: SongType[] = ["praise", "worship", "praise_worship"];

/**
 * Store a worship leader's songsheet for a session. A PDF is kept as it is (not scanned); a .docx
 * is scanned and converted. Throws with a message fit to show.
 */
export async function storeSessionSheet(sessionId: string, file: File): Promise<{ sheet: UploadedSheet; scan: SheetScan | null }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = /\.pdf$/i.test(file.name);
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  let pdf: Uint8Array;
  let scan: SheetScan | null = null;
  let extra: Pick<UploadedSheet, "sections" | "sequence"> = {};

  if (isPdf) {
    if (head !== "%PDF-") throw new Error("This doesn't look like a PDF. Try exporting it as a PDF again.");
    pdf = bytes;
  } else {
    if (head.slice(0, 2) !== "PK") throw new Error("This doesn't look like a Word (.docx) file. Open it in Word and Save As .docx or PDF.");
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: file.type || "application/octet-stream" }), file.name);
    let r: WorkerSheet;
    try {
      r = await workerFetch<WorkerSheet>("/session-sheet", { method: "POST", body }, 120_000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // An older worker image without this endpoint.
      if (/\(404\)|Not Found/i.test(msg)) throw new Error("The songsheet worker needs updating to read Word files. Upload a PDF for now.");
      throw e;
    }
    pdf = Uint8Array.from(Buffer.from(r.pdf_base64, "base64"));
    scan = {
      title: r.title,
      artist: r.artist,
      key: majorKey(r.key),
      bpm: typeof r.bpm === "number" && r.bpm > 0 ? r.bpm : null,
      type: TYPES.includes(r.type as SongType) ? (r.type as SongType) : null,
      sequence: r.sequence ?? [],
      youtube_links: (r.youtube_links ?? []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 5),
    };
    extra = { sections: r.sections ?? [], sequence: r.sequence ?? [] };
  }

  const sheet = cleanSheet({ id: crypto.randomUUID(), file_name: file.name, format: isPdf ? "pdf" : "docx", ...extra })!;
  const { error } = await createAdminClient()
    .storage.from(BUCKET)
    .upload(sheetPath(sessionId, sheet.id), pdf, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error("The songsheet couldn't be saved. Please try again.");
  return { sheet, scan };
}

/** An attached songsheet as a PDF, or null if it's gone. */
export async function loadSessionSheet(sessionId: string, sheetId: string): Promise<Blob | null> {
  const { data } = await createAdminClient().storage.from(BUCKET).download(sheetPath(sessionId, sheetId));
  return data ?? null;
}

/** Every attached songsheet id in a stored plan (tables, a revision, or open edits). */
function sheetIds(plan: unknown, out: Set<string>) {
  type Sec = { items?: { sheet?: unknown }[]; worship_session_items?: { sheet?: unknown }[] };
  for (const sec of (Array.isArray(plan) ? plan : []) as Sec[]) {
    for (const i of sec.worship_session_items ?? sec.items ?? []) {
      const s = cleanSheet(i.sheet);
      if (s) out.add(s.id);
    }
  }
}

/**
 * Remove a session's attached songsheets that nothing uses any more: not the plan, its revision,
 * or anyone's edits left open. Recent ones are kept (they may be in unsaved edits). Never throws.
 */
export async function sweepSessionUploads(sessionId: string): Promise<void> {
  try {
    const db = createAdminClient();
    const store = db.storage.from(BUCKET);
    const { data: files } = await store.list(folder(sessionId), { limit: 1000 });
    if (!files?.length) return;
    const [{ data: s }, { data: open }] = await Promise.all([
      db.from("worship_sessions").select("draft_plan, worship_session_sections(worship_session_items(sheet))").eq("id", sessionId).maybeSingle(),
      db.from("worship_session_open_edits").select("plan").eq("session_id", sessionId),
    ]);
    const used = new Set<string>();
    if (s) {
      sheetIds(s.worship_session_sections, used);
      sheetIds(s.draft_plan, used);
    }
    for (const e of open ?? []) sheetIds(e.plan, used);
    const cutoff = Date.now() - GRACE_MS;
    const stale = files
      .filter((f) => !used.has(f.name.replace(/\.pdf$/i, "")))
      .filter((f) => !f.created_at || new Date(f.created_at).getTime() < cutoff)
      .map((f) => `${folder(sessionId)}/${f.name}`);
    if (stale.length) await store.remove(stale);
    await purgeExpiredUploads();
  } catch (e) {
    console.warn(`Session ${sessionId}: couldn't tidy attached songsheets:`, e);
  }
}

/** Attached songsheets are deleted this many days after their session's date. */
export const UPLOAD_KEEP_DAYS = 30;
/** How often one server checks for expired ones (it runs in the background of ordinary requests). */
const PURGE_EVERY_MS = 60 * 60_000;
let lastPurge = 0;

/**
 * Delete the attached songsheets of every session whose date was more than UPLOAD_KEEP_DAYS ago
 * (or that no longer exists). At most once an hour per server; never throws. The plans keep their
 * reference, and opening the sheet then says it's been removed.
 */
export async function purgeExpiredUploads({ force = false }: { force?: boolean } = {}): Promise<number> {
  if (!force && Date.now() - lastPurge < PURGE_EVERY_MS) return 0;
  lastPurge = Date.now();
  try {
    const db = createAdminClient();
    const store = db.storage.from(BUCKET);
    const { data: folders } = await store.list("session-uploads", { limit: 1000 });
    const ids = (folders ?? []).map((f) => f.name).filter((n) => /^[0-9a-f-]{36}$/i.test(n));
    if (!ids.length) return 0;
    const { data: sessions } = await db.from("worship_sessions").select("id, date").in("id", ids);
    const cutoff = new Date(Date.now() - UPLOAD_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    const dates = new Map((sessions ?? []).map((s) => [s.id as string, s.date as string]));
    let removed = 0;
    for (const id of ids) {
      const date = dates.get(id);
      if (date && date >= cutoff) continue;
      const { data: files } = await store.list(folder(id), { limit: 1000 });
      const paths = (files ?? []).map((f) => `${folder(id)}/${f.name}`);
      if (paths.length) {
        await store.remove(paths);
        removed += paths.length;
      }
    }
    return removed;
  } catch (e) {
    console.warn("Couldn't delete expired session songsheets:", e);
    return 0;
  }
}
