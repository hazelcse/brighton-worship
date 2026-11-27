"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { workerFetch, type UploadResult } from "@/lib/worker";
import { cleanSteps, stepNames } from "@/lib/session-plan";
import { songsheetFileProblem } from "@/lib/songsheet-file";
import { SONGS_TAG } from "@/lib/cache-tags";

export type SaveState = { ok: boolean; message: string | null };

function fail(e: unknown): SaveState {
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
}

// ---------------------------------------------------------------------------
// Upload + scanning
// ---------------------------------------------------------------------------

/**
 * Uploads ONE songsheet. The upload dialog sends each file in its own request, so no request goes
 * over a host's body limit (Vercel: 4.5 MB) however many files are picked, then calls
 * finishUploads() once to refresh the library.
 * With song_id, the file replaces that song's songsheet (each song has one base copy).
 */
export async function uploadSongsheet(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  const fileName = file instanceof File ? file.name : "songsheet";
  try {
    const user = await requirePermission("songs.create");
    const replaceSongId = String(formData.get("song_id") ?? "") || null;
    if (replaceSongId) await requirePermission("songs.edit");
    if (!(file instanceof File) || file.size === 0) return { file_name: fileName, status: "failed", error: "Choose a .docx songsheet." };
    const problem = songsheetFileProblem(file);
    if (problem) return { file_name: fileName, status: "failed", error: problem };

    const body = new FormData();
    body.append("file", file, file.name);
    body.append("uploaded_by", user.id);
    if (replaceSongId) body.append("replace_song_id", replaceSongId);
    return await workerFetch<UploadResult>("/upload", { method: "POST", body });
  } catch (e) {
    return { file_name: fileName, status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** After a batch of uploads: refresh the song library once. */
export async function finishUploads(): Promise<void> {
  await requireUser();
  updateTag(SONGS_TAG);
  revalidatePath("/songs", "layout");
}

/** Scans any songsheets that were stored but not scanned yet. Called when the library opens. */
export async function scanPendingSongsheets(): Promise<{ processed: number }> {
  await requirePermission("songs.view");
  const r = await workerFetch<{ processed: number; failed: number }>("/process-pending", { method: "POST" }, 300_000);
  if (r.processed) {
    updateTag(SONGS_TAG);
    revalidatePath("/songs", "layout");
  }
  return { processed: r.processed };
}

export async function rescanVersion(songId: string, versionId: string): Promise<SaveState> {
  try {
    await requirePermission("songs.edit");
    const r = await workerFetch<UploadResult>(`/versions/${versionId}/process`, { method: "POST" });
    updateTag(SONGS_TAG);
    revalidatePath(`/songs/${songId}`);
    return r.status === "failed" ? { ok: false, message: r.error ?? "Scan failed." } : { ok: true, message: "Rescanned." };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function jsonList(formData: FormData, name: string): string[] {
  try {
    const v = JSON.parse(String(formData.get(name) ?? "[]"));
    return Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function updateSongDetails(songId: string, _prev: SaveState, formData: FormData): Promise<SaveState> {
  try {
    const user = await requirePermission("songs.edit");
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { ok: false, message: "The song needs a title." };

    const type = String(formData.get("type") ?? "");
    const language = String(formData.get("language") ?? "en");
    const bpmRaw = String(formData.get("bpm") ?? "").trim();
    const bpm = bpmRaw ? Number(bpmRaw) : null;
    if (bpm !== null && (!Number.isFinite(bpm) || bpm < 20 || bpm > 300)) {
      return { ok: false, message: "Tempo should be a number between 20 and 300." };
    }

    let steps: ReturnType<typeof cleanSteps> = [];
    try {
      const raw = JSON.parse(String(formData.get("standard_steps") ?? "[]"));
      steps = Array.isArray(raw) ? cleanSteps(raw) : [];
    } catch {
      /* ignore malformed */
    }

    const db = createAdminClient();
    const { error } = await db
      .from("songs")
      .update({
        title,
        title_key: title.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim(),
        artist: String(formData.get("artist") ?? "").trim() || null,
        type: ["praise", "worship", "praise_worship"].includes(type) ? type : null,
        type_is_estimate: false,
        bpm,
        time_signature: String(formData.get("time_signature") ?? "").trim() || null,
        language: language === "zh" ? "zh" : "en",
        original_key: String(formData.get("original_key") ?? "").trim() || null,
        // Typed in by the admin team / leads; the scanner never fills it.
        suggested_key: String(formData.get("suggested_key") ?? "").trim().slice(0, 40) || null,
        sections: jsonList(formData, "sections"),
        // The plain names too, for the song bank and anything reading only them.
        standard_sequence: stepNames(steps),
        standard_steps: steps.length ? steps : null,
        themes: jsonList(formData, "themes"),
        notes: String(formData.get("notes") ?? "").trim().slice(0, 4000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", songId);
    if (error) throw error;

    await db.from("audit_log").insert({ actor_id: user.id, action: "song.update", target: songId, details: { title } });
  } catch (e) {
    return fail(e);
  }
  updateTag(SONGS_TAG);
  revalidatePath("/songs", "layout");
  return { ok: true, message: "Saved." };
}

export async function saveLinks(songId: string, _prev: SaveState, formData: FormData): Promise<SaveState> {
  try {
    const user = await requirePermission("songs.edit_links");
    let links: { label: string; url: string }[];
    try {
      links = JSON.parse(String(formData.get("links") ?? "[]"));
    } catch {
      return { ok: false, message: "Couldn't read the links." };
    }
    links = links.map((l) => ({ label: String(l.label ?? "").trim(), url: String(l.url ?? "").trim() })).filter((l) => l.url);
    for (const l of links) {
      if (!/^https?:\/\/\S+$/i.test(l.url)) return { ok: false, message: `"${l.url}" isn't a web address.` };
      if (!l.label) return { ok: false, message: "Every link needs a name." };
    }
    const seen = new Set<string>();
    if (links.some((l) => (seen.has(l.url) ? true : (seen.add(l.url), false)))) {
      return { ok: false, message: "The same link is listed twice." };
    }

    const db = createAdminClient();
    const { error: dErr } = await db.from("song_links").delete().eq("song_id", songId);
    if (dErr) throw dErr;
    if (links.length) {
      const { error } = await db
        .from("song_links")
        .insert(links.map((l, i) => ({ song_id: songId, label: l.label, url: l.url, position: i, created_by: user.id })));
      if (error) throw error;
    }
    await db.from("audit_log").insert({ actor_id: user.id, action: "song.links", target: songId, details: { count: links.length } });
  } catch (e) {
    return fail(e);
  }
  updateTag(SONGS_TAG);
  revalidatePath(`/songs/${songId}`);
  return { ok: true, message: "Links saved." };
}

export async function markReviewed(songId: string): Promise<SaveState> {
  try {
    const user = await requirePermission("songs.edit");
    const db = createAdminClient();
    const now = new Date().toISOString();
    const { error } = await db.from("songs").update({ reviewed_at: now, reviewed_by: user.id }).eq("id", songId);
    if (error) throw error;
    // Reviewing a song also deals with the issues people raised about it.
    await db.from("song_issues").update({ resolved_at: now, resolved_by: user.id }).eq("song_id", songId).is("resolved_at", null);
  } catch (e) {
    return fail(e);
  }
  // The whole app: the song's issue updates drop out of Updates and the nav badge too.
  updateTag(SONGS_TAG);
  revalidatePath("/", "layout");
  return { ok: true, message: "Marked as reviewed." };
}

// ---------------------------------------------------------------------------
// Confirming / correcting the key the scanner detected
// ---------------------------------------------------------------------------

const KEY_RE = /^[A-G](#|b)?m?$/;

export async function confirmKey(
  songId: string,
  versionId: string,
  keys: string[],
  alternates: string[],
): Promise<SaveState> {
  try {
    const user = await requirePermission("songs.edit");
    const clean = (list: string[]) => [...new Set(list.map((k) => k.trim()).filter(Boolean))];
    const main = keys.map((k) => k.trim()).filter(Boolean);
    const alts = clean(alternates);
    if (!main.length) return { ok: false, message: "Choose the key the songsheet starts in." };
    if (![...main, ...alts].every((k) => KEY_RE.test(k))) return { ok: false, message: "That isn't a key." };
    for (let i = 1; i < main.length; i++) {
      if (main[i] === main[i - 1]) return { ok: false, message: "A key change has to go to a different key." };
    }

    const db = createAdminClient();
    const { data: v } = await db.from("song_versions").select("song_id, keys").eq("id", versionId).maybeSingle();
    if (!v || v.song_id !== songId) return { ok: false, message: "Songsheet not found." };
    const { error } = await db
      .from("song_versions")
      .update({
        keys: main,
        key_display: main.join("→"),
        alternate_keys: alts.filter((k) => !main.includes(k)),
        key_confirmed_at: new Date().toISOString(),
        key_confirmed_by: user.id,
      })
      .eq("id", versionId);
    if (error) throw error;
    await db.from("audit_log").insert({
      actor_id: user.id,
      action: "song.confirm_key",
      target: songId,
      details: { from: v.keys, to: main, alternates: alts },
    });
  } catch (e) {
    return fail(e);
  }
  updateTag(SONGS_TAG);
  revalidatePath("/songs", "layout");
  return { ok: true, message: "Key confirmed." };
}

/** Go back to the key the scanner detected. */
export async function resetKey(songId: string, versionId: string): Promise<SaveState> {
  try {
    const user = await requirePermission("songs.edit");
    const db = createAdminClient();
    const { data: v } = await db.from("song_versions").select("song_id, scan").eq("id", versionId).maybeSingle();
    if (!v || v.song_id !== songId) return { ok: false, message: "Songsheet not found." };
    const scan = (v.scan ?? {}) as { key_regions?: { key: string }[]; key_display?: string | null; alternate_keys?: string[] };
    const keys: string[] = [];
    for (const r of scan.key_regions ?? []) if (keys[keys.length - 1] !== r.key) keys.push(r.key);
    const { error } = await db
      .from("song_versions")
      .update({
        keys,
        key_display: scan.key_display ?? null,
        alternate_keys: scan.alternate_keys ?? [],
        key_confirmed_at: null,
        key_confirmed_by: null,
      })
      .eq("id", versionId);
    if (error) throw error;
    await db.from("audit_log").insert({ actor_id: user.id, action: "song.reset_key", target: songId, details: {} });
  } catch (e) {
    return fail(e);
  }
  updateTag(SONGS_TAG);
  revalidatePath("/songs", "layout");
  return { ok: true, message: "Using the scanner's key again." };
}

// ---------------------------------------------------------------------------
// Deleting a song
// ---------------------------------------------------------------------------

/** Permanently delete a song, its songsheet, preview, links and key instruments. */
export async function deleteSong(songId: string): Promise<SaveState> {
  try {
    const user = await requirePermission("songs.delete");
    const db = createAdminClient();
    const { data: song } = await db.from("songs").select("title").eq("id", songId).maybeSingle();
    if (!song) return { ok: false, message: "Song not found." };

    const { data: versions } = await db
      .from("song_versions")
      .select("original_path, docx_path, file_sha256, preview_pages")
      .eq("song_id", songId);
    const paths = new Set<string>();
    for (const v of versions ?? []) {
      if (v.original_path) paths.add(v.original_path);
      if (v.docx_path) paths.add(v.docx_path);
      paths.add(`previews/${v.file_sha256}/sheet.pdf`);
      for (let i = 1; i <= (v.preview_pages ?? 0); i++) paths.add(`previews/${v.file_sha256}/${i}.png`);
    }

    // Deleting the song also deletes its songsheet row, links and key instruments (cascade).
    const { error } = await db.from("songs").delete().eq("id", songId);
    if (error) throw error;
    if (paths.size) await db.storage.from("songsheets").remove([...paths]);
    await db.from("audit_log").insert({ actor_id: user.id, action: "song.delete", target: songId, details: { title: song.title } });
  } catch (e) {
    return fail(e);
  }
  updateTag(SONGS_TAG);
  revalidatePath("/songs", "layout");
  redirect("/songs");
}

// ---------------------------------------------------------------------------
// Google Drive sync
// ---------------------------------------------------------------------------

export type DriveSyncItem = { name: string; result: "added" | "updated" | "replaced" | "unchanged" | "duplicate" | "failed" | "removed"; song_id?: string; title?: string; error?: string };
export type DriveSyncSummary = {
  busy?: boolean;
  files: number;
  added: number;
  updated: number;
  replaced: number;
  unchanged: number;
  /** New files for songs that already had one in Drive (see duplicate-songsheets.tsx). */
  duplicate?: number;
  failed: number;
  removed: number;
  items: DriveSyncItem[];
};

/** Pull new and changed songsheets from the shared Google Drive folder (anyone who can add songs). */
export async function syncFromDrive(): Promise<{ ok: boolean; message: string | null; summary?: DriveSyncSummary; busy?: boolean }> {
  try {
    const user = await requirePermission("songs.create");
    const summary = await workerFetch<DriveSyncSummary>(
      `/drive/sync?started_by=${encodeURIComponent(user.id)}`,
      { method: "POST" },
      600_000, // a first sync of a big folder scans every sheet
    );
    if (summary.busy) return { ok: true, message: null, busy: true }; // the button just keeps spinning
    updateTag(SONGS_TAG);
    revalidatePath("/songs");
    return { ok: true, message: null, summary };
  } catch (e) {
    return fail(e);
  }
}

/** The person has looked at the song library updates: clears the badge. */
export async function markSongUpdatesSeen(): Promise<void> {
  try {
    const user = await requireUser();
    if (!user.can("songs.library_updates") && !user.can("songs.issue_reports")) return;
    await createAdminClient().from("profiles").update({ song_updates_seen_at: new Date().toISOString() }).eq("id", user.id);
    revalidatePath("/", "layout");
  } catch {
    // e.g. a developer viewing as someone else: nothing is changed
  }
}

/** Anyone who can see the song library: report a problem with a song or its songsheet. */
export async function raiseSongIssue(songId: string, message: string): Promise<SaveState> {
  try {
    const user = await requirePermission("songs.view");
    const text = message.trim().replace(/\n{3,}/g, "\n\n");
    if (!text) return { ok: false, message: "Say what the problem is." };
    if (text.length > 2000) return { ok: false, message: "Keep it under 2,000 characters." };
    const db = createAdminClient();
    const { data: song } = await db.from("songs").select("title").eq("id", songId).maybeSingle();
    if (!song) return { ok: false, message: "Song not found." };
    const { data: issue, error } = await db.from("song_issues").insert({ song_id: songId, raised_by: user.id, message: text }).select("id").single();
    if (error) throw error;
    await db.from("song_events").insert({
      kind: "issue_raised",
      song_id: songId,
      title: song.title,
      source: "upload",
      actor_id: user.id,
      details: { message: text, issue_id: issue.id },
    });
  } catch (e) {
    return fail(e);
  }
  updateTag(SONGS_TAG);
  revalidatePath("/songs", "layout");
  return { ok: true, message: "Thanks: the people who look after the song library have been told." };
}

/** Editors: the song no longer being in Google Drive is fine (e.g. dropped on purpose). */
export async function clearMissingFromDrive(songId: string): Promise<SaveState> {
  try {
    await requirePermission("songs.edit");
    const { error } = await createAdminClient().from("songs").update({ missing_from_drive_at: null }).eq("id", songId);
    if (error) throw error;
  } catch (e) {
    return fail(e);
  }
  updateTag(SONGS_TAG);
  revalidatePath("/songs", "layout");
  return { ok: true, message: "Flag cleared." };
}

/**
 * A Drive sync the app didn't wait for (the worker's scheduled one, or one already running when
 * the button was clicked) has finished: drop the cached library so the new songs show.
 */
export async function refreshSongLibrary(): Promise<void> {
  await requirePermission("songs.view");
  updateTag(SONGS_TAG);
}

/** Song editors: of a song's duplicate songsheets in Google Drive, keep this one (the others go to the Drive bin). */
export async function keepDriveSongsheet(songId: string, fileId: string): Promise<SaveState> {
  let result: { status: "done" | "partial" | "failed"; message: string };
  try {
    const user = await requirePermission("songs.edit");
    await requirePermission("songs.create");
    const body = new FormData();
    body.set("file_id", fileId);
    body.set("actor_id", user.id);
    result = await workerFetch(`/drive/songs/${encodeURIComponent(songId)}/keep`, { method: "POST", body }, 180_000);
  } catch (e) {
    return fail(e);
  }
  updateTag(SONGS_TAG);
  revalidatePath("/songs", "layout");
  return { ok: result.status !== "failed", message: result.message };
}
