import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanSheet, majorKey, ownSheetKeys, semitonesBetween, sheetIntervals } from "@/lib/session-plan";
import { loadSessionSheet } from "@/lib/session-uploads";
import { workerFetch } from "@/lib/worker";

/**
 * The songsheets of a published session: each library song's sheet in the key the session plays
 * it in. A sheet already in that key is the song's own PDF preview; any other key is transposed
 * by the worker once and kept (transposed_songsheets), so every later session in that key reuses it.
 */

const BUCKET = "songsheets";
type Db = ReturnType<typeof createAdminClient>;

export type SheetFile = { pdf: Blob; fileName: string };

/** The song's base copy and the key it starts in. */
async function baseVersion(db: Db, songId: string) {
  const { data } = await db
    .from("song_versions")
    .select("id, file_sha256, file_name, keys, key_display, alternate_keys, preview_pages")
    .eq("song_id", songId)
    .limit(1)
    .maybeSingle();
  return data;
}

/** Raw bytes from the worker (workerFetch is for JSON). */
async function workerPdf(path: string, body: FormData): Promise<{ bytes: ArrayBuffer; fileName: string | null }> {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!url || !token) throw new Error("The songsheet worker isn't configured.");
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: "POST",
      body,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    });
  } catch {
    throw new Error("The transposer isn't reachable right now. Please try again in a minute.");
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(err?.detail ?? "The transposer couldn't make this songsheet.");
  }
  const name = res.headers.get("x-file-name");
  return { bytes: await res.arrayBuffer(), fileName: name ? decodeURIComponent(name) : null };
}

/**
 * A song's sheet in `key` (null: as written) as a PDF, making and storing it first if needed.
 * Throws with a message fit to show if there's no sheet or it can't be made.
 */
export async function songsheetInKey(songId: string, key: string | null): Promise<SheetFile> {
  const db = createAdminClient();
  const v = await baseVersion(db, songId);
  if (!v) throw new Error("This song has no songsheet yet.");
  const target = majorKey(key);
  const from = majorKey((v.keys as string[] | null)?.[0]);
  const store = db.storage.from(BUCKET);

  // Already in the key (or the session didn't pick one): the sheet's own preview PDF.
  if (!target || target === from) {
    if (!v.preview_pages) await workerFetch(`/versions/${v.id}/preview`, { method: "POST" });
    const { data, error } = await store.download(`previews/${v.file_sha256}/sheet.pdf`);
    if (error || !data) throw new Error("The songsheet's PDF couldn't be loaded.");
    return { pdf: data, fileName: (v.file_name as string).replace(/\.docx?$/i, ".pdf") };
  }

  const { data: cached } = await db.from("transposed_songsheets").select("path, file_name").eq("version_id", v.id).eq("key", target).maybeSingle();
  if (cached) {
    const { data } = await store.download(cached.path);
    if (data) return { pdf: data, fileName: cached.file_name };
  }

  const body = new FormData();
  body.append("target_key", target);
  body.append("format", "pdf");
  const made = await workerPdf(`/transpose/song/${songId}`, body);
  const path = `transposed/${v.file_sha256}/${target.replace("#", "sharp")}.pdf`;
  const fileName = made.fileName ?? (v.file_name as string).replace(/\.docx?$/i, ` (${target}).pdf`);
  const { error } = await store.upload(path, made.bytes, { contentType: "application/pdf", upsert: true });
  if (!error) await db.from("transposed_songsheets").upsert({ version_id: v.id, key: target, path, file_name: fileName });
  return { pdf: new Blob([made.bytes], { type: "application/pdf" }), fileName };
}

/**
 * The keys a session song's songsheets come in: its key, plus the key it changes to unless the
 * songsheet already has a key change (or a written-out copy) that many semitones apart, which the
 * sheet in the first key then covers.
 */
export async function sheetKeysFor(items: { id: string; song_id: string | null; key: string | null; transpose_to: string | null }[]): Promise<Record<string, string[]>> {
  const changing = items.filter((i) => i.song_id && i.key && i.transpose_to && majorKey(i.transpose_to) !== majorKey(i.key));
  if (!changing.length) return {};
  const db = createAdminClient();
  const { data } = await db
    .from("song_versions")
    .select("song_id, keys, key_display, alternate_keys")
    .in("song_id", [...new Set(changing.map((i) => i.song_id!))]);
  const sheet = new Map((data ?? []).map((v) => [v.song_id as string, v]));
  const out: Record<string, string[]> = {};
  for (const i of changing) {
    const v = sheet.get(i.song_id!);
    const covered = v && sheetIntervals(v.key_display as string | null, v.keys as string[], v.alternate_keys as string[]).includes(semitonesBetween(i.key, i.transpose_to)!);
    out[i.id] = covered ? [majorKey(i.key)!] : [majorKey(i.key)!, majorKey(i.transpose_to)!];
  }
  return out;
}

/**
 * Make every sheet a published session needs, so they open straight away: bank songs' in their
 * keys, and worship leaders' own Word sheets transposed to theirs. Failures are left for on-demand.
 */
export async function prepareSessionSongsheets(sessionId: string): Promise<void> {
  const db = createAdminClient();
  const { data } = await db
    .from("worship_session_sections")
    .select("worship_session_items(id, kind, song_id, key, transpose_to, sheet)")
    .eq("session_id", sessionId);
  type Item = { id: string; kind: string; song_id: string | null; key: string | null; transpose_to: string | null; sheet: unknown };
  const all = (data ?? []).flatMap((sec) => (sec.worship_session_items as Item[]).filter((i) => i.kind === "song"));
  const songs = all.filter((i) => i.song_id);
  const extra = await sheetKeysFor(songs);
  const wanted = new Map<string, { songId: string; key: string | null }>();
  for (const i of songs) {
    for (const key of extra[i.id] ?? [i.key]) wanted.set(`${i.song_id}|${majorKey(key) ?? ""}`, { songId: i.song_id!, key });
  }
  // One at a time: the worker converts with LibreOffice, which doesn't like running in parallel.
  for (const w of wanted.values()) {
    try {
      await songsheetInKey(w.songId, w.key);
    } catch (e) {
      console.warn(`Session ${sessionId}: songsheet for ${w.songId} in ${w.key ?? "its own key"} not made:`, e);
    }
  }
  for (const i of all) {
    const sheet = i.song_id ? null : cleanSheet(i.sheet);
    if (!sheet) continue;
    for (const key of ownSheetKeys({ key: i.key, transpose_to: i.transpose_to, sheet })) {
      if (key === majorKey(sheet.key)) continue;
      try {
        await loadSessionSheet(sessionId, sheet, key);
      } catch (e) {
        console.warn(`Session ${sessionId}: attached songsheet ${sheet.id} in ${key} not made:`, e);
      }
    }
  }
}
