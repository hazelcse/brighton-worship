import { createAdminClient } from "@/lib/supabase/admin";

/** What a member can play or do. Values are stored lower case; labels are for display. */
export const INSTRUMENTS = [
  { value: "keys", label: "Keys" },
  { value: "synth/pads", label: "Synth/Pads" },
  { value: "electric guitar", label: "Electric Guitar" },
  { value: "acoustic guitar", label: "Acoustic Guitar" },
  { value: "bass", label: "Bass" },
  { value: "drums", label: "Drums" },
  { value: "worship leader", label: "Worship Leader" },
  { value: "vocalist", label: "Vocalist" },
  // Band leader and talkback are one job, done by the same person.
  { value: "band leader", label: "BL/TB" },
] as const;

export type Instrument = (typeof INSTRUMENTS)[number]["value"];
export const INSTRUMENT_LABEL = Object.fromEntries(INSTRUMENTS.map((i) => [i.value, i.label])) as Record<string, string>;
export const isInstrument = (v: string): v is Instrument => INSTRUMENTS.some((i) => i.value === v);

/** 100 = EM only, 0 = CM only, anything between = serves both. */
export function ministryLabel(emPercent: number | null): string | null {
  if (emPercent === null || emPercent === undefined) return null;
  if (emPercent >= 100) return "EM";
  if (emPercent <= 0) return "CM";
  return "EM/CM";
}

export type Gender = "male" | "female";
export type Serves = "both" | "sunday" | "pnp";
export const SERVES_LABEL: Record<Serves, string> = { both: "Sunday & P&P", sunday: "Sunday only", pnp: "P&P only" };
export const GENDER_LABEL: Record<Gender, string> = { male: "Male", female: "Female" };

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith("@placeholder.invalid");
}

export type Member = {
  id: string;
  uid: number | null;
  name: string;
  email: string;
  instruments: string[];
  /** Their personal rule: parts they can play but shouldn't be rostered for. */
  noRosterRoles: string[];
  emPercent: number | null;
  gender: Gender | null;
  serves: Serves;
  isRoot: boolean;
  isDeveloper: boolean;
  isActive: boolean;
  groups: string[];
};

type Row = {
  id: string;
  uid: number | null;
  full_name: string;
  email: string;
  instruments: string[] | null;
  no_roster_roles: string[] | null;
  em_percent: number | null;
  gender: Gender | null;
  serves: Serves | null;
  is_root: boolean;
  is_developer: boolean | null;
  is_active: boolean;
  user_groups: { groups: { name: string } | null }[] | null;
};

function toMember(r: Row): Member {
  return {
    id: r.id,
    uid: r.uid,
    name: r.full_name || r.email,
    email: r.email,
    instruments: r.instruments ?? [],
    noRosterRoles: r.no_roster_roles ?? [],
    emPercent: r.em_percent,
    gender: r.gender,
    serves: r.serves ?? "both",
    isRoot: r.is_root,
    isDeveloper: Boolean(r.is_developer),
    isActive: r.is_active,
    groups: (r.user_groups ?? []).map((g) => g.groups?.name).filter((n): n is string => Boolean(n)),
  };
}

const SELECT = "id, uid, full_name, email, instruments, no_roster_roles, em_percent, gender, serves, is_root, is_developer, is_active, user_groups(groups(name))";

/**
 * The team. Developer accounts aren't team members: they're left out unless includeDevelopers
 * (root's view), and are never rostered or counted.
 */
export async function loadMembers({ includeDevelopers = false } = {}): Promise<Member[]> {
  let query = createAdminClient().from("profiles").select(SELECT);
  if (!includeDevelopers) query = query.eq("is_developer", false);
  const { data, error } = await query.order("uid", { nullsFirst: false }).order("full_name");
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toMember);
}

export async function loadMember(id: string, { includeDevelopers = false } = {}): Promise<Member | null> {
  const { data } = await createAdminClient().from("profiles").select(SELECT).eq("id", id).maybeSingle();
  const m = data ? toMember(data as unknown as Row) : null;
  return m && (!m.isDeveloper || includeDevelopers) ? m : null;
}
