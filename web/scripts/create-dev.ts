/**
 * Creates (or updates) the developer account.
 *
 *   npm run create-dev
 *
 * Reads DEV_EMAIL, DEV_PASSWORD and DEV_NAME (default "Dev") from .env.local.
 * A developer has root's powers plus "View as" (root, a permission group, or one person,
 * read-only). It isn't a team member: only root sees it on the Team page, it has no member
 * number, and it's never rostered. Safe to run more than once.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.DEV_EMAIL?.trim().toLowerCase();
const password = process.env.DEV_PASSWORD;
const fullName = process.env.DEV_NAME?.trim() || "Dev";

if (!url || !serviceKey || !email || !password) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEV_EMAIL and DEV_PASSWORD in web/.env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  let userId: string;
  const { data: found } = await admin.from("profiles").select("id, is_root").eq("email", email).maybeSingle();
  if (found) {
    if (found.is_root) throw new Error(`${email} is the root user; use a different email for the developer account.`);
    userId = found.id;
    console.log(`${email} already exists. Making sure it is a developer…`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`Created ${email}.`);
  }

  const { error } = await admin
    .from("profiles")
    .update({ is_developer: true, is_active: true, full_name: fullName, uid: null, must_change_password: false })
    .eq("id", userId);
  if (error) throw error;
  // Developers have every permission already; group memberships would only clutter the group lists.
  await admin.from("user_groups").delete().eq("user_id", userId);
  console.log("Developer account is ready. Log in at http://localhost:3000");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
