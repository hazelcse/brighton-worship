"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { VIEW_AS_COOKIE, VIEW_AS_PERSON, getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultMemberPassword } from "@/lib/default-password";
import { addDays, daysBetween, defaultSessions, quarterOf, todayYmd, weekday, ymd as ymdOf, type SessionKind } from "@/lib/roster";
import { BAND_COLUMNS, MAX_MAIN_SET, ROLE_TO_BAND, cleanRecordInput, isSunday, type Band, type TrackedSong } from "@/lib/tracking";
import { readSessionsCsv, readSessionsWorkbook } from "@/lib/session-import";
import { readXlsx } from "@/lib/xlsx";
import { isInstrument } from "@/lib/team";

/**
 * Developers only: see (and use) the app as root or as one permission group, or act as one
 * person ("person:<id>": their identity and permissions, changes are made as them). null = back to the developer's own full access. The choice
 * is a cookie; the server only honours it for developers.
 */
export async function setViewAs(view: string | null): Promise<{ ok: boolean; message: string | null }> {
  // getSessionUser, not getCurrentUser: switching back must work while viewing as a person.
  const user = await getSessionUser();
  if (!user?.isDeveloper) return { ok: false, message: "Only developers can switch views." };
  const actorId = user.viewingAsPerson?.realId ?? user.id;
  const jar = await cookies();
  if (!view) {
    jar.delete(VIEW_AS_COOKIE);
  } else {
    if (view.startsWith(VIEW_AS_PERSON)) {
      const { data } = await createAdminClient()
        .from("profiles")
        .select("id, is_active, is_developer")
        .eq("id", view.slice(VIEW_AS_PERSON.length))
        .maybeSingle();
      if (!data || !data.is_active || data.is_developer) return { ok: false, message: "That person can't be viewed as." };
    } else if (view !== "root") {
      const { data } = await createAdminClient().from("groups").select("name").eq("name", view).maybeSingle();
      if (!data) return { ok: false, message: "That permission group doesn't exist." };
    }
    jar.set(VIEW_AS_COOKIE, view, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  }
  await createAdminClient()
    .from("audit_log")
    .insert({ actor_id: actorId, action: "developer.view_as", target: actorId, details: { view } });
  revalidatePath("/", "layout");
  return { ok: true, message: null };
}

/** What the developer must type to confirm a reset (the dialog asks for the same word). */
const RESET_CONFIRM_WORD = "RESET";

/** Every file path in a storage bucket (folders listed recursively). */
async function allFiles(db: ReturnType<typeof createAdminClient>, bucket: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const f of data ?? []) {
      const path = prefix ? `${prefix}/${f.name}` : f.name;
      // Folders have no id.
      if (f.id) out.push(path);
      else out.push(...(await allFiles(db, bucket, path)));
    }
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Developers only: wipe the app back to brand new. Rosters, sessions, absences, notifications and
 * the song library (with its files) go; team accounts stay with their settings. Everyone except
 * root and developers goes back to the default password and must choose a new one at next login.
 */
export async function resetAppData(confirm: string): Promise<{ ok: boolean; message: string | null }> {
  const user = await getSessionUser();
  if (!user?.isDeveloper) return { ok: false, message: "Only developers can reset the app." };
  if (confirm !== RESET_CONFIRM_WORD) return { ok: false, message: `Type ${RESET_CONFIRM_WORD} to confirm.` };
  const actorId = user.viewingAsPerson?.realId ?? user.id;
  const db = createAdminClient();
  try {
    // Check the default password is set before deleting anything.
    const password = defaultMemberPassword();

    const { error } = await db.rpc("developer_reset_app_data");
    if (error) throw error;

    // Songsheet files: uploads, previews and transpositions.
    const files = await allFiles(db, "songsheets");
    for (let i = 0; i < files.length; i += 500) {
      const { error: rmErr } = await db.storage.from("songsheets").remove(files.slice(i, i + 500));
      if (rmErr) throw rmErr;
    }

    // Passwords back to the default, except root and developers.
    const { data: members, error: pErr } = await db.from("profiles").select("id").eq("is_root", false).eq("is_developer", false);
    if (pErr) throw pErr;
    const failed: string[] = [];
    for (const m of members ?? []) {
      const { error: authErr } = await db.auth.admin.updateUserById(m.id, { password });
      if (authErr) failed.push(m.id);
    }
    const ok = (members ?? []).map((m) => m.id).filter((id) => !failed.includes(id));
    if (ok.length) await db.from("profiles").update({ must_change_password: true }).in("id", ok);

    await db.from("audit_log").insert({
      actor_id: actorId,
      action: "developer.reset_app_data",
      target: actorId,
      details: { filesRemoved: files.length, passwordsReset: ok.length, passwordsFailed: failed.length },
    });
    revalidatePath("/", "layout");
    return failed.length
      ? { ok: true, message: `Reset done, but ${failed.length} password${failed.length === 1 ? "" : "s"} couldn't be reset. Reset them from Team.` }
      : { ok: true, message: null };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? `Reset stopped: ${e.message}` : "Reset stopped." };
  }
}

const RANDOM_REASONS = ["Away", "Holiday", "Work trip", "Family event", "Overseas", "Exams", "Unwell", "Wedding"];

function randInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** A date as YYYY-MM-DD (UTC, so no timezone shifts). */
function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Developers only: give every active team member 1–5 random absences inside a quarter, a mix of
 * single days and leave of 4–14 days (cut off at the quarter's end). Saved like real absences, with
 * each member as the owner, so they show on the schedule. Returns how many were made.
 */
export async function populateRandomAbsences(
  quarter: number,
  year: number,
): Promise<{ ok: boolean; message: string | null; created?: number }> {
  const user = await getSessionUser();
  if (!user?.isDeveloper) return { ok: false, message: "Only developers can populate absences." };
  if (![1, 2, 3, 4].includes(quarter)) return { ok: false, message: "Choose a quarter." };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, message: "Choose a year." };
  const actorId = user.viewingAsPerson?.realId ?? user.id;
  const db = createAdminClient();
  try {
    const { data: members, error: mErr } = await db.from("profiles").select("id").eq("is_active", true).eq("is_developer", false);
    if (mErr) throw mErr;

    const qStart = Date.UTC(year, (quarter - 1) * 3, 1);
    const qEnd = Date.UTC(year, quarter * 3, 0); // last day of the quarter
    const DAY = 86_400_000;
    const days = Math.round((qEnd - qStart) / DAY) + 1;

    const rows: { member_id: string; starts_on: string; ends_on: string; reason: string }[] = [];
    for (const m of members ?? []) {
      const n = randInt(1, 5);
      for (let i = 0; i < n; i++) {
        const length = Math.random() < 0.5 ? 1 : randInt(4, 14);
        const start = qStart + randInt(0, days - 1) * DAY;
        const end = Math.min(start + (length - 1) * DAY, qEnd);
        rows.push({
          member_id: m.id,
          starts_on: ymd(new Date(start)),
          ends_on: ymd(new Date(end)),
          reason: RANDOM_REASONS[randInt(0, RANDOM_REASONS.length - 1)]!,
        });
      }
    }
    if (!rows.length) return { ok: true, message: "There are no active team members.", created: 0 };

    const { error } = await db.from("absences").insert(rows);
    if (error) throw error;
    await db.from("audit_log").insert({
      actor_id: actorId,
      action: "developer.populate_absences",
      target: actorId,
      details: { quarter, year, members: members?.length ?? 0, created: rows.length },
    });
    revalidatePath("/roster", "layout");
    return {
      ok: true,
      message: `Created ${rows.length} absence${rows.length === 1 ? "" : "s"} for ${members?.length ?? 0} member${members?.length === 1 ? "" : "s"} in Q${quarter} ${year}.`,
      created: rows.length,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? `Couldn't populate: ${e.message}` : "Couldn't populate." };
  }
}

const AD_HOC_EVENTS = [
  "Combined Service",
  "Good Friday Service",
  "Youth Camp Worship",
  "Christmas Celebration",
  "Church Anniversary",
  "Baptism Service",
  "Night of Worship",
  "Mission Sunday Rally",
];

/** n different random items of a list (fewer if it's short). */
function pick<T>(list: readonly T[], n: number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}

/**
 * Developers only: fill Tracking with made-up past sessions for a quarter, following the regular
 * schedule (EM and CM Sunday services every Sunday, CM and EM Prayer & Praise on the 4th Wednesday
 * and Thursday) plus 1–2 ad-hoc events with 2–5 songs. Bands are random active members who play
 * each role; songs come from the song library (Sunday services: four main-set songs and a closing
 * song). Only dates up to today, and none already in tracking.
 */
export async function populatePastSessions(
  quarter: number,
  year: number,
): Promise<{ ok: boolean; message: string | null; created?: number }> {
  const user = await getSessionUser();
  if (!user?.isDeveloper) return { ok: false, message: "Only developers can populate sessions." };
  if (![1, 2, 3, 4].includes(quarter)) return { ok: false, message: "Choose a quarter." };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, message: "Choose a year." };
  const actorId = user.viewingAsPerson?.realId ?? user.id;
  const db = createAdminClient();
  try {
    const q = quarterOf(ymdOf(year, (quarter - 1) * 3 + 1, 1));
    const today = todayYmd();
    if (q.start > today) return { ok: false, message: `Q${quarter} ${year} hasn't started yet, so it has no past sessions.` };
    const last = q.end < today ? q.end : today;

    const [{ data: members, error: mErr }, { data: songs, error: sErr }, { data: existing, error: eErr }] = await Promise.all([
      db.from("profiles").select("id, full_name, email, instruments, serves").eq("is_active", true).eq("is_developer", false),
      db.from("songs").select("title, artist, language, original_key, song_versions(keys)"),
      db.from("session_records").select("date, kind").gte("date", q.start).lte("date", last),
    ]);
    if (mErr) throw mErr;
    if (sErr) throw sErr;
    if (eErr) throw eErr;
    if (!songs?.length) return { ok: false, message: "The song library is empty: add songs first." };

    const library = songs.map((s) => ({
      title: s.title as string,
      artist: (s.artist as string | null) ?? "",
      zh: s.language === "zh",
      key: ((s.song_versions ?? []) as { keys: string[] | null }[])[0]?.keys?.[0] ?? (s.original_key as string | null) ?? "",
    }));
    const zhSongs = library.filter((s) => s.zh);
    const people = (members ?? []).map((m) => ({
      name: (m.full_name as string) || (m.email as string),
      instruments: (m.instruments as string[]) ?? [],
      serves: m.serves as string,
    }));
    const taken = new Set((existing ?? []).map((r) => `${r.date}|${r.kind}`));

    // The regular schedule, plus 1–2 ad-hoc events on a day that isn't a Sunday.
    type Planned = { date: string; kind: SessionKind; name: string; ministry: "em" | "cm" | "any"; composition: Record<string, number> };
    const planned: Planned[] = defaultSessions(q).map((s) => ({ date: s.date, kind: s.kind, name: s.name, ministry: s.ministry, composition: s.composition }));
    const days = daysBetween(q.start, q.end) + 1;
    for (const name of pick(AD_HOC_EVENTS, randInt(1, 2))) {
      let date = addDays(q.start, randInt(0, days - 1));
      if (weekday(date) === 0) date = addDays(date, date === q.start ? 1 : -1);
      planned.push({
        date,
        kind: "custom",
        name,
        ministry: "any",
        composition: { "worship leader": 1, vocalist: 2, keys: 1, "acoustic guitar": 1, "electric guitar": 1, bass: 1, drums: 1 },
      });
    }

    const rows = [];
    for (const s of planned.sort((a, b) => a.date.localeCompare(b.date))) {
      if (s.date > last || (s.kind !== "custom" && taken.has(`${s.date}|${s.kind}`))) continue;

      // Band: one person per seat, nobody twice; Sunday-only and P&P-only members kept to theirs.
      const pnp = s.kind === "em_pnp" || s.kind === "cm_pnp";
      const free = people.filter((p) => p.serves === "both" || (pnp ? p.serves === "pnp" : p.serves === "sunday"));
      const used = new Set<string>();
      const band: Band = {};
      for (const [role, count] of Object.entries(s.composition)) {
        const col = ROLE_TO_BAND[role];
        if (!col) continue; // band leader is on top of an instrument
        const can = free.filter((p) => !used.has(p.name) && (p.instruments.includes(role) || (role === "keys" && p.instruments.includes("synth/pads"))));
        for (const p of pick(can, count)) {
          used.add(p.name);
          (band[col] ??= []).push(p.name);
        }
      }
      const ordered: Band = Object.fromEntries(BAND_COLUMNS.filter((c) => band[c.key]).map((c) => [c.key, band[c.key]]));
      const singers = [...(ordered.wl ?? []), ...(ordered.vox ?? [])];

      // Songs: CM sessions lean on the Chinese songs; Sunday services end with a closing song.
      const sunday = isSunday(s.kind);
      const count = s.kind === "custom" ? randInt(2, 5) : sunday ? MAX_MAIN_SET + 1 : s.kind === "cm_pnp" ? 3 : 4;
      const chosen = new Set<string>();
      const set: TrackedSong[] = [];
      while (set.length < count && chosen.size < library.length) {
        const pool = s.ministry === "cm" && zhSongs.length && Math.random() < 0.6 ? zhSongs : library;
        const song = pool[randInt(0, pool.length - 1)]!;
        if (chosen.has(song.title)) continue;
        chosen.add(song.title);
        set.push({
          title: song.title,
          artist: song.artist,
          key: song.key,
          lead: singers.length ? singers[randInt(0, singers.length - 1)]! : "",
          ...(sunday && set.length === MAX_MAIN_SET ? { closing: true } : {}),
        });
      }

      rows.push({
        roster_session_id: null,
        date: s.date,
        ministry: s.ministry,
        kind: s.kind,
        service_name: s.name,
        band: ordered,
        songs: set,
        links: [],
        comments: "",
        confirmed_by: actorId,
        updated_by: actorId,
      });
    }
    if (!rows.length) return { ok: true, message: `Q${quarter} ${year} has no past sessions that aren't in tracking already.`, created: 0 };

    const { error } = await db.from("session_records").insert(rows);
    if (error) throw error;
    await db.from("audit_log").insert({
      actor_id: actorId,
      action: "developer.populate_past_sessions",
      target: actorId,
      details: { quarter, year, created: rows.length },
    });
    revalidatePath("/sessions/tracking", "layout");
    return { ok: true, message: `Added ${rows.length} past session${rows.length === 1 ? "" : "s"} for Q${quarter} ${year} to Tracking.`, created: rows.length };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? `Couldn't populate: ${e.message}` : "Couldn't populate." };
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Developers only: add the sessions in the team's records spreadsheet to Tracking, uploaded as
 * the Excel workbook (.xlsx, its "Database" sheet) or a CSV saved from it (format:
 * lib/session-import.ts). Sessions already in tracking (same date and service) and dates after
 * today are skipped.
 */
export async function importSessionsFile(form: FormData): Promise<{ ok: boolean; message: string | null; created?: number }> {
  const user = await getSessionUser();
  if (!user?.isDeveloper) return { ok: false, message: "Only developers can import sessions." };
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose a file." };
  if (file.size > 20_000_000) return { ok: false, message: "That file is too big (20 MB at most)." };
  const actorId = user.viewingAsPerson?.realId ?? user.id;
  const db = createAdminClient();
  try {
    const data = Buffer.from(await file.arrayBuffer());
    // An .xlsx is a zip ("PK" at the start); anything else is read as CSV text.
    const workbook = data.subarray(0, 2).toString("latin1") === "PK";
    if (!workbook && /\.xls[xmb]?$/i.test(file.name)) return { ok: false, message: "Save the workbook as .xlsx (or CSV) first." };
    const { sessions, problems } = workbook ? readSessionsWorkbook(readXlsx(data)) : readSessionsCsv(data.toString("utf8"));
    if (!sessions.length) return { ok: false, message: problems[0] ?? "There are no sessions in that file." };

    const { data: existing, error: eErr } = await db.from("session_records").select("date, kind, service_name");
    if (eErr) throw eErr;
    // Regular services are one a day; an ad-hoc event is matched by its name too.
    const keyOf = (date: string, kind: string, name: string) => (kind === "custom" ? `${date}|custom|${name.toLowerCase()}` : `${date}|${kind}`);
    const taken = new Set((existing ?? []).map((r) => keyOf(r.date, r.kind, r.service_name)));
    const today = todayYmd();

    let already = 0;
    let future = 0;
    const rows = [];
    for (const s of sessions) {
      if (s.date > today) {
        future++;
        continue;
      }
      const key = keyOf(s.date, s.kind, s.serviceName);
      if (taken.has(key)) {
        already++;
        continue;
      }
      try {
        const clean = cleanRecordInput({ band: s.band, songs: s.songs, links: s.links, comments: s.comments }, s.kind);
        taken.add(key);
        rows.push({
          roster_session_id: null,
          date: s.date,
          ministry: s.ministry,
          kind: s.kind,
          service_name: s.serviceName,
          band: clean.band,
          songs: clean.songs,
          links: clean.links,
          comments: clean.comments,
          confirmed_by: actorId,
          updated_by: actorId,
        });
      } catch (e) {
        problems.push(`Line ${s.line}: ${e instanceof Error ? e.message : "couldn't be read"}`);
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from("session_records").insert(rows.slice(i, i + 200));
      if (error) throw error;
    }
    if (rows.length) {
      await db.from("audit_log").insert({
        actor_id: actorId,
        action: "developer.import_sessions",
        target: actorId,
        details: { created: rows.length, already, future, problems: problems.length },
      });
      revalidatePath("/sessions/tracking", "layout");
    }
    const notes = [
      already && `${plural(already, "session")} already in Tracking`,
      future && `${plural(future, "session")} after today`,
      problems.length && `${plural(problems.length, "row")} couldn't be read (${problems.slice(0, 3).join(" ")}${problems.length > 3 ? " …" : ""})`,
    ].filter(Boolean);
    return {
      ok: true,
      message: `Added ${plural(rows.length, "session")} to Tracking.${notes.length ? ` Skipped: ${notes.join("; ")}.` : ""}`,
      created: rows.length,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? `Couldn't import: ${e.message}` : "Couldn't import." };
  }
}

/**
 * Developers only: add team members from a JSON file, either a list or an object of entries like
 *   { "name": "…", "email": "…", "password": "…", "instrument": ["Keys", "Band Leader"],
 *     "gender": "female", "ministry": ["CM"], "em_percent": 0, "serves": "both",
 *     "groups": ["member", "admin"], "is_root": false, "is_active": true }
 * Members whose email or name is already in the team are skipped. With a password (6+ characters)
 * they sign in with it; without one they get the default password and choose their own. is_root
 * is only honoured when the team has no root yet.
 */
export async function importMembersJson(json: string): Promise<{ ok: boolean; message: string | null; created?: number }> {
  const user = await getSessionUser();
  if (!user?.isDeveloper) return { ok: false, message: "Only developers can import members." };
  const actorId = user.viewingAsPerson?.realId ?? user.id;
  let entries: Record<string, unknown>[];
  try {
    const parsed = JSON.parse(json) as unknown;
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? Object.values(parsed as object) : [];
    entries = list.filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object");
  } catch {
    return { ok: false, message: "That file isn't valid JSON." };
  }
  if (!entries.length) return { ok: false, message: "There are no members in that file." };

  const db = createAdminClient();
  try {
    const [{ data: profiles, error: pErr }, { data: groups, error: gErr }] = await Promise.all([
      db.from("profiles").select("email, full_name, uid, is_root"),
      db.from("groups").select("id, name"),
    ]);
    if (pErr) throw pErr;
    if (gErr) throw gErr;
    const emails = new Set((profiles ?? []).map((p) => (p.email as string).toLowerCase()));
    const fullNames = new Set((profiles ?? []).map((p) => (p.full_name as string).trim().replace(/\s+/g, " ").toLowerCase()));
    let hasRoot = (profiles ?? []).some((p) => p.is_root);
    let uid = Math.max(0, ...(profiles ?? []).map((p) => (p.uid as number | null) ?? 0));
    const groupId = new Map((groups ?? []).map((g) => [(g.name as string).toLowerCase(), g.id as string]));
    const fallback = defaultMemberPassword();

    let created = 0;
    let skipped = 0;
    const problems: string[] = [];
    for (const [i, m] of entries.entries()) {
      const name = String(m.name ?? "").trim().replace(/\s+/g, " ");
      const email = String(m.email ?? "").trim().toLowerCase();
      const label = name || email || `Entry ${i + 1}`;
      if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
        problems.push(`${label}: needs a name and a valid email.`);
        continue;
      }
      if (emails.has(email) || fullNames.has(name.toLowerCase())) {
        skipped++;
        continue;
      }
      const instruments = [...new Set((Array.isArray(m.instrument) ? m.instrument : Array.isArray(m.instruments) ? m.instruments : []).map((x) => String(x).trim().toLowerCase()))].filter(isInstrument);
      const ministries = (Array.isArray(m.ministry) ? m.ministry : [m.ministry]).map((x) => String(x ?? "").toUpperCase());
      const em = Number(m.em_percent);
      const emPercent =
        m.em_percent !== undefined && m.em_percent !== null && Number.isFinite(em)
          ? Math.min(100, Math.max(0, Math.round(em)))
          : ministries.includes("EM") && ministries.includes("CM")
            ? 50
            : ministries.includes("EM")
              ? 100
              : ministries.includes("CM")
                ? 0
                : null;
      const gender = m.gender === "male" || m.gender === "female" ? m.gender : null;
      const serves = m.serves === "sunday" || m.serves === "pnp" ? m.serves : "both";
      const given = typeof m.password === "string" && m.password.length >= 6 ? m.password : null;
      const makeRoot = m.is_root === true && !hasRoot;

      const { data, error } = await db.auth.admin.createUser({ email, password: given ?? fallback, email_confirm: true, user_metadata: { full_name: name } });
      if (error) {
        problems.push(`${label}: ${error.message}`);
        continue;
      }
      uid += 1;
      const { error: upErr } = await db
        .from("profiles")
        .update({
          uid,
          full_name: name,
          instruments,
          em_percent: emPercent,
          gender,
          serves,
          is_active: m.is_active !== false,
          is_root: makeRoot,
          must_change_password: !given,
        })
        .eq("id", data.user.id);
      if (upErr) {
        await db.auth.admin.deleteUser(data.user.id); // don't leave a half-made account behind
        problems.push(`${label}: ${upErr.message}`);
        continue;
      }
      const wanted = (Array.isArray(m.groups) && m.groups.length ? m.groups : ["member"]).map((g) => groupId.get(String(g).toLowerCase())).filter((g): g is string => Boolean(g));
      if (wanted.length) await db.from("user_groups").insert([...new Set(wanted)].map((group_id) => ({ user_id: data.user.id, group_id })));
      if (makeRoot) hasRoot = true;
      emails.add(email);
      fullNames.add(name.toLowerCase());
      created++;
    }

    if (created) {
      await db.from("audit_log").insert({ actor_id: actorId, action: "developer.import_members", target: actorId, details: { created, skipped, problems: problems.length } });
      revalidatePath("/", "layout");
    }
    const notes = [
      skipped && `${plural(skipped, "member")} already in the team`,
      problems.length && `${plural(problems.length, "member")} with problems (${problems.slice(0, 3).join(" ")}${problems.length > 3 ? " …" : ""})`,
    ].filter(Boolean);
    return { ok: true, message: `Added ${plural(created, "member")}.${notes.length ? ` Skipped: ${notes.join("; ")}.` : ""}`, created };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? `Couldn't import: ${e.message}` : "Couldn't import." };
  }
}
