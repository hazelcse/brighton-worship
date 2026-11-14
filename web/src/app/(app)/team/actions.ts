"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRoot } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInstrument } from "@/lib/team";
import { defaultMemberPassword } from "@/lib/default-password";

export type MemberFormState = { ok: boolean; message: string | null };

function fail(e: unknown): MemberFormState {
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
}

function readFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const instruments = [...new Set(formData.getAll("instruments").map(String))].filter(isInstrument);
  const cm = Number(formData.get("cm_percent"));
  const emPercent = Number.isFinite(cm) ? Math.min(100, Math.max(0, Math.round(100 - cm))) : null;
  const g = String(formData.get("gender") ?? "");
  const gender = g === "male" || g === "female" ? g : null;
  const sv = String(formData.get("serves") ?? "both");
  const serves = sv === "sunday" || sv === "pnp" ? sv : "both";
  return { name, email, instruments, emPercent, gender, serves };
}

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
    const actor = await requireRoot();
    const { name, email, instruments, emPercent, gender, serves } = readFields(formData);
    // Everyone starts on the default password and picks their own on first login.
    const password = defaultMemberPassword();
    const groupName = String(formData.get("group") ?? "member");

    if (!name) return { ok: false, message: "Enter their name." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "Enter a valid email." };
    if (!instruments.length) return { ok: false, message: "Choose at least one instrument." };
    if (await nameTaken(name)) return { ok: false, message: `There's already a member called ${name}.` };

    const db = createAdminClient();
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
      .update({ uid, full_name: name, instruments, em_percent: emPercent, gender, serves, must_change_password: true })
      .eq("id", newId);
    if (pErr) {
      await db.auth.admin.deleteUser(newId); // don't leave a half-made account behind
      return { ok: false, message: pErr.code === "23505" ? `There's already a member called ${name}.` : pErr.message };
    }
    const { data: group } = await db.from("groups").select("id").eq("name", groupName).maybeSingle();
    if (group) await db.from("user_groups").insert({ user_id: newId, group_id: group.id });
    await db.from("audit_log").insert({ actor_id: actor.id, action: "member.create", target: newId, details: { uid, name, groupName } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team", "layout");
  redirect(`/team/${newId}`);
}

export async function updateMember(id: string, _prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  try {
    const actor = await requireRoot();
    const { name, email, instruments, emPercent, gender, serves } = readFields(formData);
    if (!name) return { ok: false, message: "Enter their name." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "Enter a valid email." };
    if (await nameTaken(name, id)) return { ok: false, message: `There's already a member called ${name}.` };

    const db = createAdminClient();
    const { data: current } = await db.from("profiles").select("email").eq("id", id).maybeSingle();
    if (!current) return { ok: false, message: "Member not found." };
    if (current.email !== email) {
      const { error } = await db.auth.admin.updateUserById(id, { email, email_confirm: true });
      if (error) {
        return { ok: false, message: /already|registered|exists/i.test(error.message) ? "That email already has an account." : error.message };
      }
    }
    const { error } = await db
      .from("profiles")
      .update({ full_name: name, email, instruments, em_percent: emPercent, gender, serves, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, message: error.code === "23505" ? `There's already a member called ${name}.` : error.message };
    await db.from("audit_log").insert({ actor_id: actor.id, action: "member.update", target: id, details: { name, instruments, emPercent, gender, serves } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team", "layout");
  return { ok: true, message: "Saved." };
}

/** Root only: put a member back on the default password; they must choose a new one when they next log in. */
export async function resetMemberPassword(id: string): Promise<MemberFormState> {
  try {
    const actor = await requireRoot();
    const db = createAdminClient();
    const { data: p } = await db.from("profiles").select("full_name, email, is_root, is_developer").eq("id", id).maybeSingle();
    if (!p) return { ok: false, message: "Member not found." };
    if (p.is_root) return { ok: false, message: "The root account's password can't be reset here." };
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
    const actor = await requireRoot();
    const db = createAdminClient();
    const { data: p } = await db.from("profiles").select("full_name, uid, is_root, is_developer").eq("id", id).maybeSingle();
    if (!p) return { ok: false, message: "Member not found." };
    if (p.is_root) return { ok: false, message: "The root user can't be deleted." };
    if (p.is_developer && !actor.isDeveloper) return { ok: false, message: "Only a developer can delete a developer account." };
    // Removing the login also removes their profile and group memberships.
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw error;
    await db.from("audit_log").insert({ actor_id: actor.id, action: "member.delete", target: id, details: { name: p.full_name, uid: p.uid } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team", "layout");
  redirect("/team");
}

/** Root and developers: a member's personal rule, the parts they play but shouldn't be rostered for. */
export async function setNoRosterRoles(id: string, roles: string[]): Promise<MemberFormState> {
  try {
    const actor = await requireRoot();
    const db = createAdminClient();
    const { data: member } = await db.from("profiles").select("instruments").eq("id", id).maybeSingle();
    if (!member) return { ok: false, message: "Member not found." };
    // Only parts they actually play.
    const plays = (member.instruments as string[] | null) ?? [];
    const noRosterRoles = [...new Set(roles)].filter((r) => plays.includes(r));
    const { error } = await db.from("profiles").update({ no_roster_roles: noRosterRoles, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, message: error.message };
    await db.from("audit_log").insert({ actor_id: actor.id, action: "member.no_roster_roles", target: id, details: { noRosterRoles } });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team", "layout");
  return { ok: true, message: "Saved." };
}
