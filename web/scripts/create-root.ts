/**
 * Creates (or promotes) the single root account. Root is app-wide, like a developer: it has every
 * permission in every team, opens any team from the login page, and creates teams (Manage teams).
 * Each team's own head is its lead, chosen on Manage teams or the team's permissions page.
 * Root is never on a team: ROOT_EMAIL must not belong to a team member.
 *
 *   npm run create-root
 *
 * Reads ROOT_EMAIL, ROOT_PASSWORD and ROOT_NAME from .env.local.
 * Safe to run more than once.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ROOT_EMAIL?.trim().toLowerCase();
const password = process.env.ROOT_PASSWORD;
const fullName = process.env.ROOT_NAME ?? "Root";

if (!url || !serviceKey || !email || !password) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ROOT_EMAIL and ROOT_PASSWORD in web/.env.local",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: existing } = await admin
    .from("profiles")
    .select("id, email")
    .eq("is_root", true)
    .maybeSingle();
  if (existing && existing.email !== email) {
    throw new Error(`A different root user already exists (${existing.email}).`);
  }

  let userId: string;
  const { data: found } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (found) {
    userId = found.id;
    // Root sits above every team, so it must be its own account, not a team member's.
    const { count } = await admin.from("team_members").select("team_id", { count: "exact", head: true }).eq("user_id", userId);
    if (count) {
      throw new Error(
        `${email} is on ${count === 1 ? "a team" : `${count} teams`}, so it can't be root. Set ROOT_EMAIL to an email that isn't on any team.`,
      );
    }
    console.log(`User ${email} already exists. Making sure it is root…`);
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
    .update({ is_root: true, is_active: true, full_name: fullName })
    .eq("id", userId);
  if (error) throw error;
  console.log("Root user is ready. Log in at http://localhost:3000");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
