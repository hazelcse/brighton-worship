"use server";

import { crewSessionsFor } from "@/lib/projection";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildsAnySession, loadWorkbench, normalisePlan, sessionAccess, sessionLinks, type Workbench } from "@/lib/sessions";
import { prepareSessionSongsheets } from "@/lib/session-songsheets";
import { createHash } from "node:crypto";
import { describeLinkChanges, describePlanChanges } from "@/lib/plan-changes";
import {
  LOCK_STALE_MS,
  cleanSheet,
  cleanSteps,
  defaultPlan,
  majorKey,
  sessionSheetProblem,
  songSteps,
  type PlanItem,
  type PlanLink,
  type PlanSection,
  type SeqStep,
  type SheetScan,
  type SongType,
  type UploadedSheet,
} from "@/lib/session-plan";
import { readSheetKey, storeSessionSheet, sweepSessionUploads } from "@/lib/session-uploads";

const WL = "worship leader";

async function signedIn(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  return user;
}

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** The plan row, after checking this person is a confirmed worship leader of it. */
async function editablePlan(user: CurrentUser, id: string) {
  const { data: plan } = await createAdminClient()
    .from("worship_sessions")
    .select("id, roster_session_id, status, locked_by, locked_at")
    .eq("id", id)
    .maybeSingle();
  if (!plan) throw new Error("This session doesn't exist any more.");
  const access = await sessionAccess(user, plan);
  if (!access.canEdit) throw new Error("Only this session's confirmed worship leaders can edit it.");
  return plan;
}

// ---------------------------------------------------------------------------
// Starting a session
// ---------------------------------------------------------------------------

/** Open the plan for one of the worship leader's sessions, creating it (with default sections) the first time. */
export async function startSession(rosterSessionId: string): Promise<void> {
  const user = await signedIn();
  const db = createAdminClient();
  const [{ data: rs }, { data: req }] = await Promise.all([
    db.from("roster_sessions").select("id, date, name, kind, cancelled, rosters(status)").eq("id", rosterSessionId).maybeSingle(),
    db.from("serve_requests").select("role, status").eq("session_id", rosterSessionId).eq("member_id", user.id).maybeSingle(),
  ]);
  if (!rs || rs.cancelled || (rs.rosters as unknown as { status: string } | null)?.status !== "published") {
    throw new Error("That session isn't on the published roster.");
  }
  if (!buildsAnySession(user) && (req?.role !== WL || req.status !== "accepted")) {
    throw new Error("Confirm you're leading this session on the roster first.");
  }

  const kind = rs.kind ?? "custom";
  const find = () =>
    db
      .from("worship_sessions")
      .select("id, roster_session_id")
      .eq("date", rs.date)
      .eq("service", kind)
      .eq("service_name", rs.name)
      .maybeSingle();

  let { data: plan } = await find();
  if (!plan) {
    const { data: created, error } = await db
      .from("worship_sessions")
      .insert({ date: rs.date, service: kind, service_name: rs.name, roster_session_id: rs.id, created_by: user.id, updated_by: user.id })
      .select("id, roster_session_id")
      .single();
    if (error) {
      // The other worship leader started it at the same moment: use theirs.
      if (error.code !== "23505") throw error;
      plan = (await find()).data;
    } else {
      plan = created;
      const { error: saveErr } = await db.rpc("save_worship_session_plan", {
        p_session_id: created.id,
        p_user_id: user.id,
        p_plan: defaultPlan(kind),
      });
      if (saveErr) throw saveErr;
    }
  }
  if (!plan) throw new Error("Couldn't open that session. Try again.");
  if (plan.roster_session_id !== rs.id) {
    await db.from("worship_sessions").update({ roster_session_id: rs.id }).eq("id", plan.id);
  }
  revalidatePath("/sessions");
  revalidatePath("/sessions/build");
  redirect(`/sessions/${plan.id}`);
}

// ---------------------------------------------------------------------------
// The editing lock: one worship leader edits at a time
// ---------------------------------------------------------------------------

export type LockResult =
  /** version: a fingerprint of the saved draft being edited, sent back when saving. */
  | { ok: true; workbench: Workbench; version: string }
  | { ok: false; lockedBy: string | null; message: string };

/**
 * A fingerprint of the saved draft (a published session's revision, or the published plan if there's
 * none): if it's changed by the time the edits are saved, someone else saved in between.
 */
function draftVersion(w: Workbench): string {
  const plan = w.revision?.plan ?? w.plan;
  const links = w.revision?.links ?? w.links;
  return createHash("sha256").update(canonical(normalisePlan(plan))).update(canonical(links)).digest("hex");
}

/** Take the lock if it's free, stale, or already ours. */
async function takeLock(userId: string, id: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const { data } = await createAdminClient()
    .from("worship_sessions")
    .update({ locked_by: userId, locked_at: new Date().toISOString() })
    .eq("id", id)
    .or(`locked_by.is.null,locked_by.eq.${userId},locked_at.lt.${staleBefore}`)
    .select("id");
  return Boolean(data?.length);
}

async function busyMessage(userId: string, id: string) {
  const loaded = await loadWorkbench(id, userId);
  const name = loaded?.workbench.lockedBy?.name ?? "The other worship leader";
  return `${name} is editing this session. Try again once they're done.`;
}

/**
 * Start editing: take the lock and return the latest draft to edit (for a published session, its
 * revision, or a fresh copy of the published plan if there's none).
 */
export async function acquireLock(id: string): Promise<LockResult> {
  try {
    const user = await signedIn();
    await editablePlan(user, id);
    const locked = await takeLock(user.id, id);
    const loaded = await loadWorkbench(id, user.id, { withRevision: true });
    if (!loaded) return { ok: false, lockedBy: null, message: "This session doesn't exist any more." };
    if (!locked) {
      const name = loaded.workbench.lockedBy?.name ?? "The other worship leader";
      return { ok: false, lockedBy: name, message: `${name} is editing this session. You can edit once they're done.` };
    }
    return { ok: true, workbench: loaded.workbench, version: draftVersion(loaded.workbench) };
  } catch (e) {
    return { ok: false, lockedBy: null, message: message(e) };
  }
}

/** Keep our lock alive. False if someone else has it now (ours went stale). */
export async function renewLock(id: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const { data } = await createAdminClient()
    .from("worship_sessions")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("locked_by", user.id)
    .select("id");
  return Boolean(data?.length);
}

/**
 * Stop editing without saving (the × , "Don't save", or leaving the page mid-edit): the edits are
 * thrown away and the session is unlocked.
 */
export async function releaseLock(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await createAdminClient().from("worship_sessions").update({ locked_by: null, locked_at: null }).eq("id", id).eq("locked_by", user.id);
  after(() => sweepSessionUploads(id));
  revalidatePath(`/sessions/${id}`);
  revalidatePath("/sessions/build");
}

// ---------------------------------------------------------------------------
// Saving and publishing
// ---------------------------------------------------------------------------

/** lostLock: the edits couldn't be saved because the other worship leader is editing or saved since. */
export type SaveResult = { ok: true; savedAt: string } | { ok: false; lostLock: boolean; message: string };

const TYPES: SongType[] = ["praise", "worship", "praise_worship"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const id = (v: unknown) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error("The plan couldn't be read. Reload the page.");
  return v;
};

/** Check and tidy a list of links sent from the browser (a song's, or the whole session's). */
function cleanLinks(raw: unknown[]): PlanLink[] {
  const links = (raw as PlanLink[])
    .map((l) => ({ label: str(l?.label, 120), url: str(l?.url, 500) }))
    .filter((l) => l.url || l.label)
    .slice(0, 20);
  for (const l of links) {
    if (l.url && !/^https?:\/\//i.test(l.url)) throw new Error(`Links must start with http:// or https:// (${l.url}).`);
  }
  return links;
}

/** The whole session's links sent from the browser: only ones with an address. */
const cleanSessionLinks = (raw: unknown): PlanLink[] => (Array.isArray(raw) ? cleanLinks(raw).filter((l) => l.url) : []);

/** Check and tidy a plan sent from the browser. */
function cleanPlan(raw: unknown): PlanSection[] {
  if (!Array.isArray(raw) || raw.length > 30) throw new Error("The plan couldn't be read. Reload the page.");
  return raw.map((s): PlanSection => {
    const items = Array.isArray(s?.items) ? s.items : [];
    if (items.length > 40) throw new Error("A section can have at most 40 items.");
    return {
      id: id(s.id),
      name: str(s.name, 80) || "Section",
      items: items.map((i: Record<string, unknown>): PlanItem => {
        const bpm = i.bpm === null || i.bpm === "" || i.bpm === undefined ? null : Number(i.bpm);
        const links = Array.isArray(i.links) ? cleanLinks(i.links) : null;
        return {
          id: id(i.id),
          kind: i.kind === "transition" ? "transition" : "song",
          song_id: i.song_id ? id(i.song_id) : null,
          lead_id: i.lead_id ? id(i.lead_id) : null,
          title: str(i.title, 200),
          type: TYPES.includes(i.type as SongType) ? (i.type as SongType) : null,
          bpm: bpm !== null && Number.isFinite(bpm) && bpm > 0 && bpm < 400 ? Math.round(bpm * 10) / 10 : null,
          key: str(i.key, 20) || null,
          // A key change only for a song with a key, and to a different one.
          transpose_to:
            i.kind !== "transition" && str(i.key, 20) && majorKey(str(i.transpose_to, 20)) && majorKey(str(i.transpose_to, 20)) !== majorKey(str(i.key, 20))
              ? majorKey(str(i.transpose_to, 20))
              : null,
          artist: str(i.artist, 200) || null,
          sequence: Array.isArray(i.sequence) ? cleanSteps(i.sequence) : null,
          custom_elements: Array.isArray(i.custom_elements)
            ? [...new Set((i.custom_elements as unknown[]).map((x) => str(x, 40)).filter(Boolean))].slice(0, 30)
            : [],
          links,
          notes: str(i.notes, 2000),
          // An attached songsheet is for a typed-in song, not one from the bank.
          sheet: i.kind !== "transition" && !i.song_id ? cleanSheet(i.sheet) : null,
        };
      }),
    };
  });
}

/** Check a plan from the browser against the library and the band, dropping what no longer fits. */
async function tidyPlan(row: { roster_session_id: string | null }, rawPlan: unknown): Promise<PlanSection[]> {
  const plan = cleanPlan(rawPlan);
  const db = createAdminClient();
  // Song bank links that went missing (song deleted) are dropped rather than failing the save.
  const songIds = [...new Set(plan.flatMap((s) => s.items.map((i) => i.song_id)).filter((x): x is string => Boolean(x)))];
  if (songIds.length) {
    const { data } = await db.from("songs").select("id").in("id", songIds);
    const known = new Set((data ?? []).map((s) => s.id));
    for (const s of plan) for (const i of s.items) if (i.song_id && !known.has(i.song_id)) i.song_id = null;
  }
  // A song is led by one of the session's worship leaders or vocalists.
  if (plan.some((s) => s.items.some((i) => i.lead_id))) {
    const { data } = row.roster_session_id
      ? await db.from("roster_assignments").select("member_id").eq("session_id", row.roster_session_id).in("role", [WL, "vocalist"])
      : { data: [] };
    const singers = new Set((data ?? []).map((a) => a.member_id));
    for (const s of plan) for (const i of s.items) if (i.lead_id && (i.kind !== "song" || !singers.has(i.lead_id))) i.lead_id = null;
  }
  return plan;
}

/** The published plan as it's stored, in the editor's shape. */
async function publishedPlan(id: string): Promise<PlanSection[]> {
  const { data } = await createAdminClient()
    .from("worship_session_sections")
    .select("id, name, position, worship_session_items(id, position, kind, song_id, lead_id, title, type, bpm, key, artist, sequence, custom_elements, links, notes, sheet, transpose_to)")
    .eq("session_id", id);
  return normalisePlan(data ?? []);
}

/** The published session links. */
async function publishedLinks(id: string): Promise<PlanLink[]> {
  const { data } = await createAdminClient().from("worship_sessions").select("links").eq("id", id).single();
  return sessionLinks(data?.links);
}

/** JSON with keys sorted, so two plans compare equal however their keys were stored (jsonb reorders them). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
const sameAs = (a: PlanSection[], b: PlanSection[]) => canonical(normalisePlan(a)) === canonical(normalisePlan(b));
const sameLinks = (a: PlanLink[], b: PlanLink[]) => canonical(a) === canonical(b);

const revalidateSession = (id: string) => {
  revalidatePath("/sessions");
  revalidatePath("/sessions/build");
  revalidatePath(`/sessions/${id}`);
};

/**
 * The floppy disk: save the edits to the draft and stop editing (the lock is let go). For a
 * session never published, the draft is the plan itself. For a published one it's the revision:
 * the band keeps seeing the published plan until it's published again.
 *
 * Also the autosave when the lock lapsed (e.g. the phone slept past the 2-minute timeout): if
 * nobody else took it, it's taken back and the edits are saved. If the other worship leader is
 * editing now, or saved while they were away (version: the draft they started from, from
 * acquireLock), saving would overwrite that work, so the edits are dropped instead.
 */
export async function saveDraft(id: string, rawPlan: unknown, rawLinks: unknown, version: string | null): Promise<SaveResult> {
  try {
    const user = await signedIn();
    const row = await editablePlan(user, id);
    if (!(await takeLock(user.id, id))) {
      const loaded = await loadWorkbench(id, user.id);
      const name = loaded?.workbench.lockedBy?.name ?? "The other worship leader";
      return { ok: false, lostLock: true, message: `${name} started editing while you were away, so your changes couldn't be saved.` };
    }
    const current = await loadWorkbench(id, user.id, { withRevision: true });
    if (!current || draftVersion(current.workbench) !== version) {
      await createAdminClient().from("worship_sessions").update({ locked_by: null, locked_at: null }).eq("id", id).eq("locked_by", user.id);
      revalidateSession(id);
      return { ok: false, lostLock: true, message: "Someone else saved this session while you were away, so your changes couldn't be saved." };
    }
    const plan = await tidyPlan(row, rawPlan);
    const links = cleanSessionLinks(rawLinks);
    const db = createAdminClient();
    const now = new Date().toISOString();
    if (row.status === "published") {
      // Saved back to exactly the published plan and links: there's no revision any more.
      const [before, beforeLinks] = await Promise.all([publishedPlan(id), publishedLinks(id)]);
      const revised = !sameAs(plan, before) || !sameLinks(links, beforeLinks);
      const { error } = await db
        .from("worship_sessions")
        .update({
          draft_plan: revised ? plan : null,
          draft_links: revised ? links : null,
          draft_updated_at: revised ? now : null,
          draft_updated_by: revised ? user.id : null,
        })
        .eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await db.rpc("save_worship_session_plan", { p_session_id: id, p_user_id: user.id, p_plan: plan });
      if (error) throw error;
      const { error: linksErr } = await db.from("worship_sessions").update({ links }).eq("id", id);
      if (linksErr) throw linksErr;
    }
    await db.from("worship_sessions").update({ locked_by: null, locked_at: null }).eq("id", id).eq("locked_by", user.id);
    after(() => sweepSessionUploads(id));
    revalidateSession(id);
    revalidatePath("/home");
    return { ok: true, savedAt: now };
  } catch (e) {
    return { ok: false, lostLock: false, message: message(e) };
  }
}

/**
 * Publish the saved draft so the band sees it. The first time, the session just goes live. After
 * that, the revision replaces the published plan, and the band is told what changed.
 */
export async function publishSession(id: string): Promise<SaveResult> {
  try {
    const user = await signedIn();
    const row = await editablePlan(user, id);
    if (!(await takeLock(user.id, id))) return { ok: false, lostLock: false, message: await busyMessage(user.id, id) };
    const db = createAdminClient();
    const now = new Date().toISOString();
    try {
      if (row.status !== "published") {
        const { error } = await db.from("worship_sessions").update({ status: "published", published_at: now, published_by: user.id }).eq("id", id);
        if (error) throw error;
      } else {
        const { data: s } = await db.from("worship_sessions").select("draft_plan, draft_links, links").eq("id", id).single();
        if (!Array.isArray(s?.draft_plan)) return { ok: false, lostLock: false, message: "There are no changes to publish." };
        const before = await publishedPlan(id);
        const after_ = normalisePlan(s.draft_plan);
        const leadIds = [...new Set(after_.flatMap((sec) => sec.items.flatMap((i) => (i.lead_id ? [i.lead_id] : []))))];
        const { data: leads } = leadIds.length ? await db.from("profiles").select("id, full_name, email").in("id", leadIds) : { data: [] };
        const leadName = new Map((leads ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));
        // A revision saved before session links existed keeps the published ones.
        const linksBefore = sessionLinks(s.links);
        const linksAfter = sessionLinks(s.draft_links ?? s.links);
        const changes = [...describeLinkChanges(linksBefore, linksAfter), ...describePlanChanges(before, after_, (lid) => leadName.get(lid) ?? null)];

        const { error } = await db.rpc("save_worship_session_plan", { p_session_id: id, p_user_id: user.id, p_plan: after_ });
        if (error) throw error;
        const { error: upErr } = await db
          .from("worship_sessions")
          .update({ links: linksAfter, draft_plan: null, draft_links: null, draft_updated_at: null, draft_updated_by: null, published_at: now, published_by: user.id })
          .eq("id", id);
        if (upErr) throw upErr;
        await db.from("worship_session_revisions").insert({ session_id: id, published_at: now, published_by: user.id, changes });
        // "Session for … has been updated", in the band's updates.
        if (row.roster_session_id) {
          await db.from("roster_updates").insert({ kind: "session_updated", session_id: row.roster_session_id, actor_id: user.id });
          // The media crews serving at it (standard services, or linked ad hoc ones) hear too: their
          // own session's update, opening the plan on their Projection page (detail: the plan's id).
          const crews = await crewSessionsFor(row.roster_session_id);
          if (crews.length) {
            await db.from("roster_updates").insert(crews.map((c) => ({ kind: "session_updated", session_id: c, actor_id: user.id, detail: id })));
          }
          revalidatePath("/roster", "layout");
        }
      }
    } finally {
      await db.from("worship_sessions").update({ locked_by: null, locked_at: null }).eq("id", id).eq("locked_by", user.id);
    }
    // Transpose the songsheets once the response has gone, so publishing stays quick. Anything
    // not ready (or that fails) is made when someone opens it.
    after(async () => {
      await sweepSessionUploads(id);
      await prepareSessionSongsheets(id);
    });
    revalidateSession(id);
    revalidatePath("/home");
    return { ok: true, savedAt: now };
  } catch (e) {
    return { ok: false, lostLock: false, message: message(e) };
  }
}

/** The back arrow: throw the revision away, so the draft is a copy of the published plan again. */
export async function revertToPublished(id: string): Promise<SaveResult> {
  try {
    const user = await signedIn();
    await editablePlan(user, id);
    if (!(await takeLock(user.id, id))) return { ok: false, lostLock: false, message: await busyMessage(user.id, id) };
    const { error } = await createAdminClient()
      .from("worship_sessions")
      .update({ draft_plan: null, draft_links: null, draft_updated_at: null, draft_updated_by: null, locked_by: null, locked_at: null })
      .eq("id", id);
    if (error) throw error;
    after(() => sweepSessionUploads(id));
    revalidateSession(id);
    return { ok: true, savedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, lostLock: false, message: message(e) };
  }
}

/** Close the "what changed" box: these revisions aren't shown to this person again. */
export async function dismissPlanChanges(revisionIds: string[]): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const ids = revisionIds.filter((x) => UUID.test(x)).slice(0, 20);
  if (!ids.length) return;
  await createAdminClient()
    .from("worship_session_revision_dismissals")
    .upsert(
      ids.map((revision_id) => ({ revision_id, member_id: user.id })),
      { onConflict: "revision_id,member_id", ignoreDuplicates: true },
    );
}

/** The person has looked at Sessions: plans published before now aren't new to them any more. */
export async function markSessionsSeen(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await createAdminClient().from("profiles").update({ sessions_seen_at: new Date().toISOString() }).eq("id", user.id);
}

// ---------------------------------------------------------------------------
// Song bank details for the side panel
// ---------------------------------------------------------------------------

export type BankSongDetail = {
  id: string;
  title: string;
  artist: string | null;
  type: SongType | null;
  bpm: number | null;
  timeSignature: string | null;
  key: string | null;
  keyDisplay: string | null;
  /** The sequence on the song's page, or else the order of sections the scanner found on the songsheet. */
  sequence: string[];
  /** The same, as steps: with the tags, linked instruments and comments set on the song's page. */
  steps: SeqStep[];
  /** Every section the scanner found on the songsheet (Verse 1, Chorus, Bridge, ...), to build a sequence from. */
  elements: string[];
  links: PlanLink[];
  notes: string;
  versionId: string | null;
  previewPages: number | null;
};

export async function getSongDetail(songId: string): Promise<BankSongDetail | null> {
  const user = await signedIn();
  if (!user.can("songs.view")) throw new Error("You don't have access to the song library.");
  const db = createAdminClient();
  const [{ data: s }, { data: versions }, { data: links }] = await Promise.all([
    db.from("songs").select("id, title, artist, type, bpm, time_signature, original_key, standard_sequence, standard_steps, sections, notes").eq("id", songId).maybeSingle(),
    db
      .from("song_versions")
      .select("id, keys, key_display, preview_pages, chart_sequence:scan->chart_sequence")
      .eq("song_id", songId)
      .order("created_at", { ascending: false })
      .limit(1),
    db.from("song_links").select("label, url").eq("song_id", songId).order("position"),
  ]);
  if (!s) return null;
  const v = versions?.[0] as { id: string; keys: string[]; key_display: string | null; preview_pages: number | null; chart_sequence: string[] | null } | undefined;
  const standard = (s.standard_sequence as string[]) ?? [];
  const steps = songSteps(s.standard_steps, standard.length ? standard : (v?.chart_sequence ?? []));
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    type: s.type as SongType | null,
    bpm: s.bpm === null ? null : Number(s.bpm),
    timeSignature: s.time_signature,
    key: v?.keys?.[0] ?? s.original_key ?? null,
    keyDisplay: v?.key_display ?? null,
    sequence: standard.length ? standard : (v?.chart_sequence ?? []),
    steps,
    elements: [...new Set([...((s.sections as string[]) ?? []), ...standard, ...(v?.chart_sequence ?? [])])],
    links: (links ?? []).map((l) => ({ label: l.label, url: l.url })),
    notes: s.notes ?? "",
    versionId: v?.id ?? null,
    previewPages: v?.preview_pages ?? null,
  };
}

// ---------------------------------------------------------------------------
// The worship leader's own songsheets
// ---------------------------------------------------------------------------

export type AttachResult = { ok: true; sheet: UploadedSheet; scan: SheetScan | null } | { ok: false; message: string };

/**
 * Attach a songsheet (PDF or .docx) to a song in this session, while editing it. It's stored with
 * the session straight away (the band sees it once the plan is published); a .docx is scanned so
 * the song's details can be filled in from it.
 */
export async function attachSessionSheet(id: string, formData: FormData): Promise<AttachResult> {
  try {
    const user = await signedIn();
    if (!UUID.test(id)) throw new Error("This session doesn't exist any more.");
    const row = await editablePlan(user, id);
    if (row.locked_by !== user.id) throw new Error("You're not editing this session any more. Reload the page.");
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("Choose a PDF or Word (.docx) songsheet.");
    const problem = sessionSheetProblem(file);
    if (problem) throw new Error(problem);
    const fromKey = formData.get("from_key");
    const { sheet, scan } = await storeSessionSheet(id, file, typeof fromKey === "string" ? fromKey : null);
    return { ok: true, sheet, scan };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

/** The key the scanner reads from a Word songsheet, to show before it's attached (null if it can't tell). */
export async function readSessionSheetKey(id: string, formData: FormData): Promise<{ ok: true; key: string | null } | { ok: false; message: string }> {
  try {
    const user = await signedIn();
    if (!UUID.test(id)) throw new Error("This session doesn't exist any more.");
    await editablePlan(user, id);
    const file = formData.get("file");
    if (!(file instanceof File) || /\.pdf$/i.test(file.name)) throw new Error("Choose a Word (.docx) songsheet.");
    const problem = sessionSheetProblem(file);
    if (problem) throw new Error(problem);
    return { ok: true, key: await readSheetKey(file) };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}
