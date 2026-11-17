"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRoot, TEAM_HOME, VIEW_AS_COOKIE } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PERMISSIONS } from "@/lib/permissions";
import { defaultMemberPassword } from "@/lib/default-password";
import { TEAM_COOKIE, teamBySlug, type TeamKind } from "@/lib/teams";
import { TEAM_GROUPS, presetFor, type TeamGroup } from "@/lib/team-config";
import type { ActionResult } from "@/app/(app)/team/permissions/actions";

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
}

/** The maximum permissions ticked on the form; null when "every permission" is ticked. */
function readCeiling(formData: FormData): string[] | null {
  if (formData.get("all_permissions") === "on") return null;
  return formData.getAll("permissions").map(String).filter((p) => (PERMISSIONS as readonly string[]).includes(p));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/^brighton\s+/, "") // "Brighton Youth" → "youth"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const clean = (v: FormDataEntryValue | null) => String(v ?? "").trim().replace(/\s+/g, " ");

/**
 * Make someone the team's lead: an existing account found by email (they join the team), or a new
 * account (default password, changed on first login). The old lead stays on the team as a member.
 */
async function makeLead(teamId: string, email: string, name: string): Promise<string | null> {
  const db = createAdminClient();
  let { data: person } = await db.from("profiles").select("id, is_developer, is_root").eq("email", email).maybeSingle();
  if (person?.is_developer || person?.is_root) return "Root and developer accounts can't lead a team: they aren't on any team.";
  if (!person) {
    if (!name) return "That email has no account yet: enter the lead's name too, to make one.";
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: defaultMemberPassword(),
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error) return error.message;
    const { data: last } = await db.from("profiles").select("uid").order("uid", { ascending: false, nullsFirst: false }).limit(1);
    const { error: pErr } = await db
      .from("profiles")
      .update({ uid: (last?.[0]?.uid ?? 0) + 1, full_name: name, must_change_password: true })
      .eq("id", data.user.id);
    if (pErr) {
      await db.auth.admin.deleteUser(data.user.id); // don't leave a half-made account behind
      return pErr.code === "23505" ? `There's already someone called ${name}.` : pErr.message;
    }
    person = { id: data.user.id, is_developer: false, is_root: false };
  }
  await db.from("team_members").update({ is_lead: false }).eq("team_id", teamId).eq("is_lead", true);
  const { error } = await db.from("team_members").upsert({ team_id: teamId, user_id: person.id, is_lead: true });
  return error ? error.message : null;
}

/**
 * Root: create a team in a group (Main or Youth), worship or media, with its maximum permissions and
 * optionally its lead. It starts with the preset config for its group and kind (team-config.ts).
 */
export async function createTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let slug: string;
  try {
    const actor = await requireRoot();
    const name = clean(formData.get("name"));
    const kind = String(formData.get("kind") ?? "") as TeamKind;
    const group = String(formData.get("group") ?? "") as TeamGroup;
    const leadEmail = String(formData.get("lead_email") ?? "").trim().toLowerCase();
    const leadName = clean(formData.get("lead_name"));
    if (!name) return { ok: false, message: "Give the team a name." };
    if (kind !== "worship" && kind !== "media") return { ok: false, message: "Choose worship or media." };
    if (!TEAM_GROUPS.includes(group)) return { ok: false, message: "Choose Main or Youth." };
    slug = slugify(name);
    if (!slug) return { ok: false, message: "Use some letters in the team's name." };
    if (leadEmail && !/^\S+@\S+\.\S+$/.test(leadEmail)) return { ok: false, message: "Enter a valid email for the lead." };

    const db = createAdminClient();
    const { data: last } = await db.from("teams").select("position").order("position", { ascending: false }).limit(1);
    const { data: team, error } = await db
      .from("teams")
      .insert({
        name,
        slug,
        kind,
        team_group: group,
        config: presetFor(group, kind),
        permission_ceiling: readCeiling(formData),
        position: (last?.[0]?.position ?? 0) + 1,
      })
      .select("id")
      .single();
    if (error) return { ok: false, message: error.code === "23505" ? "There's already a team with that name." : error.message };

    // Every team starts with a "member" group the lead can fill in.
    await db.from("groups").insert({ team_id: team.id, name: "member", description: "Everyone on the team" });
    if (leadEmail) {
      const problem = await makeLead(team.id, leadEmail, leadName);
      if (problem) return { ok: false, message: `${name} was made, but: ${problem}` };
    }
    await db.from("audit_log").insert({ actor_id: actor.id, action: "team.create", target: team.id, details: { name, kind, group, leadEmail } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/", "layout");
  redirect(`/teams/${slug}`);
}

/** Root: a team's name and maximum permissions. */
export async function updateTeam(teamId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireRoot();
    const name = clean(formData.get("name"));
    if (!name) return { ok: false, message: "Give the team a name." };
    const ceiling = readCeiling(formData);
    const { error } = await createAdminClient().from("teams").update({ name, permission_ceiling: ceiling }).eq("id", teamId);
    if (error) return { ok: false, message: error.code === "23505" ? "There's already a team with that name." : error.message };
    await createAdminClient().from("audit_log").insert({ actor_id: actor.id, action: "team.update", target: teamId, details: { name, ceiling } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}

/** Root: create (or change) a team's lead. */
export async function setTeamLead(teamId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireRoot();
    const email = String(formData.get("lead_email") ?? "").trim().toLowerCase();
    const name = clean(formData.get("lead_name"));
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "Enter the lead's email." };
    const problem = await makeLead(teamId, email, name);
    if (problem) return { ok: false, message: problem };
    await createAdminClient().from("audit_log").insert({ actor_id: actor.id, action: "team.set_lead", target: teamId, details: { email } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Lead saved. If it's a new account, they log in with the default password and choose their own." };
}

/** Root and developers: work in another team (its roster, sessions, members, permissions). */
export async function openTeam(slug: string): Promise<void> {
  const user = await requireRoot();
  const team = await teamBySlug(slug);
  if (!team) return;
  const jar = await cookies();
  jar.set(TEAM_COOKIE, team.slug, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  jar.delete(VIEW_AS_COOKIE); // "view as" names a group or person in the last team
  // Root keeps its own view; a developer sees the team's own interface.
  redirect(user.isRoot ? "/home" : TEAM_HOME[team.kind]);
}

/**
 * Root: create a group's observer account, a read-only account on no team that oversees the group's
 * teams (e.g. Youth Worship and Youth Media). One per group at a time. With "Can manage permissions"
 * it also manages its teams' permissions (the leads' too) and can transfer each lead. It starts on
 * the default password and chooses its own the first time it logs in.
 */
export async function createObserver(group: TeamGroup, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireRoot();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = clean(formData.get("name"));
    const manages = formData.get("manages_permissions") === "on";
    const seesAbsences = formData.get("sees_absences") === "on";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Enter a valid email." };
    if (!name) return { ok: false, message: "Enter the observer's name." };
    if (!TEAM_GROUPS.includes(group)) return { ok: false, message: "Pick a group." };

    const db = createAdminClient();
    const { data: current } = await db.from("profiles").select("email").eq("observer_group", group).maybeSingle();
    if (current) return { ok: false, message: `This group already has an observer (${current.email}). Remove it first.` };
    const { data: taken } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
    if (taken) return { ok: false, message: "That email already has an account. An observer needs an email that isn't used yet." };

    const { data, error } = await db.auth.admin.createUser({
      email,
      password: defaultMemberPassword(),
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error) return { ok: false, message: error.message };
    const { error: pErr } = await db
      .from("profiles")
      .update({ full_name: name, observer_group: group, observer_manages_permissions: manages, observer_sees_absences: seesAbsences, must_change_password: true, is_active: true })
      .eq("id", data.user.id);
    if (pErr) {
      await db.auth.admin.deleteUser(data.user.id); // don't leave a half-made account behind
      return { ok: false, message: pErr.message };
    }
    await db.from("audit_log").insert({ actor_id: actor.id, action: "observer.create", target: data.user.id, details: { email, group, manages, seesAbsences } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/teams", "layout");
  return { ok: true, message: "Observer created. They log in with the default password and choose their own." };
}

/** Root: delete a group's observer account (it's on no team, so nothing else is lost). */
export async function removeObserver(group: TeamGroup, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireRoot();
    if (formData.get("confirm") !== "on") return { ok: false, message: "Tick the box to confirm." };
    const db = createAdminClient();
    const { data: current } = await db.from("profiles").select("id, email").eq("observer_group", group).maybeSingle();
    if (!current) return { ok: false, message: "This group has no observer." };
    const { error } = await db.auth.admin.deleteUser(current.id as string);
    if (error) return { ok: false, message: error.message };
    await db.from("audit_log").insert({ actor_id: actor.id, action: "observer.delete", target: current.id, details: { email: current.email, group } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/teams", "layout");
  return { ok: true, message: "Observer removed." };
}
