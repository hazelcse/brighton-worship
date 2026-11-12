"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sessionAccess } from "@/lib/sessions";
import { coverOptions, type CoverCandidate } from "@/lib/serving";
import { defaultRehearsalTime, formatDate, formatTime, hhmm, todayYmd } from "@/lib/roster";

/**
 * A session's worship leaders adding, moving or dropping its rehearsal from the session builder. Band
 * members away on the new day can be asked to be subbed: the request goes out in their name to
 * the person picked, as if they'd asked themselves. Or the worship leader goes ahead without a sub,
 * and they aren't asked to find cover for missing that rehearsal (rehearsal_excusals).
 */

type Db = ReturnType<typeof createAdminClient>;

export type RehearsalAbsence = { id: string; memberId: string; startsOn: string; endsOn: string };

export type RehearsalPlanner = {
  today: string;
  /** The service. */
  date: string;
  kind: string;
  rehearsal: string | null;
  /** "HH:MM" as set, else the usual for its kind and day. */
  time: string | null;
  band: { id: string; name: string; role: string }[];
  /** The band's absences between today and the service. */
  absences: RehearsalAbsence[];
  /** Band members already asking someone to cover them here: they aren't asked about again. */
  covered: string[];
};

export type RehearsalSub = { memberId: string; /** Who to ask; null = go ahead without a sub. */ targetId: string | null };

const now = () => new Date().toISOString();
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isTime = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const day = (d: string) => formatDate(d, { weekday: "short", day: "numeric", month: "short" });

async function signedIn(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  return user;
}

/** The roster session behind a plan, after checking the viewer is one of its worship leaders. */
async function leadersSession(db: Db, user: CurrentUser, planId: string) {
  const { data: plan } = await db.from("worship_sessions").select("id, roster_session_id, status").eq("id", planId).maybeSingle();
  if (!plan) throw new Error("This session doesn't exist any more.");
  if (!(await sessionAccess(user, plan)).canEdit) throw new Error("Only this session's confirmed worship leaders can change its rehearsal.");
  if (!plan.roster_session_id) throw new Error("This session isn't on a roster, so it has no rehearsal.");
  const { data: rs } = await db
    .from("roster_sessions")
    .select("id, date, kind, cancelled, rehearsal_date, rehearsal_time")
    .eq("id", plan.roster_session_id)
    .maybeSingle();
  if (!rs || rs.cancelled) throw new Error("This session isn't on the roster any more.");
  return rs as { id: string; date: string; kind: string | null; cancelled: boolean; rehearsal_date: string | null; rehearsal_time: string | null };
}

async function bandOf(db: Db, sessionId: string) {
  const { data } = await db.from("roster_assignments").select("member_id, role").eq("session_id", sessionId);
  return (data ?? []).map((a) => ({ id: a.member_id as string, role: a.role as string }));
}

/** Band members with a cover request still open (or turned down, waiting for them to ask again) here. */
async function coveredMembers(db: Db, sessionId: string): Promise<Set<string>> {
  const { data } = await db.from("cover_requests").select("member_id").eq("session_id", sessionId).in("status", ["open", "refused"]);
  return new Set((data ?? []).map((c) => c.member_id as string));
}

/** Everything the "Change rehearsal date" popup needs. */
export async function loadRehearsalPlanner(planId: string): Promise<RehearsalPlanner> {
  const user = await signedIn();
  const db = createAdminClient();
  const rs = await leadersSession(db, user, planId);
  const today = todayYmd();
  const band = await bandOf(db, rs.id);
  const ids = band.map((b) => b.id);
  const [{ data: people }, { data: away }, covered] = await Promise.all([
    ids.length ? db.from("profiles").select("id, full_name, email").in("id", ids) : Promise.resolve({ data: [] }),
    ids.length
      ? db.from("absences").select("id, member_id, starts_on, ends_on").in("member_id", ids).lte("starts_on", rs.date).gte("ends_on", today).order("starts_on")
      : Promise.resolve({ data: [] }),
    coveredMembers(db, rs.id),
  ]);
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string) || "Someone"]));
  const kind = rs.kind ?? "custom";
  return {
    today,
    date: rs.date,
    kind,
    rehearsal: rs.rehearsal_date,
    time: rs.rehearsal_date ? (hhmm(rs.rehearsal_time) ?? defaultRehearsalTime(kind, rs.rehearsal_date)) : null,
    band: band.map((b) => ({ ...b, name: nameOf.get(b.id) ?? "Someone" })).sort((a, b) => a.name.localeCompare(b.name)),
    // Only who and when: the reasons stay with the person (and root).
    absences: (away ?? []).map((a) => ({ id: a.id as string, memberId: a.member_id as string, startsOn: a.starts_on as string, endsOn: a.ends_on as string })),
    covered: [...covered],
  };
}

/** Who could sub this band member if the rehearsal moved to `date` (greyed-out ones included, with loads). */
export async function rehearsalSubOptions(planId: string, memberId: string, date: string): Promise<CoverCandidate[]> {
  const user = await signedIn();
  if (!isDay(date)) return [];
  const db = createAdminClient();
  const rs = await leadersSession(db, user, planId);
  const place = (await bandOf(db, rs.id)).find((b) => b.id === memberId);
  if (!place) return [];
  return coverOptions(rs.id, place.role, memberId, db, date);
}

/**
 * Band members away on `date` who'd need a decision (sub or go ahead): not away for the service
 * itself (that's sorted as usual), and not already asking someone to cover them.
 */
async function clashesOn(db: Db, rs: { id: string; date: string }, date: string) {
  const band = await bandOf(db, rs.id);
  if (!band.length) return [];
  const [{ data: away }, covered] = await Promise.all([
    db.from("absences").select("member_id, starts_on, ends_on").in("member_id", band.map((b) => b.id)).lte("starts_on", date >= rs.date ? date : rs.date).gte("ends_on", date <= rs.date ? date : rs.date),
    coveredMembers(db, rs.id),
  ]);
  const on = (id: string, d: string) => (away ?? []).some((a) => a.member_id === id && a.starts_on <= d && a.ends_on >= d);
  return band.filter((b) => on(b.id, date) && !on(b.id, rs.date) && !covered.has(b.id));
}

export type RehearsalResult = { ok: boolean; message: string | null };

/**
 * Move the rehearsal (or remove it: date null), set its time, and for each band member away on the
 * new day either ask the sub picked (in their name) or let them miss it. Everything is checked
 * before anything is saved. The rest of the band is told.
 */
export async function saveRehearsal(input: { planId: string; date: string | null; time: string | null; subs: RehearsalSub[] }): Promise<RehearsalResult> {
  try {
    const user = await signedIn();
    const db = createAdminClient();
    const rs = await leadersSession(db, user, input.planId);
    const today = todayYmd();
    const kind = rs.kind ?? "custom";

    const date = input.date ?? null;
    if (date !== null) {
      if (!isDay(date)) return { ok: false, message: "Pick a rehearsal date." };
      if (date > rs.date) return { ok: false, message: "The rehearsal has to be on or before the service." };
      if (date < today && date !== rs.rehearsal_date) return { ok: false, message: "That day has already passed." };
    }
    const time = date && input.time ? input.time : null;
    if (time !== null && !isTime(time)) return { ok: false, message: "Enter the time as HH:MM." };

    const beforeTime = rs.rehearsal_date ? (hhmm(rs.rehearsal_time) ?? defaultRehearsalTime(kind, rs.rehearsal_date)) : null;
    const moved = date !== rs.rehearsal_date;
    if (!moved && time === beforeTime) return { ok: false, message: "Nothing has changed." };

    // Band members away on the new day: each needs a sub, or to be let off.
    const clashes = date && moved ? await clashesOn(db, rs, date) : [];
    const plan: { memberId: string; role: string; targetId: string | null }[] = [];
    for (const c of clashes) {
      const pick = input.subs.find((s) => s.memberId === c.id);
      if (!pick) return { ok: false, message: "The band's absences have changed. Check them again." };
      if (pick.targetId) {
        const options = await coverOptions(rs.id, c.role, c.id, db, date);
        if (!options.some((o) => o.id === pick.targetId && !o.unavailable)) {
          return { ok: false, message: "One of the subs you picked can't do it any more. Pick someone else." };
        }
      }
      plan.push({ memberId: c.id, role: c.role, targetId: pick.targetId });
    }
    const subIds = plan.flatMap((p) => (p.targetId ? [p.targetId] : []));
    if (new Set(subIds).size !== subIds.length) return { ok: false, message: "You've picked the same person to sub twice." };

    // Save the rehearsal. Its time only stays set when it isn't just the usual one.
    const usual = date ? defaultRehearsalTime(kind, date) : null;
    const { error } = await db
      .from("roster_sessions")
      .update({ rehearsal_date: date, rehearsal_time: time && time !== usual ? time : null })
      .eq("id", rs.id);
    if (error) throw error;
    await db.from("audit_log").insert({ actor_id: user.id, action: "rehearsal.update", target: rs.id, details: { from: rs.rehearsal_date, to: date, time } });

    if (moved) {
      // Let-offs were for the old day.
      await db.from("rehearsal_excusals").delete().eq("session_id", rs.id);
      const letOff = plan.filter((p) => !p.targetId);
      if (letOff.length && date) {
        const { error: e } = await db
          .from("rehearsal_excusals")
          .insert(letOff.map((p) => ({ session_id: rs.id, member_id: p.memberId, rehearsal_date: date, excused_by: user.id })));
        if (e) throw e;
      }
    }

    // Subs: asked in the band member's name, as their own request to cover would be.
    for (const p of plan) {
      if (!p.targetId) continue;
      const reason = `Away for the rehearsal on ${day(date!)}`;
      await db
        .from("serve_requests")
        .update({ status: "declined", reason, responded_at: now() })
        .eq("session_id", rs.id)
        .eq("member_id", p.memberId)
        .neq("status", "declined");
      await db.from("roster_updates").insert({ kind: "declined", session_id: rs.id, role: p.role, actor_id: p.memberId, reason });
      // A direct ask that was turned down is replaced by the new one.
      await db.from("cover_requests").update({ status: "cancelled", closed_at: now() }).eq("session_id", rs.id).eq("member_id", p.memberId).eq("status", "refused");
      const { error: e } = await db.from("cover_requests").insert({ session_id: rs.id, member_id: p.memberId, role: p.role, target_id: p.targetId });
      if (e) throw e;
      await db.from("roster_updates").insert({ kind: "asked", session_id: rs.id, role: p.role, actor_id: p.memberId, member_id: p.targetId });
    }

    // Tell the rest of the band.
    const detail = !date
      ? "no rehearsal any more"
      : !rs.rehearsal_date
        ? `rehearsal added: ${day(date)}${time ? ` at ${formatTime(time)}` : ""}`
        : moved
        ? `rehearsal now ${day(date)}${time ? ` at ${formatTime(time)}` : ""}`
        : time
          ? `rehearsal now at ${formatTime(time)}`
          : "rehearsal time back to the usual";
    const band = await bandOf(db, rs.id);
    const others = band.filter((b) => b.id !== user.id);
    if (others.length) {
      await db
        .from("roster_updates")
        .insert(others.map((b) => ({ kind: "roster_session_changed", session_id: rs.id, role: b.role, actor_id: user.id, member_id: b.id, detail })));
    }

    const asked = plan.filter((p) => p.targetId).length;
    revalidatePath("/roster", "layout");
    revalidatePath("/home");
    revalidatePath(`/sessions/${input.planId}`);
    return {
      ok: true,
      message: !date ? "Rehearsal removed." : `${rs.rehearsal_date ? "Rehearsal saved." : "Rehearsal added."}${asked ? ` ${asked === 1 ? "The sub request is" : `${asked} sub requests are`} out.` : ""}`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
