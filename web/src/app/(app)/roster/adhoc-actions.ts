"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { teamProfiles } from "@/lib/teams";
import { ATTACHED_ROLES, ROLE_LABEL, SINGING_ROLES, defaultSessions, quarterOf, todayYmd } from "@/lib/roster";
import { teamPerson } from "@/lib/team-config";
import { cleanComposition, validateSession, type SessionInput } from "@/lib/session-input";

/**
 * Ad-hoc sessions (root): a one-off session added from the Roster page with its band picked by
 * hand, even after the roster's been published.
 *   - A published roster covers the date: the session joins it and its band is asked to serve
 *     straight away (serve requests).
 *   - Otherwise it joins that quarter's draft (made if there isn't one yet). Each pick becomes a
 *     hard rule on that roster only ("Ann must serve at Christmas Eve on 24 Dec on keys"), so
 *     generating builds the rest of the roster around them. Their serve requests go out when the
 *     roster is published, like everyone else's.
 */

type Db = ReturnType<typeof createAdminClient>;

/** One person in the band picker: their parts, how loaded they are that month, and why they can't, if they can't. */
export type AdhocPerson = {
  id: string;
  name: string;
  instruments: string[];
  emPercent: number | null;
  serves: "both" | "sunday" | "pnp";
  /** Session weights they serve that month (on the roster the session would join). */
  load: number;
  /** Why they can't serve that day (absent, or already serving), or null. */
  unavailable: string | null;
};

export type AdhocPick = { member: string; role: string; bandLeader: boolean };

type Roster = { id: string; status: string; starts_on: string; ends_on: string };

/** The roster an ad-hoc session on this date joins: the published one covering it, else the draft, else none yet. */
async function targetRoster(db: Db, date: string, teamId: string): Promise<Roster | null> {
  const { data } = await db
    .from("rosters")
    .select("id, status, starts_on, ends_on")
    .eq("team_id", teamId)
    .in("status", ["published", "draft"])
    .lte("starts_on", date)
    .gte("ends_on", date);
  const rows = (data ?? []) as Roster[];
  return rows.find((r) => r.status === "published") ?? rows.find((r) => r.status === "draft") ?? null;
}

async function signedInRoot() {
  const user = await getCurrentUser();
  if (!user?.isLead) throw new Error("Only the lead can add ad-hoc sessions.");
  return user;
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Everyone who could be picked for an ad-hoc session on `date` (rehearsal on `rehearsal`, if any). */
export async function adhocBandOptions(date: string, rehearsal: string | null): Promise<AdhocPerson[]> {
  const user = await signedInRoot();
  if (!isDay(date)) return [];
  const db = createAdminClient();
  const days = [date, ...(isDay(rehearsal) ? [rehearsal] : [])];
  // What each member plays here, their EM/CM share and "serves at": their profile on this team.
  const [roster, profiles] = await Promise.all([targetRoster(db, date, user.team.id), teamProfiles(user.team.id)]);
  const memberIds = [...profiles.keys()];
  // The session's month as a date range (roster_sessions.date is a date, so LIKE "2026-11-%" errors).
  const [y, m] = date.split("-").map(Number);
  const monthStart = `${date.slice(0, 7)}-01`;
  const nextMonthStart = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const [{ data: people }, { data: away }, { data: sameDay }, { data: monthSessions }] = await Promise.all([
    db.from("profiles").select("id, full_name, email").in("id", memberIds).eq("is_active", true).eq("is_developer", false).order("full_name"),
    db.from("absences").select("member_id, starts_on, ends_on, reason").lte("starts_on", days.reduce((a, b) => (a > b ? a : b))).gte("ends_on", days.reduce((a, b) => (a < b ? a : b))),
    // Already serving that day, on any live or draft roster.
    db
      .from("roster_assignments")
      .select("member_id, roster_sessions!inner(name, date, cancelled, rosters!inner(status))")
      .eq("roster_sessions.date", date)
      .eq("roster_sessions.cancelled", false)
      .in("roster_sessions.rosters.status", ["published", "draft"]),
    roster
      ? db.from("roster_sessions").select("id, weight").eq("roster_id", roster.id).eq("cancelled", false).gte("date", monthStart).lt("date", nextMonthStart)
      : Promise.resolve({ data: [] as { id: string; weight: number }[] }),
  ]);
  const weight = new Map((monthSessions ?? []).map((s) => [s.id as string, Number(s.weight)]));
  const { data: monthRows } = weight.size
    ? await db.from("roster_assignments").select("member_id, session_id").in("session_id", [...weight.keys()])
    : { data: [] as { member_id: string; session_id: string }[] };
  const load = new Map<string, number>();
  for (const r of monthRows ?? []) load.set(r.member_id, (load.get(r.member_id) ?? 0) + (weight.get(r.session_id) ?? 0));
  const serving = new Map(
    (sameDay ?? []).map((a) => [a.member_id as string, (a.roster_sessions as unknown as { name: string }).name]),
  );

  return (people ?? []).map((p) => {
    const absence = (away ?? []).find((a) => a.member_id === p.id && days.some((d) => a.starts_on <= d && a.ends_on >= d));
    const atRehearsal = absence && !(absence.starts_on <= date && absence.ends_on >= date);
    const t = profiles.get(p.id as string)!;
    // A team without EM/CM or P&Ps (Youth) ignores those settings.
    return teamPerson({
      id: p.id as string,
      name: (p.full_name as string) || (p.email as string),
      instruments: t.instruments,
      emPercent: t.emPercent,
      serves: t.serves,
      load: Math.round((load.get(p.id as string) ?? 0) * 10) / 10,
      unavailable: absence
        ? `absent${atRehearsal ? " at the rehearsal" : ""}${absence.reason && absence.reason !== "Absence" ? ` (${absence.reason})` : ""}`
        : serving.has(p.id as string)
          ? `already on ${serving.get(p.id as string)}`
          : null,
    }, user.team.config);
  });
}

/** Whether someone can serve an ad-hoc session at all (the same check the generator uses). */
function eligible(p: AdhocPerson, ministry: string): string | null {
  if (p.serves === "pnp") return "only serves at P&Ps";
  const em = p.emPercent === null || p.emPercent > 0;
  const cm = p.emPercent === null || p.emPercent < 100;
  if (ministry === "em" && !em) return "CM only";
  if (ministry === "cm" && !cm) return "EM only";
  return null;
}

/** Root: add an ad-hoc session with its band. */
export async function addAdhocSession(input: SessionInput, picks: AdhocPick[]): Promise<{ ok: boolean; message: string | null }> {
  try {
    const user = await signedInRoot();
    const db = createAdminClient();
    const s = { ...input, name: String(input.name ?? "").trim(), composition: cleanComposition(input.composition), weight: Number(input.weight) };
    if (!isDay(s.date)) return { ok: false, message: "Choose a date." };
    if (s.date < todayYmd()) return { ok: false, message: "Choose a date from today on." };
    const q = quarterOf(s.date);
    const problem = validateSession(s, { starts_on: q.start, ends_on: q.end });
    if (problem) return { ok: false, message: problem };

    // The band: right parts and numbers, one place each, able and free to serve.
    const band = (Array.isArray(picks) ? picks : []).filter((p) => p && typeof p.member === "string" && p.member);
    const options = new Map((await adhocBandOptions(s.date, s.rehearsal_date ?? null)).map((p) => [p.id, p]));
    const seen = new Set<string>();
    const perRole = new Map<string, number>();
    let leaders = 0;
    for (const b of band) {
      const p = options.get(b.member);
      if (!p) return { ok: false, message: "Someone picked isn't on the team." };
      const part = (ROLE_LABEL[b.role] ?? b.role).toLowerCase();
      if (seen.has(b.member)) return { ok: false, message: `${p.name} is picked twice.` };
      seen.add(b.member);
      if (ATTACHED_ROLES.includes(b.role) || !(s.composition[b.role as keyof typeof s.composition] ?? 0)) return { ok: false, message: `This band has no ${part}.` };
      perRole.set(b.role, (perRole.get(b.role) ?? 0) + 1);
      if (perRole.get(b.role)! > (s.composition[b.role as keyof typeof s.composition] ?? 0)) return { ok: false, message: `Too many people on ${part}.` };
      if (!p.instruments.includes(b.role)) return { ok: false, message: `${p.name} doesn't play ${part}.` };
      const notEligible = eligible(p, s.ministry);
      if (notEligible) return { ok: false, message: `${p.name} can't serve this session (${notEligible}).` };
      if (p.unavailable) return { ok: false, message: `${p.name} is ${p.unavailable}.` };
      if (b.bandLeader) {
        if (SINGING_ROLES.includes(b.role)) return { ok: false, message: "BL/TB goes to someone playing an instrument." };
        if (!p.instruments.includes("band leader")) return { ok: false, message: `${p.name} isn't set up as BL/TB.` };
        leaders += 1;
      }
    }
    if (leaders > (s.composition["band leader"] ?? 0)) return { ok: false, message: "Too many BL/TBs for this band." };

    // Which roster it joins (a new draft for that quarter if there's none yet).
    let roster = await targetRoster(db, s.date, user.team.id);
    if (!roster) {
      const { data, error } = await db.from("rosters").insert({ starts_on: q.start, ends_on: q.end, created_by: user.id, team_id: user.team.id }).select("id, status, starts_on, ends_on").single();
      if (error) throw error;
      roster = data as Roster;
      const { error: sErr } = await db.from("roster_sessions").insert(defaultSessions(q, user.team.config.sessionKinds).map((x) => ({ ...x, roster_id: roster!.id })));
      if (sErr) throw sErr;
      await db.from("audit_log").insert({ actor_id: user.id, action: "roster.create", target: roster.id, details: { quarter: q.label, for: "ad-hoc session" } });
    }

    const { data: session, error: insErr } = await db
      .from("roster_sessions")
      .insert({
        roster_id: roster.id,
        date: s.date,
        kind: "custom",
        name: s.name,
        ministry: s.ministry,
        weight: s.weight,
        composition: s.composition,
        note: (s.note ?? "").trim(),
        rehearsal_date: s.rehearsal_date || null,
        start_time: s.start_time || null,
        rehearsal_time: (s.rehearsal_date && s.rehearsal_time) || null,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    const rows = band.map((b) => ({ session_id: session.id, member_id: b.member, role: b.role, also_roles: b.bandLeader ? ["band leader"] : [] }));
    if (rows.length) {
      const { error } = await db.from("roster_assignments").insert(rows);
      if (error) throw error;
    }

    if (roster.status === "published") {
      // Ask the band straight away.
      if (rows.length) {
        const { error } = await db
          .from("serve_requests")
          .upsert(rows.map((r) => ({ roster_id: roster!.id, session_id: r.session_id, member_id: r.member_id, role: r.role })), {
            onConflict: "session_id,member_id",
            ignoreDuplicates: true,
          });
        if (error) throw error;
      }
    } else {
      // A draft: roster-only hard rules keep the picked band in place when it's generated.
      if (band.length) {
        const { error } = await db.from("roster_rules").insert(
          band.map((b) => ({
            team_id: user.team.id,
            template: "date",
            params: {
              member: b.member,
              polarity: "must",
              date: s.date,
              sessionKind: "custom",
              sessionName: s.name,
              role: b.role,
              ...(b.bandLeader ? { bandLeader: true } : {}),
            },
            hard: true,
            weight: 1,
            enabled: true,
            roster_id: roster!.id,
            created_by: user.id,
            updated_by: user.id,
          })),
        );
        if (error) throw error;
      }
      // Already generated: count the picked band as generated, so it isn't flagged as a hand edit.
      const { data: r } = await db.from("rosters").select("generated_assignments").eq("id", roster.id).maybeSingle();
      if (Array.isArray(r?.generated_assignments) && rows.length) {
        await db.from("rosters").update({ generated_assignments: [...r.generated_assignments, ...rows] }).eq("id", roster.id);
      }
    }

    await db.from("audit_log").insert({
      actor_id: user.id,
      action: "roster.add_adhoc_session",
      target: roster.id,
      details: { date: s.date, name: s.name, band: band.map((b) => [b.member, b.role, b.bandLeader]), roster: roster.status },
    });
    revalidatePath("/roster", "layout");
    return {
      ok: true,
      message:
        roster.status === "published"
          ? `${s.name} added to the roster.${rows.length ? " The band has been asked to serve." : ""}`
          : `${s.name} added to the ${q.label} draft.${rows.length ? " Generating will keep this band and build the rest around it." : ""}`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
