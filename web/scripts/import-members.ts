/**
 * Create team member accounts from members.json (in the repo root).
 *
 *   npm run import-members [-- path/to/members.json]
 *
 * - The key of each entry is the member's uid. Re-running updates existing members (matched by uid).
 * - New members start on DEFAULT_MEMBER_PASSWORD and must change it on first login; the
 *   passwords in members.json are ignored. Existing members (and root) keep their password.
 * - Emails must be unique per login. When several members share one (a placeholder), the first keeps
 *   it and the others get a non-deliverable placeholder (…@placeholder.invalid) to replace later.
 * - Members join the worship team (or TEAM=<slug>); new members join its "member" permission group.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const INSTRUMENTS = [
  "keys", "synth/pads", "electric guitar", "acoustic guitar", "bass", "drums",
  "worship leader", "vocalist", "band leader",
];
// Band leader and talkback are one job now: either one means both.
const ALIASES: Record<string, string> = { talkback: "band leader", "bl/tb": "band leader" };
const normalise = (i: string) => ALIASES[i.trim().toLowerCase()] ?? i.trim().toLowerCase();

type Entry = {
  name: string;
  email: string;
  password: string;
  instrument?: string[];
  gender?: string;
  ministry?: string[];
  em_percent?: number | null; // exact EM/CM split (0-100); wins over ministry
  serves?: string; // both | sunday | pnp
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in web/.env.local");
  process.exit(1);
}
const defaultPassword = process.env.DEFAULT_MEMBER_PASSWORD ?? "";
if (defaultPassword.length < 6) {
  console.error("Set DEFAULT_MEMBER_PASSWORD (at least 6 characters) in web/.env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

function readMembers(path: string): Record<string, Entry> {
  // Tolerate trailing commas, which hand-edited JSON often has.
  const text = readFileSync(path, "utf8").replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(text);
}

function emPercent(ministry: string[] = []): number | null {
  const m = new Set(ministry.map((x) => x.trim().toUpperCase()));
  if (m.has("EM") && m.has("CM")) return 50;
  if (m.has("EM")) return 100;
  if (m.has("CM")) return 0;
  return null;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") || "member";
}

async function main() {
  const path = resolve(process.argv[2] ?? "../members.json");
  const members = readMembers(path);

  // Members join Main Worship (TEAM=<slug> to import into another team).
  const teamSlug = process.env.TEAM ?? "main-worship";
  const { data: team } = await db.from("teams").select("id").eq("slug", teamSlug).single();
  if (!team) throw new Error(`There's no team "${teamSlug}". Run the migrations first.`);
  const { data: group } = await db.from("groups").select("id").eq("team_id", team.id).eq("name", "member").single();
  if (!group) throw new Error('The team\'s "member" permission group is missing. Run the migrations first.');

  // Which emails appear more than once (placeholders)?
  const seen = new Map<string, number>();
  for (const e of Object.values(members)) {
    const em = e.email.trim().toLowerCase();
    seen.set(em, (seen.get(em) ?? 0) + 1);
  }
  const claimed = new Set<string>();

  let created = 0, updated = 0;
  const placeholders: string[] = [];
  for (const [uidText, e] of Object.entries(members).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const uid = Number(uidText);
    const name = e.name.trim();
    let email = e.email.trim().toLowerCase();
    if ((seen.get(email) ?? 0) > 1 && claimed.has(email)) {
      email = `${slug(name)}@placeholder.invalid`;
      placeholders.push(`#${uid} ${name}`);
    }
    claimed.add(email);

    const instruments = [...new Set((e.instrument ?? []).map(normalise).filter((i) => INSTRUMENTS.includes(i)))];
    const unknown = (e.instrument ?? []).filter((i) => !INSTRUMENTS.includes(normalise(i)));
    if (unknown.length) console.warn(`#${uid} ${name}: ignored unknown instrument(s) ${unknown.join(", ")}`);
    const fields = {
      uid,
      full_name: name,
      gender: e.gender === "male" || e.gender === "female" ? e.gender : null,
    };
    // Their profile on this team (someone on two teams has a separate one on each).
    const teamFields = {
      instruments,
      em_percent: typeof e.em_percent === "number" ? e.em_percent : emPercent(e.ministry),
      ...(e.serves === "both" || e.serves === "sunday" || e.serves === "pnp" ? { serves: e.serves } : {}),
    };

    // Existing member? Match by uid, then by email.
    const { data: byUid } = await db.from("profiles").select("id, is_root").eq("uid", uid).maybeSingle();
    const { data: byEmail } = byUid ? { data: null } : await db.from("profiles").select("id, is_root").eq("email", email).maybeSingle();
    const existing = byUid ?? byEmail;

    let id: string;
    let isNew = false;
    if (existing) {
      id = existing.id;
      // Existing members keep the password they chose; only their email is synced.
      if (!existing.is_root) {
        const { error } = await db.auth.admin.updateUserById(id, { email, email_confirm: true });
        if (error) throw new Error(`#${uid} ${name}: ${error.message}`);
      }
      updated++;
    } else {
      // New members start on the default password and must change it on first login.
      const { data, error } = await db.auth.admin.createUser({
        email,
        password: defaultPassword,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (error) throw new Error(`#${uid} ${name}: ${error.message}`);
      id = data.user.id;
      isNew = true;
      await db.from("user_groups").insert({ user_id: id, group_id: group.id });
      created++;
    }
    const { error } = await db
      .from("profiles")
      .update({ ...fields, email, ...(isNew ? { must_change_password: true } : {}) })
      .eq("id", id);
    if (error) throw new Error(`#${uid} ${name}: ${error.message}`);
    const { error: tErr } = await db.from("team_members").upsert({ team_id: team.id, user_id: id, ...teamFields }, { onConflict: "team_id,user_id" });
    if (tErr) throw new Error(`#${uid} ${name}: ${tErr.message}`);
  }

  // New members created in the app continue from the highest uid.
  const { data: max } = await db.from("profiles").select("uid").order("uid", { ascending: false, nullsFirst: false }).limit(1);
  console.log(`Created ${created}, updated ${updated}. Highest uid: ${max?.[0]?.uid ?? "-"}.`);
  if (placeholders.length) {
    console.log(`Shared email replaced with a placeholder for: ${placeholders.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
