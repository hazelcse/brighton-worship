"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { overseesLeads, requireLead, requirePermissionsManager, type CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { defaultMemberPassword } from "@/lib/default-password";
import { membership } from "@/lib/teams";
import { logMemberChange } from "@/lib/serving";

/** The team's groups among these ids (anything else is ignored). */
async function teamGroupIds(teamId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await createAdminClient().from("groups").select("id").eq("team_id", teamId).in("id", ids);
  return (data ?? []).map((g) => g.id as string);
}

export type ActionResult = { ok: boolean; message: string | null };

const isPermission = (v: string): v is Permission => (PERMISSIONS as readonly string[]).includes(v);

async function audit(actor: CurrentUser, action: string, target: string, details: object = {}) {
  await createAdminClient()
    .from("audit_log")
    .insert({ actor_id: actor.id, action, target, details });
}

/**
 * Privilege-escalation guard (like IAM's "you can't grant what you don't have"):
 * a non-root admin may only hand out permissions they hold themselves.
 */
function assertCanGrant(actor: CurrentUser, perms: Iterable<string>) {
  // The lead, and the observer that oversees the team, may hand out anything within the team's ceiling.
  if (actor.isLead || actor.observerManagesPermissions) return;
  const missing = [...perms].filter((p) => !actor.permissions.has(p));
  if (missing.length) {
    throw new Error(`You can't grant permissions you don't have: ${missing.join(", ")}`);
  }
}

async function groupPermissions(groupIds: string[]): Promise<string[]> {
  if (!groupIds.length) return [];
  const { data, error } = await createAdminClient()
    .from("group_permissions")
    .select("permission_key")
    .in("group_id", groupIds);
  if (error) throw error;
  return data.map((r) => r.permission_key);
}

function fail(e: unknown): ActionResult {
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function createUser(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let newId: string;
  try {
    const actor = await requireLead();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const fullName = String(formData.get("full_name") ?? "").trim();
    // Everyone starts on the default password and picks their own on first login.
    const password = defaultMemberPassword();
    const groupIds = await teamGroupIds(actor.team.id, formData.getAll("group_ids").map(String));

    if (!email.includes("@")) return { ok: false, message: "Enter a valid email." };
    assertCanGrant(actor, await groupPermissions(groupIds));

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) return { ok: false, message: error.message };
    newId = data.user.id;
    await admin.from("profiles").update({ must_change_password: true }).eq("id", newId);
    await admin.from("team_members").insert({ team_id: actor.team.id, user_id: newId });

    if (groupIds.length) {
      const { error: gErr } = await admin
        .from("user_groups")
        .insert(groupIds.map((group_id) => ({ user_id: newId, group_id })));
      if (gErr) throw gErr;
    }
    await audit(actor, "user.create", newId, { email, groupIds });
    await logMemberChange(actor, "member_added", newId, fullName || email);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team/permissions");
  redirect(`/team/permissions/users/${newId}`);
}

export async function updateUserAccess(
  userId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const actor = await requirePermissionsManager();
    if (userId === actor.id && !actor.isLead && !actor.observerManagesPermissions) {
      return { ok: false, message: "You can't change your own access. Ask another admin." };
    }

    const admin = createAdminClient();
    const { data: target } = await admin
      .from("profiles")
      .select("is_root, is_developer")
      .eq("id", userId)
      .single();
    const place = await membership(actor.team.id, userId);
    if (!target || !place) return { ok: false, message: "User not found." };
    if (target.is_root || target.is_developer) return { ok: false, message: "This account's access can't be changed here." };
    if (place.isLead) {
      // The lead has everything the team may do; the observer (or root) can take some of it away.
      if (!overseesLeads(actor)) return { ok: false, message: "The team lead's access can't be changed." };
      const denies = PERMISSIONS.filter((p) => formData.get(`override:${p}`) === "deny");
      const { error: dErr } = await admin.from("user_permission_overrides").delete().eq("user_id", userId).eq("team_id", actor.team.id);
      if (dErr) throw dErr;
      if (denies.length) {
        const { error } = await admin
          .from("user_permission_overrides")
          .insert(denies.map((permission_key) => ({ permission_key, effect: "deny", user_id: userId, team_id: actor.team.id })));
        if (error) throw error;
      }
      await audit(actor, "user.update_access", userId, { lead: true, denies });
      revalidatePath("/team/permissions", "layout");
      return { ok: true, message: "Saved." };
    }

    const fullName = String(formData.get("full_name") ?? "").trim();
    const isActive = formData.get("is_active") === "on";
    const groupIds = await teamGroupIds(actor.team.id, formData.getAll("group_ids").map(String));
    const overrides: { permission_key: Permission; effect: "allow" | "deny" }[] = [];
    for (const p of PERMISSIONS) {
      const v = formData.get(`override:${p}`);
      if (v === "allow" || v === "deny") overrides.push({ permission_key: p, effect: v });
    }

    assertCanGrant(actor, [
      ...(await groupPermissions(groupIds)),
      ...overrides.filter((o) => o.effect === "allow").map((o) => o.permission_key),
    ]);

    // Replace this team's group memberships and overrides (other teams' stay as they are).
    const { data: allTeamGroups } = await admin.from("groups").select("id").eq("team_id", actor.team.id);
    const steps = await Promise.all([
      admin.from("profiles").update({ full_name: fullName, is_active: isActive, updated_at: new Date().toISOString() }).eq("id", userId),
      admin.from("user_groups").delete().eq("user_id", userId).in("group_id", (allTeamGroups ?? []).map((g) => g.id as string)),
      admin.from("user_permission_overrides").delete().eq("user_id", userId).eq("team_id", actor.team.id),
    ]);
    for (const s of steps) if (s.error) throw s.error;

    if (groupIds.length) {
      const { error } = await admin
        .from("user_groups")
        .insert(groupIds.map((group_id) => ({ user_id: userId, group_id })));
      if (error) throw error;
    }
    if (overrides.length) {
      const { error } = await admin
        .from("user_permission_overrides")
        .insert(overrides.map((o) => ({ ...o, user_id: userId, team_id: actor.team.id })));
      if (error) throw error;
    }

    // Deactivated users are blocked from signing in again.
    await admin.auth.admin.updateUserById(userId, { ban_duration: isActive ? "none" : "876000h" });

    await audit(actor, "user.update_access", userId, { isActive, groupIds, overrides });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team/permissions", "layout");
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export async function createGroup(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const actor = await requirePermissionsManager();
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    if (!name) return { ok: false, message: "Give the group a name." };

    const { data, error } = await createAdminClient()
      .from("groups")
      .insert({ name, description, team_id: actor.team.id })
      .select("id")
      .single();
    if (error) {
      return { ok: false, message: error.code === "23505" ? "A group with that name already exists." : error.message };
    }
    id = data.id;
    await audit(actor, "group.create", id, { name });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team/permissions");
  redirect(`/team/permissions/groups/${id}`);
}

export async function updateGroup(
  groupId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const actor = await requirePermissionsManager();
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const perms = formData.getAll("permissions").map(String).filter(isPermission);
    if (!name) return { ok: false, message: "Give the group a name." };
    assertCanGrant(actor, perms);

    const admin = createAdminClient();
    const { data: own } = await admin.from("groups").select("id").eq("id", groupId).eq("team_id", actor.team.id).maybeSingle();
    if (!own) return { ok: false, message: "That permission group doesn't exist." };
    const { error: uErr } = await admin.from("groups").update({ name, description }).eq("id", groupId);
    if (uErr) {
      return { ok: false, message: uErr.code === "23505" ? "A group with that name already exists." : uErr.message };
    }
    const { error: dErr } = await admin.from("group_permissions").delete().eq("group_id", groupId);
    if (dErr) throw dErr;
    if (perms.length) {
      const { error } = await admin
        .from("group_permissions")
        .insert(perms.map((permission_key) => ({ group_id: groupId, permission_key })));
      if (error) throw error;
    }
    // Who is in the group (the group page lists everyone with a tick box).
    let memberIds: string[] | undefined;
    if (formData.get("set_members")) {
      // Only people on this team can be in its groups.
      const { data: onTeam } = await admin.from("team_members").select("user_id").eq("team_id", actor.team.id);
      const teamIds = new Set((onTeam ?? []).map((t) => t.user_id as string));
      memberIds = formData.getAll("member_ids").map(String).filter((m) => teamIds.has(m));
      const { error: mErr } = await admin.from("user_groups").delete().eq("group_id", groupId);
      if (mErr) throw mErr;
      if (memberIds.length) {
        const { error } = await admin
          .from("user_groups")
          .insert(memberIds.map((user_id) => ({ user_id, group_id: groupId })));
        if (error) throw error;
      }
    }
    await audit(actor, "group.update", groupId, { name, perms, memberIds });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team/permissions", "layout");
  return { ok: true, message: "Saved." };
}

/**
 * Hand the team's lead to another member. The lead does it after typing their password; root and
 * developers can also choose a team's lead (they type their own password). The old lead can join
 * one of the team's groups.
 */
export async function transferLead(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ok = false;
  let wasLead = false;
  try {
    const actor = await requirePermissionsManager();
    const db = createAdminClient();
    const isLeadNow = (await membership(actor.team.id, actor.id))?.isLead ?? false;
    const overseer = overseesLeads(actor);
    wasLead = isLeadNow;
    if (!isLeadNow && !overseer) return { ok: false, message: "Only the team's lead can hand over the lead." };
    const { data: me } = await db.from("profiles").select("email").eq("id", actor.id).maybeSingle();
    if (!me) return { ok: false, message: "Account not found." };

    const to = String(formData.get("new_root") ?? "");
    const group = String(formData.get("my_group") ?? "") || null;
    const password = String(formData.get("password") ?? "");
    if (!to) return { ok: false, message: "Choose who becomes the lead." };
    if (!password) return { ok: false, message: "Type your password to confirm." };

    // Check the password with a throwaway sign-in that never touches this browser's session.
    const { createClient } = await import("@supabase/supabase-js");
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("@/lib/env");
    const check = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: pwError } = await check.auth.signInWithPassword({ email: me.email as string, password });
    if (pwError) {
      await audit(actor, "lead.transfer_denied", to, { reason: "wrong password", team: actor.team.slug });
      return { ok: false, message: "That password isn't right." };
    }

    const { error } = await db.rpc("transfer_lead", { p_team: actor.team.id, p_to: to, p_from_group: group });
    if (error) return { ok: false, message: error.message };
    await audit(actor, "lead.transfer", to, { team: actor.team.slug, old_lead_joins_group: group });
    ok = true;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
  revalidatePath("/", "layout");
  // The old lead loses the permissions pages, so leave them; root or a developer keeps them.
  if (ok && wasLead) redirect("/team");
  return ok ? { ok: true, message: "Lead changed." } : { ok, message: null };
}
