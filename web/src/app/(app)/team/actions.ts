"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireLead } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInstrument } from "@/lib/team";
import { defaultMemberPassword } from "@/lib/default-password";
import { membership } from "@/lib/teams";
import type { CurrentUser } from "@/lib/auth";

/**
 * The person must be on the actor's team (developers can also manage developer accounts).
 * Returns an error message, or null when it's fine.
 */
async function notOnTeam(actor: CurrentUser, id: string): Promise<string | null> {
  if (await membership(actor.team.id, id)) return null;
  // Root can reset the password of the observer of this team's group (shown in its directory).
  if (actor.isRoot) {
    const { data } = await createAdminClient().from("profiles").select("observer_group").eq("id", id).maybeSingle();
    if (data?.observer_group && data.observer_group === actor.team.group) return null;
  }
  if (actor.isDeveloper) {
    const { data } = await createAdminClient().from("profiles").select("is_developer").eq("id", id).maybeSingle();
    if (data?.is_developer) return null;
  }
  return "Member not found.";
}

export type MemberFormState = {
  ok: boolean;
  message: string | null;
  /**
   * Adding someone whose email already has a login on another team: who they are and which teams
   * they're on, so the form can ask whether to link this team's profile to the same person.
   */
  link?: { name: string; teams: string[] };
};

function fail(e: unknown): MemberFormState {
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
}

/**
 * The form's fields. Name, email and gender are the person's (shared by every team they're on);
 * instruments or roles, EM/CM and "serves at" are their profile on this team only.
 */
function readFields(formData: FormData, team: CurrentUser["team"]) {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Only what this team offers (a worship team's instruments, a media team's roles).
  const instruments = [...new Set(formData.getAll("instruments").map(String))].filter((i) => isInstrument(i) && team.config.roles.includes(i));
  // EM/CM and "serves at" are only on some teams' forms (not Youth's): left out = keep what's saved.
  const cmRaw = formData.get("cm_percent");
  const cm = Number(cmRaw);
  const emPercent = cmRaw === null ? undefined : Number.isFinite(cm) ? Math.min(100, Math.max(0, Math.round(100 - cm))) : null;
  const g = String(formData.get("gender") ?? "");
  const gender = g === "male" || g === "female" ? g : null;
  const svRaw = formData.get("serves");
  const sv = String(svRaw ?? "both");
  const serves = svRaw === null ? undefined : sv === "sunday" || sv === "pnp" ? sv : "both";
  return { name, email, instruments, emPercent, gender, serves };
}

/** Their profile on this team, as saved on team_members (EM/CM and "serves at" left out = keep what's saved). */
function teamFields(f: ReturnType<typeof readFields>) {
  return {
    instruments: f.instruments,
    ...(f.emPercent === undefined ? {} : { em_percent: f.emPercent }),
    ...(f.serves === undefined ? {} : { serves: f.serves }),
  };
}

const rolesWord = (team: CurrentUser["team"]) => (team.kind === "media" ? "role" : "instrument");

/** Names must be unique (ignoring case and spacing). */
async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db.from("profiles").select("id, full_name"); // a team is small; compare in code
  const wanted = name.toLowerCase();
  return (data ?? []).some((p) => p.id !== exceptId && p.full_name.trim().replace(/\s+/g, " ").toLowerCase() === wanted);
}

export async function createMember(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  let newId: string;
  try {
    const actor = await requireLead();
    const fields = readFields(formData, actor.team);
    const { name, email, instruments, gender } = fields;
    // Everyone starts on the default password and picks their own on first login.
    const password = defaultMemberPassword();
    const groupName = String(formData.get("group") ?? "member");

    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "Enter a valid email." };
    if (!instruments.length) return { ok: false, message: `Choose at least one ${rolesWord(actor.team)}.` };

    const db = createAdminClient();
    // Emails are matched across every team: one email is one person.
    const { data: existing } = await db
      .from("profiles")
      .select("id, full_name, gender, is_developer, is_root, team_members(teams(name))")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      if (existing.is_developer || existing.is_root) return { ok: false, message: `That email belongs to ${existing.is_root ? "the root account" : "a developer account"}, which can't be on a team.` };
      if (await membership(actor.team.id, existing.id)) return { ok: false, message: `${existing.full_name || email} is already on this team.` };
      // Already on another team: ask first. Yes links them: the same person (login, name, gender),
      // with a separate profile on this team.
      if (formData.get("link") !== "yes") {
        const teams = ((existing.team_members ?? []) as unknown as { teams: { name: string } | null }[]).flatMap((t) => (t.teams ? [t.teams.name] : []));
        return { ok: false, message: null, link: { name: existing.full_name || email, teams } };
      }
      const { error: tErr } = await db.from("team_members").insert({ team_id: actor.team.id, user_id: existing.id, ...teamFields(fields) });
      if (tErr) return { ok: false, message: tErr.message };
      // Gender is the person's: filled in here only if it was never set.
      if (!existing.gender && gender) await db.from("profiles").update({ gender }).eq("id", existing.id);
      const { data: group } = await db.from("groups").select("id").eq("team_id", actor.team.id).eq("name", groupName).maybeSingle();
      if (group) await db.from("user_groups").insert({ user_id: existing.id, group_id: group.id });
      await db.from("audit_log").insert({ actor_id: actor.id, action: "member.link_team", target: existing.id, details: { team: actor.team.slug, groupName, instruments } });
      newId = existing.id;
    } else {
      if (!name) return { ok: false, message: "Enter their name." };
      if (await nameTaken(name)) return { ok: false, message: `There's already a member called ${name}.` };

      const { data: last } = await db.from("profiles").select("uid").order("uid", { ascending: false, nullsFirst: false }).limit(1);
      const uid = (last?.[0]?.uid ?? 0) + 1;

      // Supabase Auth stores only a bcrypt hash of the password.
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (error) {
        return { ok: false, message: /already|registered|exists/i.test(error.message) ? "That email already has an account." : error.message };
      }
      newId = data.user.id;

      const { error: pErr } = await db
        .from("profiles")
        .update({ uid, full_name: name, gender, must_change_password: true })
        .eq("id", newId);
      if (pErr) {
        await db.auth.admin.deleteUser(newId); // don't leave a half-made account behind
        return { ok: false, message: pErr.code === "23505" ? `There's already a member called ${name}.` : pErr.message };
      }
      await db.from("team_members").insert({ team_id: actor.team.id, user_id: newId, ...teamFields(fields) });
      const { data: group } = await db.from("groups").select("id").eq("team_id", actor.team.id).eq("name", groupName).maybeSingle();
      if (group) await db.from("user_groups").insert({ user_id: newId, group_id: group.id });
      await db.from("audit_log").insert({ actor_id: actor.id, action: "member.create", target: newId, details: { uid, name, groupName, team: actor.team.slug } });
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team", "layout");
  redirect(`/team/${newId}`);
}

export async function updateMember(id: string, _prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  try {
    const actor = await requireLead();
    const fields = readFields(formData, actor.team);
    const { name, email, instruments, emPercent, gender, serves } = fields;
    if (!name) return { ok: false, message: "Enter their name." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "Enter a valid email." };
    if (await nameTaken(name, id)) return { ok: false, message: `There's already a member called ${name}.` };
    const off = await notOnTeam(actor, id);
    if (off) return { ok: false, message: off };

    const db = createAdminClient();
    const { data: current } = await db.from("profiles").select("email").eq("id", id).maybeSingle();
    if (!current) return { ok: false, message: "Member not found." };
    if (current.email !== email) {
      const { error } = await db.auth.admin.updateUserById(id, { email, email_confirm: true });
      if (error) {
        return { ok: false, message: /already|registered|exists/i.test(error.message) ? "That email already has an account." : error.message };
      }
    }
    // The person (every team sees these)...
    const { error } = await db.from("profiles").update({ full_name: name, email, gender, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, message: error.code === "23505" ? `There's already a member called ${name}.` : error.message };
    // ...and their profile on this team only (developer accounts are on no team, so have none).
    const { data: here } = await db.from("team_members").select("no_roster_roles").eq("team_id", actor.team.id).eq("user_id", id).maybeSingle();
    if (here) {
      // A personal rule only covers parts they still play here.
      const noRosterRoles = ((here.no_roster_roles as string[] | null) ?? []).filter((r) => instruments.includes(r));
      const { error: tErr } = await db
        .from("team_members")
        .update({ ...teamFields(fields), no_roster_roles: noRosterRoles })
        .eq("team_id", actor.team.id)
        .eq("user_id", id);
      if (tErr) return { ok: false, message: tErr.message };
    }
    await db.from("audit_log").insert({ actor_id: actor.id, action: "member.update", target: id, details: { name, instruments, emPercent, gender, serves, team: actor.team.slug } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team", "layout");
  return { ok: true, message: "Saved." };
}

/** Root only: put a member back on the default password; they must choose a new one when they next log in. */
export async function resetMemberPassword(id: string): Promise<MemberFormState> {
  try {
    const actor = await requireLead();
    const db = createAdminClient();
    const off = await notOnTeam(actor, id);
    if (off) return { ok: false, message: off };
    const { data: p } = await db.from("profiles").select("full_name, email, is_developer").eq("id", id).maybeSingle();
    if (!p) return { ok: false, message: "Member not found." };
    // The password is shared by every team they're on, so a lead's can't be reset by anyone in a team.
    const { data: leads } = await db.from("team_members").select("team_id").eq("user_id", id).eq("is_lead", true);
    if (leads?.length && !actor.isRoot && !actor.isDeveloper) return { ok: false, message: "A team lead's password can't be reset here. Ask root." };
    if (p.is_developer && !actor.isDeveloper) return { ok: false, message: "Only a developer can reset a developer account." };
    const { error } = await db.auth.admin.updateUserById(id, { password: defaultMemberPassword() });
    if (error) throw error;
    const { error: pErr } = await db.from("profiles").update({ must_change_password: true }).eq("id", id);
    if (pErr) throw pErr;
    await db.from("audit_log").insert({ actor_id: actor.id, action: "member.reset_password", target: id, details: { name: p.full_name || p.email } });
    return { ok: true, message: `${p.full_name || p.email}'s password is back to the default. They'll choose a new one when they next log in.` };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteMember(id: string): Promise<MemberFormState> {
  try {
    const actor = await requireLead();
    const db = createAdminClient();
    const off = await notOnTeam(actor, id);
    if (off) return { ok: false, message: off };
    const { data: p } = await db.from("profiles").select("full_name, uid, is_developer").eq("id", id).maybeSingle();
    if (!p) return { ok: false, message: "Member not found." };
    if ((await membership(actor.team.id, id))?.isLead) return { ok: false, message: "The team's lead can't be removed. Make someone else lead first." };
    if (p.is_developer && !actor.isDeveloper) return { ok: false, message: "Only a developer can delete a developer account." };
    const { data: teams } = await db.from("team_members").select("team_id").eq("user_id", id);
    if ((teams ?? []).some((t) => t.team_id !== actor.team.id)) {
      // Also on another team: take them off this team only (its profile, groups and allows/denies),
      // and keep their login and their other teams' profiles.
      const { data: groups } = await db.from("groups").select("id").eq("team_id", actor.team.id);
      const groupIds = (groups ?? []).map((g) => g.id as string);
      if (groupIds.length) await db.from("user_groups").delete().eq("user_id", id).in("group_id", groupIds);
      await db.from("user_permission_overrides").delete().eq("user_id", id).eq("team_id", actor.team.id);
      const { error } = await db.from("team_members").delete().eq("team_id", actor.team.id).eq("user_id", id);
      if (error) throw error;
      await db.from("audit_log").insert({ actor_id: actor.id, action: "member.leave_team", target: id, details: { name: p.full_name, team: actor.team.slug } });
    } else {
      // Removing the login also removes their profile and group memberships.
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) throw error;
      await db.from("audit_log").insert({ actor_id: actor.id, action: "member.delete", target: id, details: { name: p.full_name, uid: p.uid } });
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team", "layout");
  redirect("/team");
}

/** Root and developers: a member's personal rule, the parts they play but shouldn't be rostered for. */
export async function setNoRosterRoles(id: string, roles: string[]): Promise<MemberFormState> {
  try {
    const actor = await requireLead();
    const off = await notOnTeam(actor, id);
    if (off) return { ok: false, message: off };
    const db = createAdminClient();
    if (!actor.team.config.memberFields.rules) return { ok: false, message: "This team doesn't use personal rules." };
    // Personal rules are per team, like what they play.
    const { data: member } = await db.from("team_members").select("instruments").eq("team_id", actor.team.id).eq("user_id", id).maybeSingle();
    if (!member) return { ok: false, message: "Member not found." };
    // Only parts they actually play here.
    const plays = (member.instruments as string[] | null) ?? [];
    const noRosterRoles = [...new Set(roles)].filter((r) => plays.includes(r));
    const { error } = await db.from("team_members").update({ no_roster_roles: noRosterRoles }).eq("team_id", actor.team.id).eq("user_id", id);
    if (error) return { ok: false, message: error.message };
    await db.from("audit_log").insert({ actor_id: actor.id, action: "member.no_roster_roles", target: id, details: { noRosterRoles, team: actor.team.slug } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team", "layout");
  return { ok: true, message: "Saved." };
}
