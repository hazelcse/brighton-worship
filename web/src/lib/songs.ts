import "server-only";
import { pinyin } from "pinyin-pro";
import { createAdminClient } from "@/lib/supabase/admin";

export type SongType = "praise" | "worship" | "praise_worship";
export type Language = "en" | "zh";
export type Severity = "error" | "warning" | "info";
export type Issue = { code: string; severity: Severity; message: string };

export const SONG_TYPE_LABEL: Record<SongType, string> = {
  praise: "Praise",
  worship: "Worship",
  praise_worship: "Praise / Worship",
};
export const LANGUAGE_LABEL: Record<Language, string> = { en: "English", zh: "Chinese" };

export type VersionRow = {
  id: string;
  file_name: string;
  key_display: string | null;
  keys: string[];
  alternate_keys: string[];
  issues: Issue[];
  scan_status: "pending" | "scanning" | "done" | "failed";
  scan_error: string | null;
  scanned_at: string | null;
  created_at: string;
  original_path: string;
  docx_path: string | null;
  preview_pages?: number | null;
  key_confirmed_at?: string | null;
  confirmer?: { full_name: string; email: string } | null;
  scanned_keys?: string | null;
  scanned_alternates?: string[] | null;
  chart_sequence?: string[] | null;
  lyric_sequence?: string[] | null;
};

export type SongCard = {
  id: string;
  title: string;
  artist: string | null;
  /** The lyric lines from its songsheet, one per line (for searching). */
  lyrics: string;
  /** Hanyu pinyin of the title's Chinese characters, without tones ("zhu ni shi wo li liang"); "" when none. */
  titlePinyin: string;
  type: SongType | null;
  language: Language;
  bpm: number | null;
  keys: string[];
  needsReview: boolean;
  /** Its songsheet is no longer in the Google Drive folder (the app still has its copy). */
  missingFromDrive: boolean;
  versionId: string | null;
  previewPages: number | null;
};

/** Scanner messages about the key, which an editor settles by confirming the key. */
export const KEY_ISSUE_CODES = new Set(["written_key_mismatch", "title_key_mismatch", "low_key_confidence"]);

/** Warnings/errors from scans newer than the last time someone reviewed the song. */
export function openIssues(
  versions: Pick<VersionRow, "issues" | "scanned_at" | "scan_status" | "scan_error" | "key_confirmed_at">[],
  reviewedAt: string | null,
): Issue[] {
  const out: Issue[] = [];
  for (const v of versions) {
    if (v.scan_status === "failed") {
      out.push({ code: "scan_failed", severity: "error", message: v.scan_error ?? "The scan failed." });
      continue;
    }
    if (reviewedAt && v.scanned_at && v.scanned_at <= reviewedAt) continue;
    for (const i of v.issues ?? []) {
      if (i.severity === "info") continue;
      if (v.key_confirmed_at && KEY_ISSUE_CODES.has(i.code)) continue; // settled by an editor
      out.push(i);
    }
  }
  return out;
}

/**
 * A title's Hanyu pinyin for searching, lower case and without tones, one syllable per word
 * ("主你是我力量" → "zhu ni shi wo li liang"); ü is written u. Non-Chinese parts are kept.
 * "" when the title has no Chinese characters.
 */
export function titlePinyin(title: string): string {
  if (!/\p{Script=Han}/u.test(title)) return "";
  return pinyin(title, { toneType: "none", type: "array", nonZh: "consecutive" })
    .join(" ")
    .toLowerCase()
    .replace(/ü/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

/** All songs for the library gallery. ~hundreds of rows, so the gallery filters on the client. */
export async function loadSongCards(): Promise<{ songs: SongCard[]; pendingScans: number }> {
  const db = createAdminClient();
  const [{ data, error }, { count }] = await Promise.all([
    db
      .from("songs")
      .select(
        "id, title, artist, lyrics, type, language, bpm, reviewed_at, missing_from_drive_at, song_versions(id, preview_pages, key_display, keys, issues, scanned_at, scan_status, scan_error, key_confirmed_at)",
      )
      .order("title"),
    db.from("song_versions").select("id", { count: "exact", head: true }).in("scan_status", ["pending", "failed"]),
  ]);
  if (error) throw error;
  const { data: reported } = await db.from("song_issues").select("song_id").is("resolved_at", null);
  const hasReport = new Set((reported ?? []).map((r) => r.song_id as string));

  const songs = (data ?? []).map((s) => {
    const versions = (s.song_versions ?? []) as VersionRow[];
    const keys = [...new Set(versions.flatMap((v) => v.keys ?? []))];
    return {
      id: s.id as string,
      title: s.title as string,
      artist: (s.artist as string | null) ?? null,
      lyrics: (s.lyrics as string | null) ?? "",
      titlePinyin: titlePinyin(s.title as string),
      type: s.type as SongType | null,
      language: s.language as Language,
      bpm: s.bpm === null ? null : Number(s.bpm),
      keys,
      // Scanner problems, or an issue someone raised that hasn't been dealt with.
      needsReview: openIssues(versions, s.reviewed_at as string | null).length > 0 || hasReport.has(s.id as string),
      missingFromDrive: Boolean(s.missing_from_drive_at),
      versionId: versions[0]?.id ?? null,
      previewPages: versions[0]?.preview_pages ?? null,
    };
  });
  return { songs, pendingScans: count ?? 0 };
}

export async function loadSong(id: string) {
  const db = createAdminClient();
  const [{ data: song }, { data: versions }, { data: links }, { data: reports }] =
    await Promise.all([
      db.from("songs").select("*").eq("id", id).maybeSingle(),
      db
        .from("song_versions")
        .select(
          "id, file_name, key_display, keys, alternate_keys, issues, scan_status, scan_error, scanned_at, created_at, original_path, docx_path, preview_pages, key_confirmed_at, confirmer:profiles!song_versions_key_confirmed_by_fkey(full_name, email), scanned_keys:scan->key_display, scanned_alternates:scan->alternate_keys, chart_sequence:scan->chart_sequence, lyric_sequence:scan->lyric_sequence",
        )
        .eq("song_id", id)
        .order("created_at"),
      db.from("song_links").select("id, label, url, position").eq("song_id", id).order("position"),
      db
        .from("song_issues")
        .select("id, message, created_at, raiser:profiles!song_issues_raised_by_fkey(full_name, email)")
        .eq("song_id", id)
        .is("resolved_at", null)
        .order("created_at"),
    ]);
  if (!song) return null;
  return {
    song: song as {
      id: string;
      title: string;
      artist: string | null;
      type: SongType | null;
      type_is_estimate: boolean;
      bpm: number | null;
      time_signature: string | null;
      language: Language;
      sections: string[];
      standard_sequence: string[];
      standard_steps: unknown;
      themes: string[];
      original_key: string | null;
      reviewed_at: string | null;
      missing_from_drive_at: string | null;
      notes: string;
    },
    /** Issues people raised that haven't been resolved yet. */
    reports: (reports ?? []).map((r) => {
      const p = r.raiser as unknown as { full_name: string; email: string } | null;
      return { id: r.id as string, message: r.message as string, at: r.created_at as string, by: p ? p.full_name || p.email : "Someone" };
    }),
    versions: (versions ?? []) as unknown as VersionRow[],
    links: (links ?? []) as { id: string; label: string; url: string; position: number }[],
  };
}

export type LoadedSong = NonNullable<Awaited<ReturnType<typeof loadSong>>>;
