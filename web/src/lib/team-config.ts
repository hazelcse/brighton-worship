/**
 * How teams are organised and configured. Shared by the server and the browser.
 *
 * There are two groups, Main and Youth, and each has a worship team and a media team:
 *
 *   Main  · Main Worship, Main Media
 *   Youth · Youth Worship, Youth Media
 *
 * Each team's configuration lives on its row in the database (teams.config, with teams.team_group
 * and teams.kind), so the app and the roster worker read the same thing. To change how a team
 * works, change its config there (a migration, like 20261116200000_team_config.sql). A new team
 * starts from PRESETS for its group and kind. Everything that differs between teams reads its
 * config through the helpers below; nothing checks a team's slug.
 */
import { SESSION_TYPES, scheduleText, type Composition, type RegularKind, type SessionType } from "@/lib/roster";

export type TeamGroup = "main" | "youth";
export type TeamKind = "worship" | "media";

export const TEAM_GROUPS: readonly TeamGroup[] = ["main", "youth"];
export const GROUP_LABEL: Record<TeamGroup, string> = { main: "Main", youth: "Youth" };
export const KIND_LABEL: Record<TeamKind, string> = { worship: "Worship", media: "Media" };

/**
 * Everything a member can play or do, on any team: the worship band's instruments and the media
 * teams' roles. Values are stored lower case (team_members.instruments); labels are for display.
 * Which ones a team offers is its config's "roles".
 */
export const ROLE_CATALOGUE = [
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
  { value: "media ic", label: "Media IC"},
  { value: "wide angle cam", label: "Wide Angle Cam" },
  { value: "close up cam", label: "Close Up Cam" },
  { value: "roving cam", label: "Roving Cam" },
  { value: "director", label: "Director" },
  { value: "video mixer", label: "Video Mixer" },
  { value: "projectionist", label: "Projectionist" },
  { value: "lights", label: "Lights" },
  { value: "soundboard", label: "Soundboard" },
] as const;

export type RoleValue = (typeof ROLE_CATALOGUE)[number]["value"];
export const ROLE_LABEL = Object.fromEntries(ROLE_CATALOGUE.map((r) => [r.value, r.label])) as Record<string, string>;
export const isRole = (v: string): v is RoleValue => ROLE_CATALOGUE.some((r) => r.value === v);

const WORSHIP_ROLES: RoleValue[] = ["keys", "synth/pads", "electric guitar", "acoustic guitar", "bass", "drums", "worship leader", "vocalist", "band leader"];

export type TeamConfig = {
  /**
   * The regular sessions a new roster starts with, from the catalogue (roster.ts SESSION_TYPES),
   * e.g. ["saturday"]. Empty: rosters start empty (sessions are added by hand).
   */
  sessionKinds: RegularKind[];
  /**
   * What members can play or do on this team, from ROLE_CATALOGUE, in display order: a worship
   * team's instruments or a media team's roles.
   */
  roles: RoleValue[];
  /**
   * Member settings this team uses. They're on each member's profile for this team
   * (team_members); a team that doesn't use one neither shows nor saves it, and its rosters
   * ignore it.
   *  - ministry: each person's EM/CM share.
   *  - serves: Sunday services and/or Prayer & Praise.
   *  - rules: personal rules (parts someone plays but shouldn't be rostered for).
   */
  memberFields: { ministry: boolean; serves: boolean; rules: boolean };
  /** Media teams: the worship team (slug) whose sessions they work on, e.g. "youth-worship". */
  sessionsFrom?: string;
  /**
   * The parts each of this team's regular sessions needs, in place of the catalogue's band (roster.ts
   * SESSION_TYPES), e.g. Main Media's crew for EM Sunday. Kinds left out use the catalogue's.
   */
  compositions?: Partial<Record<RegularKind, Composition>>;
};

/** What a team of each group and kind starts with. The four existing teams were set up from these. */
export const PRESETS: Record<TeamGroup, Record<TeamKind, TeamConfig>> = {
  main: {
    worship: {
      sessionKinds: ["em_sunday", "cm_sunday", "em_pnp", "cm_pnp"],
      roles: WORSHIP_ROLES,
      memberFields: { ministry: true, serves: true, rules: true },
    },
    media: {
      sessionKinds: ["em_sunday", "em_pnp"],
      roles: ["media ic", "wide angle cam", "roving cam", "close up cam", "director", "video mixer", "projectionist", "lights"],
      memberFields: { ministry: false, serves: false, rules: true },
      sessionsFrom: "main-worship",
      compositions: {
        em_sunday: {
          "media ic": 1,
          director: 1,
          "video mixer": 1,
          "roving cam": 2,
          "wide angle cam": 1,
          "close up cam": 1,
          projectionist: 1,
          lights: 1,
        },
        em_pnp: { projectionist: 1, lights: 1 },
      },
    },
  },
  youth: {
    worship: { sessionKinds: ["saturday"], roles: WORSHIP_ROLES, memberFields: { ministry: false, serves: false, rules: true } },
    media: {
      sessionKinds: [],
      roles: ["projectionist", "soundboard"],
      memberFields: { ministry: false, serves: false, rules: false },
      sessionsFrom: "youth-worship",
    },
  },
};

/** A fresh copy of the preset for this group and kind. */
export function presetFor(group: TeamGroup, kind: TeamKind): TeamConfig {
  return structuredClone(PRESETS[group][kind]);
}

/**
 * A team's config as stored (jsonb), checked and filled in from its preset: unknown session kinds
 * are dropped and anything missing comes from the preset, so a partial config still works.
 */
export function readTeamConfig(raw: unknown, group: TeamGroup, kind: TeamKind): TeamConfig {
  const preset = presetFor(group, kind);
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<TeamConfig>;
  const kinds = Array.isArray(c.sessionKinds) ? c.sessionKinds.filter((k): k is RegularKind => k in SESSION_TYPES) : preset.sessionKinds;
  const f = c.memberFields && typeof c.memberFields === "object" ? c.memberFields : preset.memberFields;
  const roles = Array.isArray(c.roles) ? [...new Set(c.roles.map(String).filter(isRole))] : preset.roles;
  return {
    sessionKinds: kinds,
    roles,
    memberFields: { ministry: Boolean(f.ministry), serves: Boolean(f.serves), rules: f.rules === undefined ? preset.memberFields.rules : Boolean(f.rules) },
    ...(typeof c.sessionsFrom === "string" ? { sessionsFrom: c.sessionsFrom } : preset.sessionsFrom ? { sessionsFrom: preset.sessionsFrom } : {}),
    ...(() => {
      const compositions = readCompositions(c.compositions ?? preset.compositions);
      return Object.keys(compositions).length ? { compositions } : {};
    })(),
  };
}

/** Stored compositions, checked: known kinds and roles, whole numbers 1 to 6. */
function readCompositions(raw: unknown): Partial<Record<RegularKind, Composition>> {
  const out: Partial<Record<RegularKind, Composition>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [kind, parts] of Object.entries(raw as Record<string, unknown>)) {
    if (!(kind in SESSION_TYPES) || !parts || typeof parts !== "object") continue;
    const c: Composition = {};
    for (const [role, n] of Object.entries(parts as Record<string, unknown>)) {
      const k = Number(n);
      if (isRole(role) && Number.isInteger(k) && k > 0 && k <= 6) c[role] = k;
    }
    if (Object.keys(c).length) out[kind as RegularKind] = c;
  }
  return out;
}

/** A regular kind of session as this team plans it: the catalogue's, with the team's own parts if it has them. */
export function sessionTypeFor(config: TeamConfig | undefined, kind: RegularKind): SessionType {
  const t = SESSION_TYPES[kind];
  return { ...t, composition: { ...(config?.compositions?.[kind] ?? t.composition) } };
}

/** The session types this team plans, for "Start from" in the session dialog (all of them when it has none). */
export function presetKinds(config: TeamConfig | undefined): RegularKind[] {
  return config?.sessionKinds.length ? config.sessionKinds : (Object.keys(SESSION_TYPES) as RegularKind[]);
}

/** Whether this team splits sessions and people into EM and CM. */
export const splitsMinistry = (config: TeamConfig | undefined) => config?.memberFields.ministry ?? true;

/** What a new roster starts with, for the New roster dialog. */
export function regularSessionsBlurb(config: TeamConfig | undefined): string {
  const kinds = config?.sessionKinds ?? [];
  if (!kinds.length) return "The roster starts empty: add its sessions yourself.";
  if (kinds.length === 1) return `Every ${SESSION_TYPES[kinds[0]].name} in the quarter is added for you.`;
  const names = kinds.map((k) => `${SESSION_TYPES[k].name} (${scheduleText(SESSION_TYPES[k].schedule, true)})`);
  return `Added for you: ${names.join(", ").replace(/, ([^,]*)$/, " and $1")} in the quarter.`;
}

/** The roles this team's members choose from, with their labels. */
export const teamRoles = (config: TeamConfig | undefined) =>
  (config?.roles ?? WORSHIP_ROLES).map((value) => ({ value, label: ROLE_LABEL[value] ?? value }));

/** What the team calls them: "Instruments" for a band, "Roles" for anything else (media). */
export const rolesNoun = (config: TeamConfig | undefined) =>
  (config?.roles ?? WORSHIP_ROLES).every((r) => WORSHIP_ROLES.includes(r)) ? "Instruments" : "Roles";

/** A person as a team sees them: settings the team doesn't use read as "anyone" / "both". */
export function teamPerson<T extends { emPercent: number | null; serves?: "both" | "sunday" | "pnp" }>(p: T, config: TeamConfig | undefined): T {
  const f = config?.memberFields ?? { ministry: true, serves: true, rules: true };
  return { ...p, ...(f.ministry ? {} : { emPercent: null }), ...(f.serves || p.serves === undefined ? {} : { serves: "both" as const }) };
}

/** "Youth Worship" from its group and kind (the usual name for a new team). */
export const teamTitle = (group: TeamGroup, kind: TeamKind) => `${GROUP_LABEL[group]} ${KIND_LABEL[kind]}`;
