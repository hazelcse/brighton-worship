"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VIEW_AS_COOKIE } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type LoginState = { error: string | null; email: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password.", email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "That email and password don't match an account.", email };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active, must_change_password")
    .eq("id", data.user.id)
    .single();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "This account has been deactivated. Contact a worship team admin.", email };
  }

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
