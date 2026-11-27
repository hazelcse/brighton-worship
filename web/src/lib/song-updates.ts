import { cache } from "react";
import type { Permission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

/** Song library updates are shown for this long. */
const DAYS = 60;

export type SongUpdateKind = "song_added" | "songsheet_reuploaded" | "issues_flagged" | "songsheet_missing" | "issue_raised" | "songsheet_duplicate";

/**
 * Which updates a person gets: songs.library_updates covers the library's own changes,
 * songs.issue_reports the issues people raise. Empty = no updates at all.
 */
export function updateKindsFor(user: { can: (p: Permission) => boolean }): SongUpdateKind[] {
  return [
    ...(user.can("songs.library_updates") ? (["song_added", "songsheet_reuploaded", "issues_flagged", "songsheet_missing", "songsheet_duplicate"] as const) : []),
    ...(user.can("songs.issue_reports") ? (["issue_raised"] as const) : []),
  ];
}

export type SongUpdate = {
  id: string;
  kind: SongUpdateKind;
  songId: string | null;
  title: string;
  source: "upload" | "drive";
  /** Who uploaded it (null for Google Drive). */
  by: string | null;
  /** The file's name in Drive or on upload. */
  file: string | null;
  /** How the songsheet changed, e.g. "deleted and added back in Drive". */
  how: string | null;
  issues: { severity: "error" | "warning"; message: string }[];
  /** For duplicate songsheets: the files' names in Drive. */
  files: string[];
  /** For duplicate songsheets: still to be sorted out (one hasn't been kept yet). */
  open: boolean;
  /** For a raised issue: what they said. */
  message: string | null;
  at: string;
  unseen: boolean;
};

const seenAt = cache(async (userId: string): Promise<string | null> => {
  const { data } = await createAdminClient().from("profiles").select("song_updates_seen_at").eq("id", userId).maybeSingle();
  return (data?.song_updates_seen_at as string | null) ?? null;
});

const since = () => new Date(Date.now() - DAYS * 86_400_000).toISOString();

const ISSUE_KINDS = new Set<string>(["issue_raised", "issues_flagged"]);

type EventSong = { reviewed_at: string | null; duplicate_drive_at: string | null } | null;

/** An issue update is settled once someone marks the song as reviewed after it, so it drops out. */
function settled(e: { kind: string; created_at: string; song: unknown }) {
  const reviewedAt = (e.song as unknown as EventSong)?.reviewed_at;
  return ISSUE_KINDS.has(e.kind) && Boolean(reviewedAt) && reviewedAt! >= e.created_at;
}

/** Recent song library updates of these kinds (see updateKindsFor), newest first. */
export async function loadSongUpdates(userId: string, kinds: SongUpdateKind[]): Promise<SongUpdate[]> {
  if (!kinds.length) return [];
  const db = createAdminClient();
  const [{ data }, seen] = await Promise.all([
    db
      .from("song_events")
      .select("id, kind, song_id, title, source, details, created_at, actor:profiles(full_name, email), song:songs(reviewed_at, duplicate_drive_at)")
      .in("kind", kinds)
      .gte("created_at", since())
      .order("created_at", { ascending: false })
      .limit(200),
    seenAt(userId),
  ]);
  return (data ?? []).filter((e) => !settled(e)).map((e) => {
    const d = (e.details ?? {}) as { file?: string; files?: string[]; how?: string; issues?: SongUpdate["issues"]; message?: string };
    const actor = e.actor as unknown as { full_name: string; email: string } | null;
    return {
      id: e.id,
      kind: e.kind as SongUpdateKind,
      songId: e.song_id,
      title: e.title,
      source: e.source as SongUpdate["source"],
      by: actor ? actor.full_name || actor.email : null,
      file: d.file ?? null,
      how: d.how ?? null,
      issues: d.issues ?? [],
      files: d.files ?? [],
      open: e.kind === "songsheet_duplicate" && Boolean((e.song as unknown as EventSong)?.duplicate_drive_at),
      message: d.message ?? null,
      at: e.created_at,
      unseen: !seen || e.created_at > seen,
    };
  });
}

/** How many updates the person hasn't looked at yet (for the nav badge). */
export async function countUnseenSongUpdates(userId: string, kinds: SongUpdateKind[]): Promise<number> {
  if (!kinds.length) return 0;
  const seen = await seenAt(userId);
  const after = seen && seen > since() ? seen : since();
  const { data } = await createAdminClient()
    .from("song_events")
    .select("kind, created_at, song:songs(reviewed_at)")
    .in("kind", kinds)
    .gt("created_at", after)
    .limit(1000);
  return (data ?? []).filter((e) => !settled(e)).length;
}
