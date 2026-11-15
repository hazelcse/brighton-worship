import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanSheet, majorKey, semitonesBetween, sheetIntervals, type SheetScan, type SongType, type UploadedSheet } from "@/lib/session-plan";
import { workerFetch } from "@/lib/worker";

/**
 * Songsheets a worship leader attaches to one session's song themselves (PDF or .docx), instead of
 * a song from the bank. They stay with the session: not added to the library, and removed once
 * nothing in the session uses them (see sweepSessionUploads), and all of them 30 days after the
 * session's date (purgeExpiredUploads).
 *
 * Stored in the private songsheets bucket as session-uploads/<session id>/<sheet id>.pdf. A .docx
 * is turned into a PDF by the worker when it's attached (and scanned to fill in the details), so the
 * band always gets a PDF, the same as for bank songs. Its original is kept as <sheet id>.docx, so it
 * can be shown transposed to the song's key (<sheet id>.<key>.pdf, made when first opened).
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
  /** The sheet's key, or its key changes ("E→F#"). */
  key_display?: string | null;
  pdf_base64: string;
};

const TYPES: SongType[] = ["praise", "worship", "praise_worship"];

/** The key the worker reads from a .docx songsheet, before it's attached (nothing is stored). */
export async function readSheetKey(file: File): Promise<string | null> {
  const body = new FormData();
  body.append("file", file, file.name);
  const r = await workerFetch<{ key: string | null }>("/analyze", { method: "POST", body }, 60_000);
  return majorKey(r.key);
}

/**
 * Store a worship leader's songsheet for a session. A PDF is kept as it is (not scanned); a .docx
 * is scanned and converted. Throws with a message fit to show.
 *
 * fromKey: the key the worship leader says the sheet is written in (a PDF's, or a .docx's when the
 * scanner read it wrong: theirs wins). A .docx's original is kept too, so it can be shown
 * transposed to the song's key (see loadSessionSheet).
 */
export async function storeSessionSheet(sessionId: string, file: File, fromKey: string | null = null): Promise<{ sheet: UploadedSheet; scan: SheetScan | null }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = /\.pdf$/i.test(file.name);
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  let pdf: Uint8Array;
  let scan: SheetScan | null = null;
  let extra: Pick<UploadedSheet, "key" | "transposable" | "changes" | "sections" | "sequence"> = { key: majorKey(fromKey) };

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
    // Key changes written in the sheet ("E→F#"): the first one is the song's key change, and
    // transposing keeps them all, so the sheet covers a song changing key by any of them.
    const written = (r.key_display ?? "").split(/\s*(?:→|->|-|–|—|,|\/)\s*/).filter((k) => majorKey(k));
    if (written.length > 1) scan.key_change = semitonesBetween(written[0], written[1]) || null;
    // Their key wins over the scanner's.
    extra = {
      key: majorKey(fromKey) ?? scan.key,
      transposable: true,
      changes: sheetIntervals(r.key_display, [r.key ?? ""], []),
      sections: r.sections ?? [],
      sequence: r.sequence ?? [],
    };
  }

  const sheet = cleanSheet({ id: crypto.randomUUID(), file_name: file.name, format: isPdf ? "pdf" : "docx", ...extra })!;
  const store = createAdminClient().storage.from(BUCKET);
  const { error } = await store.upload(sheetPath(sessionId, sheet.id), pdf, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error("The songsheet couldn't be saved. Please try again.");
  if (!isPdf) {
    // The original, to transpose from. Without it the sheet just isn't transposed.
    const { error: docErr } = await store.upload(`${folder(sessionId)}/${sheet.id}.docx`, bytes, { contentType: DOCX_MIME, upsert: true });
    if (docErr) delete sheet.transposable;
  }
  return { sheet, scan };
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * An attached songsheet as a PDF, or null if it's gone. For a Word sheet with its original kept,
 * `key` (the song's key) other than the key it's written in gives it transposed to that key: made
 * by the worker the first time and kept next to it (<sheet id>.<key>.pdf). Throws with a message
 * fit to show if transposing fails.
 */
export async function loadSessionSheet(sessionId: string, sheet: UploadedSheet, key: string | null = null): Promise<Blob | null> {
  const store = createAdminClient().storage.from(BUCKET);
  const target = majorKey(key);
  if (sheet.transposable && sheet.key && target && target !== majorKey(sheet.key)) {
    const path = `${folder(sessionId)}/${sheet.id}.${target.replace("#", "sharp")}.pdf`;
    const { data: cached } = await store.download(path);
    if (cached) return cached;
    const { data: original } = await store.download(`${folder(sessionId)}/${sheet.id}.docx`);
    if (original) {
      const body = new FormData();
      body.append("file", new Blob([original], { type: DOCX_MIME }), sheet.file_name);
      body.append("from_key", sheet.key);
      body.append("target_key", target);
      body.append("format", "pdf");
      const bytes = await workerFile("/transpose/upload", body);
      await store.upload(path, bytes, { contentType: "application/pdf", upsert: true });
      return new Blob([bytes], { type: "application/pdf" });
    }
  }
  const { data } = await store.download(sheetPath(sessionId, sheet.id));
  return data ?? null;
}

/** A file from the worker (workerFetch is for JSON). */
async function workerFile(path: string, body: FormData): Promise<ArrayBuffer> {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!url || !token) throw new Error("The songsheet worker isn't configured.");
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, { method: "POST", body, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(90_000), cache: "no-store" });
  } catch {
    throw new Error("The transposer isn't reachable right now. Please try again in a minute.");
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(err?.detail ?? "The transposer couldn't transpose this songsheet.");
  }
  return res.arrayBuffer();
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
 * Remove a session's attached songsheets that nothing uses any more: not the plan or its revision.
 * Recent ones are kept (they may be in unsaved edits). Never throws.
 */
export async function sweepSessionUploads(sessionId: string): Promise<void> {
  try {
    const db = createAdminClient();
    const store = db.storage.from(BUCKET);
    const { data: files } = await store.list(folder(sessionId), { limit: 1000 });
    if (!files?.length) return;
    const { data: s } = await db
      .from("worship_sessions")
      .select("draft_plan, worship_session_sections(worship_session_items(sheet))")
      .eq("id", sessionId)
      .maybeSingle();
    const used = new Set<string>();
    if (s) {
      sheetIds(s.worship_session_sections, used);
      sheetIds(s.draft_plan, used);
    }
    const cutoff = Date.now() - GRACE_MS;
    const stale = files
      // <sheet id>.pdf, its original <sheet id>.docx and transposed copies <sheet id>.<key>.pdf.
      .filter((f) => !used.has(f.name.split(".")[0]))
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
