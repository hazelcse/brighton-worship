"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanAbsence, declineAbsence, type AbsenceInput } from "@/lib/absence";
import {
  BAND_ROLES,
  absenceClashes,
  askHandover,
  awayFor,
  bandRoleCandidates,
  bandRoleLabel,
  coverCandidates,
  flagMissingBandRole,
  handOverBandRoles,
  planBandRoles,
  releaseCoverAfterAbsence,
  resolveUpdates,
  swapOptions,
  type AbsenceClash,
  type BandRolePick,
  type SwapOption,
} from "@/lib/serving";

export type ServeResult = { ok: boolean; message: string | null };

const MAX_REASON = 80;

function fail(e: unknown): ServeResult {
  if (e instanceof PlaceTaken) return gone(e.message);
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
}

async function signedIn() {
  const user = await getCurrentUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (!user.can("roster.view")) throw new Error("You don't have access to the roster.");
  return user;
}

function done(message: string | null = null): ServeResult {
  revalidatePath("/roster", "layout");
  return { ok: true, message };
}

/**
 * The request is no longer there to answer (covered another way, or withdrawn): say so and refresh
 * the page, so the stale item disappears instead of staying clickable.
 */
const GONE = "Someone has already covered this, or it was withdrawn.";
function gone(message = GONE): ServeResult {
  revalidatePath("/roster", "layout");
  return { ok: false, message };
}

/** Thrown when the place someone was claiming has just been filled by another request. */
class PlaceTaken extends Error {
  constructor(message = GONE) {
    super(message);
  }
}

type Db = ReturnType<typeof createAdminClient>;

async function logUpdate(
  db: Db,
  row: { kind: string; session_id: string; role: string; actor_id: string; member_id?: string | null; reason?: string | null; other_session_id?: string | null },
) {
  await db.from("roster_updates").insert(row);
}

const now = () => new Date().toISOString();

async function canCover(sessionId: string, role: string, requesterId: string, coverer: string) {
  return (await coverCandidates(sessionId, role, requesterId)).some((c) => c.id === coverer);
}

async function checkSwap(
  requesterId: string,
  counterpartId: string,
  sessionId: string,
  offerSessionId: string,
  alsoAway?: { startsOn: string; endsOn: string },
) {
  const options = await swapOptions(requesterId, counterpartId, sessionId, alsoAway);
  if (!options.some((o) => o.id === offerSessionId)) throw new Error("That session can't be swapped. Pick another date.");
}

/** Replace any proposal still waiting between these two, then propose this one. */
async function propose(db: Db, cover: { id: string; session_id: string; role: string; member_id: string }, counterpartId: string, offerSessionId: string, by: string) {
  await db
    .from("swap_proposals")
    .update({ status: "replaced", closed_at: now() })
    .eq("cover_id", cover.id)
    .eq("counterpart_id", counterpartId)
    .eq("status", "pending");
  const { error } = await db
    .from("swap_proposals")
    .insert({ cover_id: cover.id, counterpart_id: counterpartId, offer_session_id: offerSessionId, proposed_by: by });
  if (error) throw error;
  await logUpdate(db, {
    kind: "swap_proposed",
    session_id: cover.session_id,
    other_session_id: offerSessionId,
    role: cover.role,
    actor_id: by,
    member_id: by === counterpartId ? cover.member_id : counterpartId,
  });
}

/** Cover is only ever asked of one person directly: there's no posting to the requests board. */
const CHOOSE = "Choose who to ask.";
const chosen = (targetId: unknown): targetId is string => typeof targetId === "string" && targetId.length > 0;

/**
 * Ask one person directly to cover. Returns the new request. Each person has at most one direct
 * request per session open at a time.
 * `withSwap`: a swap is proposed with it straight away, so its "proposed a swap" update stands for
 * the ask and no separate "asked to take over" update is logged.
 */
async function openCover(db: Db, memberId: string, sessionId: string, role: string, targetId: string, withSwap = false) {
  if (!chosen(targetId)) throw new Error(CHOOSE);
  if (!(await canCover(sessionId, role, memberId, targetId))) {
    throw new Error("That person can't cover this session. Pick someone else.");
  }
  const { data: open } = await db
    .from("cover_requests")
    .select("target_id")
    .eq("session_id", sessionId)
    .eq("member_id", memberId)
    .eq("status", "open");
  if ((open ?? []).some((c) => Boolean(c.target_id))) {
    throw new Error("You already have a direct request for this session. Edit it instead.");
  }
  // A direct ask that was turned down is replaced by the new one.
  await db
    .from("cover_requests")
    .update({ status: "cancelled", closed_at: now() })
    .eq("session_id", sessionId)
    .eq("member_id", memberId)
    .eq("status", "refused");
  const { data, error } = await db
    .from("cover_requests")
    .insert({ session_id: sessionId, member_id: memberId, role, target_id: targetId })
    .select("id, session_id, role, member_id")
    .single();
  if (error) throw error;
  if (!withSwap) {
    await logUpdate(db, { kind: "asked", session_id: sessionId, role, actor_id: memberId, member_id: targetId });
  }
  return data;
}

/**
 * Close everything still open for this place once it's been covered: other direct requests and
 * board posts, and every swap proposal on them (including the covered request's own).
 */
async function closeOthers(db: Db, sessionId: string, memberId: string) {
  const { data: all } = await db.from("cover_requests").select("id").eq("session_id", sessionId).eq("member_id", memberId);
  const allIds = (all ?? []).map((c) => c.id);
  if (allIds.length) await db.from("swap_proposals").update({ status: "closed", closed_at: now() }).in("cover_id", allIds).eq("status", "pending");
  await db
    .from("cover_requests")
    .update({ status: "cancelled", closed_at: now() })
    .eq("session_id", sessionId)
    .eq("member_id", memberId)
    .in("status", ["open", "refused"]);
}

/** Put someone on a session in place of someone else, already confirmed. */
async function replace(db: Db, sessionId: string, fromId: string, toId: string, role: string) {
  const { data: moved, error } = await db
    .from("roster_assignments")
    .update({ member_id: toId })
    .eq("session_id", sessionId)
    .eq("member_id", fromId)
    .eq("role", role)
    .select("id, also_roles");
  if (error) throw error;
  // The update only matches while they're still on that place, so of two requests answered at the
  // same moment only one can move them: the other ends up here.
  if (!moved?.length) throw new PlaceTaken();
  await settleBandRoles(db, sessionId, moved[0]!.id as string, ((moved[0]!.also_roles as string[] | null) ?? []), fromId, toId);
  const { data: session } = await db.from("roster_sessions").select("roster_id").eq("id", sessionId).single();
  await db.from("serve_requests").delete().eq("session_id", sessionId).eq("member_id", fromId);
  await db.from("serve_requests").upsert(
    { roster_id: session!.roster_id, session_id: sessionId, member_id: toId, role, status: "accepted", responded_at: now() },
    { onConflict: "session_id,member_id" },
  );
}

/**
 * Someone new has just taken a place that came with band leader / talkback. They take over each role
 * they can do that nobody's already been asked to take over (that's sorted, if root and admins were
 * told it was missing); the rest come off, and root and admins hear if the band is now without one
 * it needs.
 */
async function settleBandRoles(db: Db, sessionId: string, rowId: string, also: string[], fromId: string, toId: string) {
  const held = also.filter((r) => BAND_ROLES.includes(r));
  if (!held.length) return;
  const [{ data: newcomer }, { data: open }] = await Promise.all([
    db.from("profiles").select("instruments").eq("id", toId).maybeSingle(),
    db.from("handover_requests").select("role").eq("session_id", sessionId).eq("status", "open"),
  ]);
  const can = new Set((newcomer?.instruments as string[] | null) ?? []);
  const asked = new Set((open ?? []).map((h) => h.role as string));
  const drop = held.filter((r) => !can.has(r) || asked.has(r));
  for (const r of held.filter((x) => !drop.includes(x))) {
    await resolveUpdates(db, { sessionId, role: r, kinds: ["band_role_missing", "band_role_refused"] });
  }
  if (!drop.length) return;
  await db.from("roster_assignments").update({ also_roles: also.filter((r) => !drop.includes(r)) }).eq("id", rowId);
  for (const r of drop) if (!asked.has(r)) await flagMissingBandRole(db, sessionId, r, fromId);
}

// ---------------------------------------------------------------------------
// Answering "can you serve?"
// ---------------------------------------------------------------------------

/** Tick: they'll serve. */
export async function acceptServe(requestId: string): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const { data, error } = await db
      .from("serve_requests")
      .update({ status: "accepted", responded_at: now() })
      .eq("id", requestId)
      .eq("member_id", user.id)
      .eq("status", "pending")
      .select("id");
    if (error) throw error;
    if (!data?.length) return { ok: false, message: "This request has already been answered." };
  } catch (e) {
    return fail(e);
  }
  return done();
}

/** Sessions of the person being asked that the viewer could take in return (for "can't serve"). */
export async function swapOptionsForRequest(requestId: string, counterpartId: string): Promise<SwapOption[]> {
  const user = await signedIn();
  const { data: req } = await createAdminClient()
    .from("serve_requests")
    .select("session_id")
    .eq("id", requestId)
    .eq("member_id", user.id)
    .maybeSingle();
  if (!req) return [];
  return swapOptions(user.id, counterpartId, req.session_id);
}

/**
 * X: they can't serve. Marks them away that day, then asks someone directly (optionally offering
 * a swap for one of that person's sessions).
 */
export async function declineServe(input: {
  requestId: string;
  reason: string;
  targetId: string;
  offerSessionId?: string | null;
  /** Who takes over their band leader / talkback, if they're doing either. */
  bandRoles?: BandRolePick[];
  /** The day(s) they're away: the service day, its rehearsal day, or a range. Missing = the service day. */
  away?: { startsOn: string; endsOn: string } | null;
}): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const reason = String(input.reason ?? "").trim().replace(/\s+/g, " ");
    if (!reason) return { ok: false, message: "Say why you can't serve." };
    if (reason.length > MAX_REASON) return { ok: false, message: `Keep the reason under ${MAX_REASON} characters.` };
    if (!chosen(input.targetId)) return { ok: false, message: CHOOSE };

    const db = createAdminClient();
    const { data: req } = await db
      .from("serve_requests")
      .select("id, session_id, role, status, roster_sessions(date, rehearsal_date)")
      .eq("id", input.requestId)
      .eq("member_id", user.id)
      .maybeSingle();
    if (!req) return { ok: false, message: "That request no longer exists." };
    if (req.status !== "pending") return { ok: false, message: "This request has already been answered." };
    const session = req.roster_sessions as unknown as { date: string; rehearsal_date: string | null };
    const away = declineAbsence(input.away, { service: session.date, rehearsal: session.rehearsal_date });
    if ("error" in away) return { ok: false, message: away.error };
    const { startsOn, endsOn } = away;

    // Check everything first, so nothing is saved if the ask can't go ahead.
    if (!(await canCover(req.session_id, req.role, user.id, input.targetId))) {
      return { ok: false, message: "That person can't cover this session. Pick someone else." };
    }
    if (input.offerSessionId) await checkSwap(user.id, input.targetId, req.session_id, input.offerSessionId);
    const bandPlan = await planBandRoles(req.session_id, user.id, input.bandRoles, db);

    const { error } = await db.from("serve_requests").update({ status: "declined", reason, responded_at: now() }).eq("id", req.id);
    if (error) throw error;
    await logUpdate(db, { kind: "declined", session_id: req.session_id, role: req.role, actor_id: user.id, reason });

    // An absence for the chosen day(s), unless one already covers them all.
    const { data: already } = await db
      .from("absences")
      .select("id")
      .eq("member_id", user.id)
      .lte("starts_on", startsOn)
      .gte("ends_on", endsOn)
      .limit(1);
    if (!already?.length) {
      const { data: absence, error: aErr } = await db
        .from("absences")
        .insert({ member_id: user.id, starts_on: startsOn, ends_on: endsOn, reason })
        .select("id")
        .single();
      if (aErr) throw aErr;
      await db.from("audit_log").insert({ actor_id: user.id, action: "absence.create", target: absence.id, details: { startsOn, endsOn, reason } });
    }

    // Band leader / talkback first, then the instrument the usual way.
    await handOverBandRoles(db, req.session_id, user.id, bandPlan);
    const cover = await openCover(db, user.id, req.session_id, req.role, input.targetId, Boolean(input.offerSessionId));
    if (input.offerSessionId) await propose(db, cover, input.targetId, input.offerSessionId, user.id);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster/schedule");
  return done("Sent. You'll see here if they say no.");
}

// ---------------------------------------------------------------------------
// Covering: take over or swap
// ---------------------------------------------------------------------------

async function openCoverFor(db: Db, coverId: string) {
  const { data: c } = await db
    .from("cover_requests")
    .select("id, session_id, member_id, role, target_id, status")
    .eq("id", coverId)
    .maybeSingle();
  if (!c || c.status !== "open") throw new PlaceTaken();
  return c;
}

/** Take someone's place: they come off the roster and you go on. */
export async function takeOver(coverId: string): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const c = await openCoverFor(db, coverId);
    if (c.target_id && c.target_id !== user.id) return { ok: false, message: "This was sent to someone else." };
    if (c.member_id === user.id) return { ok: false, message: "This is your own request." };
    if (!(await canCover(c.session_id, c.role, c.member_id, user.id))) {
      return {
        ok: false,
        message:
          "You can't cover this: you need to play the part (and any band leader / talkback nobody else in the band can take over), be free that day and not already be serving.",
      };
    }
    // Claim it first so two people can't both take it.
    const { data: claimed } = await db
      .from("cover_requests")
      .update({ status: "taken", taken_by: user.id, closed_at: now() })
      .eq("id", c.id)
      .eq("status", "open")
      .select("id");
    if (!claimed?.length) return gone();
    try {
      await replace(db, c.session_id, c.member_id, user.id, c.role);
    } catch (e) {
      // Another request (e.g. a direct swap) filled this place in the same moment: this one's gone.
      if (e instanceof PlaceTaken) await db.from("cover_requests").update({ status: "cancelled", taken_by: null }).eq("id", c.id);
      throw e;
    }
    await closeOthers(db, c.session_id, c.member_id);
    await logUpdate(db, { kind: "taken", session_id: c.session_id, role: c.role, actor_id: user.id, member_id: c.member_id });
    await resolveUpdates(db, { sessionId: c.session_id, actorId: c.member_id, kinds: ["declined", "posted", "asked", "swap_proposed"] });
  } catch (e) {
    return fail(e);
  }
  return done("You're on the roster for this session.");
}

/** The requester picking which of the other person's sessions they'd take in return. */
export async function swapOptionsForCover(coverId: string, counterpartId: string): Promise<SwapOption[]> {
  const user = await signedIn();
  const { data: c } = await createAdminClient().from("cover_requests").select("session_id, member_id").eq("id", coverId).maybeSingle();
  if (!c || c.member_id !== user.id) return [];
  return swapOptions(user.id, counterpartId, c.session_id);
}

/**
 * Propose a swap date. The coverer proposes one of their own sessions; the requester can propose
 * a different one of the coverer's sessions back. Either way the other person has to approve.
 */
export async function proposeSwap(input: { coverId: string; counterpartId?: string; offerSessionId: string }): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const c = await openCoverFor(db, input.coverId);
    const isRequester = c.member_id === user.id;
    // The coverer always proposes for themselves; the requester names who they're swapping with.
    const counterpartId = isRequester ? input.counterpartId : user.id;
    if (!counterpartId) return { ok: false, message: "Choose who to swap with." };
    if (c.target_id && c.target_id !== counterpartId) return { ok: false, message: "This was sent to someone else." };
    if (!(await canCover(c.session_id, c.role, c.member_id, counterpartId))) {
      return { ok: false, message: isRequester ? "They can't cover this session any more." : "You can't cover this session." };
    }
    await checkSwap(c.member_id, counterpartId, c.session_id, input.offerSessionId);
    await propose(db, c, counterpartId, input.offerSessionId, user.id);
  } catch (e) {
    return fail(e);
  }
  return done("Swap proposed. It goes through once they approve the date.");
}

async function proposalFor(db: Db, proposalId: string, userId: string) {
  const { data: p } = await db
    .from("swap_proposals")
    .select("id, cover_id, counterpart_id, offer_session_id, proposed_by, status, cover_requests(id, session_id, member_id, role, status)")
    .eq("id", proposalId)
    .maybeSingle();
  if (!p || p.status !== "pending") throw new PlaceTaken("This proposal is no longer open.");
  const c = p.cover_requests as unknown as { id: string; session_id: string; member_id: string; role: string; status: string };
  // Only the person who didn't propose answers it.
  const answerer = p.proposed_by === p.counterpart_id ? c.member_id : p.counterpart_id;
  if (answerer !== userId) throw new Error("This proposal is waiting for the other person.");
  return { p, c };
}

/** Approve the proposed date: the two swap sessions. */
export async function acceptSwap(proposalId: string): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const { p, c } = await proposalFor(db, proposalId, user.id);
    if (c.status !== "open") return { ok: false, message: "This request has already been covered." };
    const requester = c.member_id;
    const coverer = p.counterpart_id;
    const { data: theirs } = await db
      .from("roster_assignments")
      .select("role")
      .eq("session_id", p.offer_session_id)
      .eq("member_id", coverer)
      .maybeSingle();
    if (!theirs) return { ok: false, message: "That session has changed. Propose another date." };
    if (!(await canCover(c.session_id, c.role, requester, coverer))) return { ok: false, message: "The swap can't go ahead: they can no longer cover your session." };
    await checkSwap(requester, coverer, c.session_id, p.offer_session_id);

    const { data: claimed } = await db
      .from("cover_requests")
      .update({ status: "taken", taken_by: coverer, swap_session_id: p.offer_session_id, closed_at: now() })
      .eq("id", c.id)
      .eq("status", "open")
      .select("id");
    if (!claimed?.length) return gone();
    try {
      await replace(db, c.session_id, requester, coverer, c.role);
    } catch (e) {
      // Their place was filled another way (e.g. from the board) at the same moment.
      if (e instanceof PlaceTaken) {
        await db.from("cover_requests").update({ status: "cancelled", taken_by: null, swap_session_id: null }).eq("id", c.id);
        await db.from("swap_proposals").update({ status: "closed", closed_at: now() }).eq("id", p.id);
      }
      throw e;
    }
    try {
      await replace(db, p.offer_session_id, coverer, requester, theirs.role);
    } catch (e) {
      // The session offered in return changed: put the first half back so nothing is half-swapped.
      await replace(db, c.session_id, coverer, requester, c.role);
      await db.from("cover_requests").update({ status: "open", taken_by: null, swap_session_id: null, closed_at: null }).eq("id", c.id);
      if (e instanceof PlaceTaken) return { ok: false, message: "That session has changed. Propose another date." };
      throw e;
    }
    await db.from("swap_proposals").update({ status: "accepted", closed_at: now() }).eq("id", p.id);
    await closeOthers(db, c.session_id, requester);
    // If the coverer was looking for cover on the session they gave up, that's settled too.
    await closeOthers(db, p.offer_session_id, coverer);
    await resolveUpdates(db, { sessionId: c.session_id, actorId: requester, kinds: ["declined", "posted", "asked", "swap_proposed"] });
    await resolveUpdates(db, { sessionId: p.offer_session_id, actorId: coverer, kinds: ["declined", "posted", "asked", "swap_proposed"] });
    await logUpdate(db, {
      kind: "swapped",
      session_id: c.session_id,
      other_session_id: p.offer_session_id,
      role: c.role,
      // Whoever approved did it; the other person sees it as new.
      actor_id: user.id,
      member_id: user.id === coverer ? requester : coverer,
    });
  } catch (e) {
    return fail(e);
  }
  return done("Swapped. Both sessions are updated on the roster.");
}

/** Turn a proposed date down. The other person can propose a different one. */
export async function declineSwap(proposalId: string): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const { p, c } = await proposalFor(db, proposalId, user.id);
    await db.from("swap_proposals").update({ status: "declined", closed_at: now() }).eq("id", p.id);
    await logUpdate(db, {
      kind: "swap_declined",
      session_id: c.session_id,
      other_session_id: p.offer_session_id,
      role: c.role,
      actor_id: user.id,
      member_id: p.proposed_by,
    });
  } catch (e) {
    return fail(e);
  }
  return done();
}

/** Asked directly and can't do it. The person who asked can then ask someone else or post it on the board. */
export async function refuseCover(coverId: string): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const { data, error } = await db
      .from("cover_requests")
      .update({ status: "refused", closed_at: now() })
      .eq("id", coverId)
      .eq("target_id", user.id)
      .eq("status", "open")
      .select("session_id, role, member_id");
    if (error) throw error;
    if (!data?.length) return { ok: false, message: "This request is no longer open." };
    await db.from("swap_proposals").update({ status: "closed", closed_at: now() }).eq("cover_id", coverId).eq("status", "pending");
    await logUpdate(db, { kind: "refused", session_id: data[0].session_id, role: data[0].role, actor_id: user.id, member_id: data[0].member_id });
  } catch (e) {
    return fail(e);
  }
  return done();
}

/** The requester's place on a session they've said they can't serve: they must still be on it. */
async function ownPlace(db: Db, userId: string, sessionId: string) {
  const { data } = await db
    .from("roster_assignments")
    .select("role")
    .eq("session_id", sessionId)
    .eq("member_id", userId)
    .maybeSingle();
  if (!data) throw new Error("You're no longer on this session.");
  return data.role as string;
}

/** Stop a request: it disappears for whoever could see it, with any swap proposals on it. */
async function cancelCover(db: Db, coverId: string) {
  const { data } = await db
    .from("cover_requests")
    .update({ status: "cancelled", closed_at: now() })
    .eq("id", coverId)
    .in("status", ["open", "refused"])
    .select("id");
  if (!data?.length) throw new Error("Someone has just covered this.");
  await db.from("swap_proposals").update({ status: "closed", closed_at: now() }).eq("cover_id", coverId).eq("status", "pending");
}

async function ownCover(db: Db, coverId: string, userId: string) {
  const { data: c } = await db
    .from("cover_requests")
    .select("id, session_id, member_id, role, target_id, status")
    .eq("id", coverId)
    .eq("member_id", userId)
    .maybeSingle();
  if (!c || (c.status !== "open" && c.status !== "refused")) throw new Error("This request is no longer open.");
  return c;
}

/**
 * Add a direct request (optionally offering a swap date) for a session the viewer can't serve.
 * Only one can be open at once.
 */
export async function addCover(input: { sessionId: string; targetId: string; offerSessionId?: string | null }): Promise<ServeResult> {
  try {
    if (!chosen(input.targetId)) return { ok: false, message: CHOOSE };
    const user = await signedIn();
    const db = createAdminClient();
    const role = await ownPlace(db, user.id, input.sessionId);
    if (input.offerSessionId) await checkSwap(user.id, input.targetId, input.sessionId, input.offerSessionId);
    const cover = await openCover(db, user.id, input.sessionId, role, input.targetId, Boolean(input.offerSessionId));
    if (input.offerSessionId) await propose(db, cover, input.targetId, input.offerSessionId, user.id);
  } catch (e) {
    return fail(e);
  }
  return done("Sent.");
}

// ---------------------------------------------------------------------------
// Adding an absence on a day they've confirmed they'll serve
// ---------------------------------------------------------------------------

export type CoverChoice = {
  sessionId: string;
  targetId: string;
  offerSessionId?: string | null;
  /** Who takes over their band leader / talkback there, if they're doing either. */
  bandRoles?: BandRolePick[];
};

/** Sessions the person being asked could give the viewer in return, avoiding the absence being added. */
export async function swapOptionsForAbsence(
  sessionId: string,
  counterpartId: string,
  range: { startsOn: string; endsOn: string },
): Promise<SwapOption[]> {
  const user = await signedIn();
  await ownPlace(createAdminClient(), user.id, sessionId);
  return swapOptions(user.id, counterpartId, sessionId, range);
}

/**
 * Add (or change) an absence that falls on sessions the person is serving at, together with a
 * request to cover each one: ask someone directly (optionally offering a swap). Sessions they
 * hadn't answered yet are declined. Everything is checked first, so nothing
 * is saved unless every session gets a request.
 */
export async function saveAbsenceWithCover(input: AbsenceInput & { covers: CoverChoice[] }): Promise<ServeResult & { clashes?: AbsenceClash[] }> {
  try {
    const user = await signedIn();
    const clean = cleanAbsence(input);
    if ("error" in clean) return { ok: false, message: clean.error };
    const { startsOn, endsOn, reason } = clean;
    if (reason === "Absence" && !String(input.reason ?? "").trim()) return { ok: false, message: "Say why you can't serve." };

    const db = createAdminClient();
    let old: { startsOn: string; endsOn: string } | null = null;
    if (input.id) {
      const { data } = await db.from("absences").select("member_id, starts_on, ends_on").eq("id", input.id).maybeSingle();
      if (!data) return { ok: false, message: "That absence no longer exists." };
      if (data.member_id !== user.id) return { ok: false, message: "You can only change your own absences." };
      old = { startsOn: data.starts_on as string, endsOn: data.ends_on as string };
    }

    // Every clashing session needs a request, and each request has to be one that can go ahead.
    const clashes = await absenceClashes(user.id, startsOn, endsOn);
    const range = { startsOn, endsOn };
    const plan: { clash: AbsenceClash; choice: CoverChoice; bandPlan: Awaited<ReturnType<typeof planBandRoles>> }[] = [];
    for (const clash of clashes) {
      const choice = input.covers.find((c) => c.sessionId === clash.session.id);
      if (!choice) return { ok: false, message: "Your sessions on those days have changed. Check them again.", clashes };
      if (!chosen(choice.targetId)) return { ok: false, message: `${clash.session.name}: ${CHOOSE}`, clashes };
      if (!(await canCover(clash.session.id, clash.role, user.id, choice.targetId))) {
        return { ok: false, message: `That person can't cover ${clash.session.name}. Pick someone else.`, clashes };
      }
      if (choice.offerSessionId) await checkSwap(user.id, choice.targetId, clash.session.id, choice.offerSessionId, range);
      let bandPlan;
      try {
        bandPlan = await planBandRoles(clash.session.id, user.id, choice.bandRoles, db);
      } catch (e) {
        return { ok: false, message: `${clash.session.name}: ${e instanceof Error ? e.message : "check who takes over"}`, clashes };
      }
      plan.push({ clash, choice, bandPlan });
    }

    if (input.id) {
      const { error } = await db.from("absences").update({ starts_on: startsOn, ends_on: endsOn, reason, updated_at: now() }).eq("id", input.id);
      if (error) throw error;
      await db.from("audit_log").insert({ actor_id: user.id, action: "absence.update", target: input.id, details: { startsOn, endsOn, reason } });
      // Days it no longer covers: their cover requests come down.
      if (old) await releaseCoverAfterAbsence(user.id, old);
    } else {
      const { data, error } = await db.from("absences").insert({ member_id: user.id, starts_on: startsOn, ends_on: endsOn, reason }).select("id").single();
      if (error) throw error;
      await db.from("audit_log").insert({ actor_id: user.id, action: "absence.create", target: data.id, details: { startsOn, endsOn, reason } });
    }

    for (const { clash, choice, bandPlan } of plan) {
      // Not answered yet: the absence answers "can you serve?" with "can't", as declining would.
      if (clash.unanswered) {
        const { error } = await db
          .from("serve_requests")
          .update({ status: "declined", reason, responded_at: now() })
          .eq("session_id", clash.session.id)
          .eq("member_id", user.id)
          .eq("status", "pending");
        if (error) throw error;
      }
      // Confirmed or not, the rest of the band hears they can't make it.
      await logUpdate(db, { kind: "declined", session_id: clash.session.id, role: clash.role, actor_id: user.id, reason });
      await handOverBandRoles(db, clash.session.id, user.id, bandPlan);
      const cover = await openCover(db, user.id, clash.session.id, clash.role, choice.targetId, Boolean(choice.offerSessionId));
      if (choice.offerSessionId) await propose(db, cover, choice.targetId, choice.offerSessionId, user.id);
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/roster/schedule");
  return done("Absence added, and your requests to cover are out.");
}

/**
 * Change a direct request: ask a different person (the old request is withdrawn), or keep the
 * same person and change the swap date offered.
 */
export async function editDirect(input: { coverId: string; targetId: string; offerSessionId?: string | null }): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const c = await ownCover(db, input.coverId, user.id);
    if (!c.target_id) return { ok: false, message: "This is a board post, not a direct request." };
    if (!input.targetId) return { ok: false, message: "Choose who to ask." };
    if (input.offerSessionId) await checkSwap(user.id, input.targetId, c.session_id, input.offerSessionId);

    if (c.status === "open" && c.target_id === input.targetId) {
      // Same person: only the swap date changes (or nothing, if it's the date already offered).
      const { data: current } = await db
        .from("swap_proposals")
        .select("offer_session_id")
        .eq("cover_id", c.id)
        .eq("proposed_by", user.id)
        .eq("status", "pending")
        .maybeSingle();
      if ((current?.offer_session_id ?? null) === (input.offerSessionId || null)) return done("Nothing changed.");
      if (input.offerSessionId) await propose(db, c, input.targetId, input.offerSessionId, user.id);
      else {
        await db
          .from("swap_proposals")
          .update({ status: "closed", closed_at: now() })
          .eq("cover_id", c.id)
          .eq("proposed_by", user.id)
          .eq("status", "pending");
        // The swap is off: it's now a plain ask to take over, so tell them (a new update, so it
        // shows as new; the "proposed a swap" before it stays as history).
        await logUpdate(db, { kind: "asked", session_id: c.session_id, role: c.role, actor_id: user.id, member_id: input.targetId });
      }
      return done("Updated.");
    }
    if (!(await canCover(c.session_id, c.role, user.id, input.targetId))) {
      return { ok: false, message: "That person can't cover this session. Pick someone else." };
    }
    await cancelCover(db, c.id);
    await logUpdate(db, { kind: "cancelled", session_id: c.session_id, role: c.role, actor_id: user.id, member_id: c.target_id });
    const cover = await openCover(db, user.id, c.session_id, c.role, input.targetId, Boolean(input.offerSessionId));
    if (input.offerSessionId) await propose(db, cover, input.targetId, input.offerSessionId, user.id);
  } catch (e) {
    return fail(e);
  }
  return done("Sent.");
}

/** Take a direct request or board post down. */
export async function takeDownCover(coverId: string): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const c = await ownCover(db, coverId, user.id);
    // The last request for a session they're still away for can't come down: it's what says they
    // can't make it. They ask someone directly instead, or delete the absence.
    const { data: others } = await db
      .from("cover_requests")
      .select("id")
      .eq("session_id", c.session_id)
      .eq("member_id", user.id)
      .in("status", ["open", "refused"])
      .neq("id", c.id)
      .limit(1);
    if (!others?.length && (await awayFor(db, user.id, c.session_id))) {
      return { ok: false, message: AWAY_CLASH };
    }
    await cancelCover(db, c.id);
    await logUpdate(db, { kind: "cancelled", session_id: c.session_id, role: c.role, actor_id: user.id, member_id: c.target_id });
  } catch (e) {
    return fail(e);
  }
  return done(null);
}

/** The updates box was viewed: anything newer than now gets the "new" tint next time. */
export async function markUpdatesSeen(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  // No revalidate: the tint stays for this view and is gone on the next.
  await createAdminClient().from("profiles").update({ updates_seen_at: now() }).eq("id", user.id);
}

// ---------------------------------------------------------------------------
// Band leader / talkback handovers
// ---------------------------------------------------------------------------

async function openHandover(db: Db, id: string) {
  const { data: h } = await db.from("handover_requests").select("id, session_id, role, member_id, target_id, status").eq("id", id).maybeSingle();
  if (!h || h.status !== "open") throw new PlaceTaken("This has already been sorted, or it was withdrawn.");
  return h;
}

/** Take over a bandmate's band leader / talkback: it moves to the instrument you're playing there. */
export async function acceptHandover(id: string): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const h = await openHandover(db, id);
    if (h.target_id !== user.id) return { ok: false, message: "This was sent to someone else." };
    const [{ data: mine }, { data: me }] = await Promise.all([
      db.from("roster_assignments").select("id, role, also_roles").eq("session_id", h.session_id).eq("member_id", user.id).maybeSingle(),
      db.from("profiles").select("instruments").eq("id", user.id).maybeSingle(),
    ]);
    if (!mine || ["worship leader", "vocalist"].includes(mine.role as string)) {
      return { ok: false, message: `You need to be playing an instrument in this session to be ${bandRoleLabel(h.role).toLowerCase()}.` };
    }
    if (!((me?.instruments as string[] | null) ?? []).includes(h.role)) {
      return { ok: false, message: `${bandRoleLabel(h.role)} isn't one of your parts.` };
    }
    // Claim it first so two answers can't both go through.
    const { data: claimed } = await db.from("handover_requests").update({ status: "accepted", closed_at: now() }).eq("id", h.id).eq("status", "open").select("id");
    if (!claimed?.length) throw new PlaceTaken("This has already been sorted, or it was withdrawn.");
    // Off whoever has it now, onto you.
    const { data: holders } = await db.from("roster_assignments").select("id, also_roles").eq("session_id", h.session_id).contains("also_roles", [h.role]);
    for (const row of holders ?? []) {
      if (row.id === mine.id) continue;
      await db.from("roster_assignments").update({ also_roles: ((row.also_roles as string[]) ?? []).filter((r) => r !== h.role) }).eq("id", row.id);
    }
    const also = (mine.also_roles as string[] | null) ?? [];
    if (!also.includes(h.role)) await db.from("roster_assignments").update({ also_roles: [...also, h.role] }).eq("id", mine.id);
    await db.from("handover_requests").update({ status: "cancelled", closed_at: now() }).eq("session_id", h.session_id).eq("role", h.role).eq("status", "open");
    await logUpdate(db, { kind: "band_role_taken", session_id: h.session_id, role: h.role, actor_id: user.id, member_id: h.member_id });
    await resolveUpdates(db, { sessionId: h.session_id, role: h.role, kinds: ["band_role_missing", "band_role_asked", "band_role_refused"] });
  } catch (e) {
    return fail(e);
  }
  return done(null);
}

/** Can't take it over. If nobody else in the band can, root and admins are told. */
export async function refuseHandover(id: string): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const h = await openHandover(db, id);
    if (h.target_id !== user.id) return { ok: false, message: "This was sent to someone else." };
    const { data: claimed } = await db.from("handover_requests").update({ status: "refused", closed_at: now() }).eq("id", h.id).eq("status", "open").select("id");
    if (!claimed?.length) throw new PlaceTaken("This has already been sorted, or it was withdrawn.");
    await logUpdate(db, { kind: "band_role_refused", session_id: h.session_id, role: h.role, actor_id: user.id, member_id: h.member_id });
    const { data: refusers } = await db.from("handover_requests").select("target_id").eq("session_id", h.session_id).eq("role", h.role).eq("status", "refused");
    const left = await bandRoleCandidates(h.session_id, h.role, [h.member_id, ...(refusers ?? []).map((r) => r.target_id as string)], db);
    if (!left.length) await flagMissingBandRole(db, h.session_id, h.role, h.member_id, h.member_id);
  } catch (e) {
    return fail(e);
  }
  return done(null);
}

/** After a "can't": ask someone else in the band to take over the role. */
export async function reaskHandover(input: { sessionId: string; role: string; targetId: string }): Promise<ServeResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const { data: mine } = await db
      .from("handover_requests")
      .select("id")
      .eq("session_id", input.sessionId)
      .eq("role", input.role)
      .eq("member_id", user.id)
      .in("status", ["open", "refused"])
      .limit(1);
    if (!mine?.length) throw new PlaceTaken("This has already been sorted.");
    const candidates = await bandRoleCandidates(input.sessionId, input.role, [user.id], db);
    if (!candidates.some((c) => c.id === input.targetId)) return { ok: false, message: "That person can't take it over. Pick someone else." };
    await askHandover(db, input.sessionId, input.role, user.id, input.targetId);
  } catch (e) {
    return fail(e);
  }
  return done("Sent.");
}

// ---------------------------------------------------------------------------
// Away but still rostered
// ---------------------------------------------------------------------------

const AWAY_CLASH = "Your absence still clashes with this session. Ask someone directly first, or delete the absence.";

/**
 * They're away for a session they're still on: ask someone directly, hand over any band leader /
 * talkback, and mark them as can't serve. With replaceCoverId, that request (e.g. an older board
 * post) comes down once the new one is out.
 */
export async function coverWhileAway(input: {
  sessionId: string;
  targetId: string;
  offerSessionId?: string | null;
  bandRoles?: BandRolePick[];
  replaceCoverId?: string | null;
}): Promise<ServeResult> {
  try {
    if (!chosen(input.targetId)) return { ok: false, message: CHOOSE };
    const user = await signedIn();
    const db = createAdminClient();
    const { data: place } = await db.from("roster_assignments").select("role").eq("session_id", input.sessionId).eq("member_id", user.id).maybeSingle();
    if (!place) throw new PlaceTaken("You're no longer on this session.");
    const away = await awayFor(db, user.id, input.sessionId);
    if (!away) return { ok: false, message: "You don't have an absence on this session any more." };
    const role = place.role as string;

    // Check everything first, so nothing is saved if it can't go ahead.
    if (!(await canCover(input.sessionId, role, user.id, input.targetId))) {
      return { ok: false, message: "That person can't cover this session. Pick someone else." };
    }
    if (input.offerSessionId) await checkSwap(user.id, input.targetId, input.sessionId, input.offerSessionId);
    const bandPlan = await planBandRoles(input.sessionId, user.id, input.bandRoles, db);
    const replacing = input.replaceCoverId ? await ownCover(db, input.replaceCoverId, user.id) : null;
    if (replacing && replacing.session_id !== input.sessionId) return { ok: false, message: "That request is for another session." };

    // "Can't serve", unless that's already said and still standing.
    const { data: req } = await db.from("serve_requests").select("id, status").eq("session_id", input.sessionId).eq("member_id", user.id).maybeSingle();
    if (req && req.status !== "declined") {
      await db.from("serve_requests").update({ status: "declined", reason: away.reason, responded_at: now() }).eq("id", req.id);
    }
    const { data: said } = await db
      .from("roster_updates")
      .select("id")
      .eq("session_id", input.sessionId)
      .eq("actor_id", user.id)
      .eq("kind", "declined")
      .is("resolved_at", null)
      .limit(1);
    if (!said?.length) await logUpdate(db, { kind: "declined", session_id: input.sessionId, role, actor_id: user.id, reason: away.reason });

    await handOverBandRoles(db, input.sessionId, user.id, bandPlan);
    const takeDown = async () => {
      await cancelCover(db, replacing!.id);
      await logUpdate(db, { kind: "cancelled", session_id: replacing!.session_id, role: replacing!.role, actor_id: user.id, member_id: replacing!.target_id });
    };
    // A direct ask replacing a direct ask: the old one has to go first (one at a time).
    const sameKind = replacing && Boolean(replacing.target_id);
    if (sameKind) await takeDown();
    const cover = await openCover(db, user.id, input.sessionId, role, input.targetId, Boolean(input.offerSessionId));
    if (input.offerSessionId) await propose(db, cover, input.targetId, input.offerSessionId, user.id);
    if (replacing && !sameKind) await takeDown();
  } catch (e) {
    return fail(e);
  }
  return done("Sent.");
}
