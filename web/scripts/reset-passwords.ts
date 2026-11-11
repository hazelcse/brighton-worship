/**
 * Puts every member back on the default password; each must choose a new one on next login.
 *
 *   npm run reset-passwords
 *
 * Root and developer accounts are left alone. Reads DEFAULT_MEMBER_PASSWORD from .env.local.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEFAULT_MEMBER_PASSWORD ?? "";
if (!url || !key || password.length < 6) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEFAULT_MEMBER_PASSWORD (6+ characters) in web/.env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data, error } = await db.from("profiles").select("id, full_name, email").eq("is_root", false).eq("is_developer", false);
  if (error) throw error;
  let done = 0;
  for (const p of data ?? []) {
    const { error: aErr } = await db.auth.admin.updateUserById(p.id, { password });
    if (aErr) throw new Error(`${p.full_name || p.email}: ${aErr.message}`);
    const { error: pErr } = await db.from("profiles").update({ must_change_password: true }).eq("id", p.id);
    if (pErr) throw new Error(`${p.full_name || p.email}: ${pErr.message}`);
    done++;
  }
  console.log(`Reset ${done} member password(s) to the default. Root and developers were not changed.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
