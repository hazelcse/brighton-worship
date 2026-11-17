"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TEAM_HOME, VIEW_AS_COOKIE, getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { KIND_TITLE, LOGIN_KIND_COOKIE, TEAM_COOKIE, loginTeam, membership, teamBySlug, type TeamKind } from "@/lib/teams";

export type LoginState = { error: string | null; email: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password.", email };
  }

  const kind: TeamKind = formData.get("kind") === "media" ? "media" : "worship";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "That email and password don't match an account.", email };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active, is_root, is_developer, must_change_password, observer_group")
    .eq("id", data.user.id)
    .single();
  if (!profile?.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "This account has been deactivated. Contact a team admin.", email };
  }
  // The team of this kind they're on (Main Worship, Youth Worship, ...). Root and developers aren't
  // on any team and can log in from either title, as can an observer (it opens its group's worship team).
  const team = await loginTeam(kind, data.user.id, {
    isRoot: Boolean(profile.is_root),
    isDeveloper: Boolean(profile.is_developer),
    observerGroup: (profile.observer_group as "main" | "youth" | null) ?? null,
  });
  if (!team) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: `You're not on a ${kind} team. Hold the title to switch to ${KIND_TITLE[kind === "worship" ? "media" : "worship"]}.`, email };
  }

  (await cookies()).set(TEAM_COOKIE, team.slug, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  (await cookies()).set(LOGIN_KIND_COOKIE, kind, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  (await cookies()).delete(VIEW_AS_COOKIE); // "view as" names a group or person in the last team
  redirect(profile.must_change_password ? "/change-password" : "/home");
}

export type ChangePasswordState = { error: string | null };

/** First login: replace the default password with one the member chooses. */
export async function changePassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return { error: "You are signed out. Please log in again." };

  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };
  if (password === process.env.DEFAULT_MEMBER_PASSWORD) return { error: "Choose a password that isn't the default one." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: /different from the old/i.test(error.message) ? "Choose a password that isn't the default one." : error.message };
  }
  await createAdminClient().from("profiles").update({ must_change_password: false }).eq("id", userId);
  await createAdminClient().from("audit_log").insert({ actor_id: userId, action: "password.change", target: userId });

  redirect("/home");
}

export async function signOut() {
  const supabase = await createClient();
  // Only this browser. The default ("global") would also end the account's sessions on every
  // other device, e.g. a phone, or other people sharing a developer account.
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(VIEW_AS_COOKIE); // a developer's "view as" ends with the session
  redirect("/");
}

/**
 * Someone on more than one team (e.g. Main Worship and Youth Worship): switch to another of their
 * teams from the profile menu. Opens that team's home (the media app for a media team).
 */
export async function switchTeam(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const realId = user.viewingAsPerson?.realId ?? user.id;
  const team = await teamBySlug(String(formData.get("team") ?? ""));
  // Only a team they're on (root and developers switch from the Teams page instead).
  if (!team || !(await membership(team.id, realId))) redirect(TEAM_HOME[user.team.kind]);
  const jar = await cookies();
  jar.set(TEAM_COOKIE, team.slug, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  jar.set(LOGIN_KIND_COOKIE, team.kind, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  jar.delete(VIEW_AS_COOKIE); // "view as" names a group or person in the last team
  redirect(TEAM_HOME[team.kind]);
}
