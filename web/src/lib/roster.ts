/**
 * Roster logic shared by the server and the browser: quarters, session types, band
 * compositions, and the rule templates (with plain-English wording and sense checks).
 * Dates are plain "YYYY-MM-DD" strings (no time zones).
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = [
  { value: "worship leader", label: "Worship Leader", short: "WL" },
  { value: "vocalist", label: "Vocalist", short: "V" },
  { value: "keys", label: "Keys", short: "Keys" },
  { value: "synth/pads", label: "Synth/Pads", short: "Synth" },
  { value: "electric guitar", label: "Electric Guitar", short: "EG" },
  { value: "acoustic guitar", label: "Acoustic Guitar", short: "AG" },
  { value: "bass", label: "Bass", short: "Bass" },
  { value: "drums", label: "Drums", short: "Drums" },
  // Band leader and talkback are one job, done by the same person (stored as "band leader").
  { value: "band leader", label: "Band Leader / Talkback", short: "BL/TB" },
] as const;
export type Role = (typeof ROLES)[number]["value"];
/** "talkback" was its own role once: old rosters and updates may still name it. */
const LEGACY_ROLES = [{ value: "talkback", label: "Band Leader / Talkback", short: "BL/TB" }];
export const ROLE_LABEL = Object.fromEntries([...ROLES, ...LEGACY_ROLES].map((r) => [r.value, r.label])) as Record<string, string>;
export const ROLE_SHORT = Object.fromEntries([...ROLES, ...LEGACY_ROLES].map((r) => [r.value, r.short])) as Record<string, string>;
/** How a group of people with a role is named in rules, e.g. "Drummers should…". */
export const ROLE_GROUP: Record<string, string> = {
  "worship leader": "Worship Leaders",
  vocalist: "Vocalists",
  keys: "Keys players",
  "synth/pads": "Synth/Pads players",
  "electric guitar": "Electric Guitarists",
  "acoustic guitar": "Acoustic Guitarists",
  bass: "Bassists",
  drums: "Drummers",
  "band leader": "Band Leaders / Talkback",
};

/**
 * Band leader / talkback (one job, one person) is never a person's only job: it goes to someone
 * who is already playing an instrument in that session (and has that skill).
 */
export const ATTACHED_ROLES: readonly string[] = ["band leader"];
/** Singing roles. A session needing both WLs and vocalists needs separate people for each. */
export const SINGING_ROLES: readonly string[] = ["worship leader", "vocalist"];

export type Composition = Partial<Record<Role, number>>;
export type Ministry = "em" | "cm" | "any";
export const MINISTRY_LABEL: Record<Ministry, string> = { em: "EM", cm: "CM", any: "EM/CM" };

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export type SessionKind = "em_sunday" | "cm_sunday" | "em_pnp" | "cm_pnp" | "custom";

const FULL_BAND = (wl: number): Composition => ({
  "worship leader": wl,
  vocalist: 2,
  keys: 1,
  "band leader": 1,
  "electric guitar": 1,
  "acoustic guitar": 1,
  bass: 1,
  drums: 1,
});

export const SESSION_TYPES: Record<Exclude<SessionKind, "custom">, {
  name: string;
  ministry: Ministry;
  weight: number;
  composition: Composition;
  when: string;
}> = {
  em_sunday: { name: "EM Sunday Service", ministry: "em", weight: 1, composition: FULL_BAND(2), when: "Every Sunday" },
  // CM Sundays: 2 worship leaders and 1 vocalist; the rest of the band is the same as EM.
  cm_sunday: { name: "CM Sunday Service", ministry: "cm", weight: 1, composition: { ...FULL_BAND(2), vocalist: 1 }, when: "Every Sunday" },
  em_pnp: { name: "EM Prayer & Praise", ministry: "em", weight: 0.6, composition: FULL_BAND(2), when: "4th Thursday of the month" },
  cm_pnp: {
    name: "CM Prayer & Praise",
    ministry: "cm",
    weight: 0.6,
    composition: { "worship leader": 1, vocalist: 1, keys: 1, "acoustic guitar": 1 },
    when: "4th Wednesday of the month",
  },
};

export function compositionSummary(c: Composition): string {
  return ROLES.filter((r) => (c[r.value] ?? 0) > 0)
    .map((r) => `${c[r.value]} ${r.short}`)
    .join(" · ");
}

/** People needed for a session: band leader / talkback doesn't add people. */
export function headcount(c: Composition): number {
  return Object.entries(c).reduce((n, [role, k]) => (ATTACHED_ROLES.includes(role) ? n : n + (k ?? 0)), 0);
}

// ---------------------------------------------------------------------------
// Dates and quarters
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
function toDate(s: string): Date {
  const { y, m, d } = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d));
}
function fromDate(dt: Date): string {
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
/** Whole days from a to b ("YYYY-MM-DD"); negative if b is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

export function addDays(s: string, n: number): string {
  const dt = toDate(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromDate(dt);
}
export function weekday(s: string): number {
  return toDate(s).getUTCDay(); // 0 = Sunday
}
/** The team's clock: Singapore time, whatever time zone the server (or browser) is in. */
export const TEAM_TIME_ZONE = "Asia/Singapore";

/** The date ("YYYY-MM-DD") and hour (0-23) at this moment in the team's time zone. */
export function teamNow(now: Date = new Date()): { ymd: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TEAM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Today's date in Singapore. */
export function todayYmd(): string {
  return teamNow().ymd;
}

export type Quarter = { start: string; end: string; label: string };

export function quarterOf(date: string): Quarter {
  const { y, m } = parseYmd(date);
  const q = Math.floor((m - 1) / 3);
  const startM = q * 3 + 1;
  const endM = startM + 2;
  const lastDay = new Date(Date.UTC(y, endM, 0)).getUTCDate();
  return { start: ymd(y, startM, 1), end: ymd(y, endM, lastDay), label: `Q${q + 1} ${y}` };
}
export function nextQuarter(q: Quarter): Quarter {
  return quarterOf(addDays(q.end, 1));
}

export function formatDate(s: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  return toDate(s).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}
export function formatRange(start: string, end: string): string {
  return `${formatDate(start)} → ${formatDate(end)}`;
}

/** The nth given weekday of a month, e.g. the 4th Thursday. */
function nthWeekday(y: number, m: number, dow: number, n: number): string {
  const first = toDate(ymd(y, m, 1)).getUTCDay();
  const day = 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
  return ymd(y, m, day);
}

export type PlannedSession = {
  date: string;
  kind: SessionKind;
  name: string;
  ministry: Ministry;
  weight: number;
  composition: Composition;
  /** The band's rehearsal for this session (Sunday services only). */
  rehearsal_date: string | null;
};

/**
 * When a Sunday service rehearses: EM the Tuesday before, CM the Wednesday before, or the Sunday
 * before if that Wednesday is a CM Prayer & Praise (cmPnpDates). Other sessions: none.
 */
export function defaultRehearsal(date: string, kind: SessionKind, cmPnpDates: Set<string>): string | null {
  if (kind === "em_sunday") return addDays(date, -5);
  if (kind === "cm_sunday") {
    const wed = addDays(date, -4);
    return cmPnpDates.has(wed) ? addDays(date, -7) : wed;
  }
  return null;
}

/** Default start time ("HH:MM") of a session kind: the Sunday services; null for the rest. */
export function defaultStartTime(kind: string): string | null {
  return kind === "em_sunday" ? "08:30" : kind === "cm_sunday" ? "07:45" : null;
}

/** Default rehearsal time: 8pm for the usual EM Tuesday and CM Wednesday rehearsals; null otherwise. */
export function defaultRehearsalTime(kind: string, rehearsalDate: string | null): string | null {
  if (!rehearsalDate) return null;
  const dow = weekday(rehearsalDate);
  return (kind === "em_sunday" && dow === 2) || (kind === "cm_sunday" && dow === 3) ? "20:00" : null;
}

/** "HH:MM" from a Postgres time ("20:00:00"), or null. */
export function hhmm(t: string | null | undefined): string | null {
  return t && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null;
}

/** "20:00" -> "8:00pm", "08:30" -> "8:30am". */
export function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** All the regular sessions in a quarter. */
export function defaultSessions(q: Quarter): PlannedSession[] {
  const out: PlannedSession[] = [];
  const add = (date: string, kind: Exclude<SessionKind, "custom">) => {
    const t = SESSION_TYPES[kind];
    out.push({ date, kind, name: t.name, ministry: t.ministry, weight: t.weight, composition: t.composition, rehearsal_date: null });
  };
  // Sundays
  let d = q.start;
  while (weekday(d) !== 0) d = addDays(d, 1);
  for (; d <= q.end; d = addDays(d, 7)) {
    add(d, "em_sunday");
    add(d, "cm_sunday");
  }
  // Prayer & praise: 4th Wednesday (CM) and 4th Thursday (EM) of each month
  const { y, m } = parseYmd(q.start);
  for (let i = 0; i < 3; i++) {
    const mm = ((m - 1 + i) % 12) + 1;
    const yy = y + Math.floor((m - 1 + i) / 12);
    add(nthWeekday(yy, mm, 3, 4), "cm_pnp");
    add(nthWeekday(yy, mm, 4, 4), "em_pnp");
  }
  const cmPnp = new Set(out.filter((s) => s.kind === "cm_pnp").map((s) => s.date));
  for (const s of out) s.rehearsal_date = defaultRehearsal(s.date, s.kind, cmPnp);
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type Subject =
  | { kind: "everyone" }
  | { kind: "ministry"; value: "em" | "cm" }
  | { kind: "role"; value: Role }
  | { kind: "member"; value: string };

export type Op = ">" | ">=" | "=" | "<=" | "<";
export const OPS: Op[] = [">", ">=", "=", "<=", "<"];
export const OP_WORDS: Record<Op, string> = {
  ">": "more than",
  ">=": "at least",
  "=": "exactly",
  "<=": "at most",
  "<": "fewer than",
};

export type RuleParams =
  | { template: "frequency"; subject: Subject; polarity: "should" | "should_not"; op: Op; count: number; period: "month" | "quarter" }
  | { template: "pair"; a: string; b: string; polarity: "should" | "should_not" }
  | { template: "break"; subject: Subject; except: string[]; op: Op; weeks: number }
  | {
      template: "date";
      member: string;
      polarity: "must" | "must_not";
      date: string;
      /** The session that day, by kind (and name for a custom event), so a default rule finds it in any roster. Older rules leave it out: any session that day. */
      sessionKind?: SessionKind;
      sessionName?: string;
      /** For a band picked by hand (an ad-hoc session's roster-only rules): the part they play there… */
      role?: string;
      /** …and that they're also the BL/TB. */
      bandLeader?: boolean;
    }
  | { template: "fairness"; reduced?: Record<string, number> }
  | { template: "spacing" }
  | { template: "variety" }
  | { template: "singer_balance" }
  | { template: "bl_backup" };

export type Rule = {
  id: string;
  hard: boolean;
  weight: number;
  enabled: boolean;
  /** Ships with the app: can't be edited, switched off or deleted; root can change the weight. */
  permanent?: boolean;
  /** null = default rule, used by every roster; otherwise the one roster it belongs to. */
  rosterId: string | null;
  params: RuleParams;
};

export type People = { id: string; name: string; instruments: string[]; emPercent: number | null; serves?: "both" | "sunday" | "pnp" }[];

export function subjectText(s: Subject, people: People): string {
  switch (s.kind) {
    case "everyone":
      return "Everyone";
    case "ministry":
      return s.value === "em" ? "The EM team" : "The CM team";
    case "role":
      return ROLE_GROUP[s.value] ?? ROLE_LABEL[s.value];
    case "member":
      return people.find((p) => p.id === s.value)?.name ?? "(removed member)";
  }
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const weeksText = (n: number) => `${n} week${n === 1 ? "" : "s"}`;
const nameOf = (id: string, people: People) => people.find((p) => p.id === id)?.name ?? "(removed member)";

/**
 * The rule as a sentence, e.g. "Worship Leaders should serve at most twice a month."
 * `exempt`: people a group "how often" rule doesn't apply to, because they have their own
 * rule (see frequencyExemptions); shown as "(except …)".
 */
export function ruleSentence(p: RuleParams, people: People, exempt: string[] = []): string {
  switch (p.template) {
    case "frequency": {
      const except = exempt.length ? ` (except ${exempt.map((id) => nameOf(id, people)).join(", ")})` : "";
      return `${subjectText(p.subject, people)}${except} ${p.polarity === "should" ? "should" : "should not"} serve ${OP_WORDS[p.op]} ${times(p.count)} a ${p.period}.`;
    }
    case "pair":
      return `${nameOf(p.a, people)} and ${nameOf(p.b, people)} ${p.polarity === "should" ? "should" : "should not"} serve on the same date.`;
    case "break": {
      const except = p.except.length ? ` (except ${p.except.map((id) => nameOf(id, people)).join(", ")})` : "";
      return `${subjectText(p.subject, people)}${except} should have ${OP_WORDS[p.op]} ${weeksText(p.weeks)} between services.`;
    }
    case "date": {
      const day = formatDate(p.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      const at = p.sessionKind ? `at ${dateRuleSessionName(p)} on ${day}` : `on ${day}`;
      const as = p.polarity === "must" && p.role ? ` on ${(ROLE_LABEL[p.role] ?? p.role).toLowerCase()}${p.bandLeader ? " and BL/TB" : ""}` : "";
      return `${nameOf(p.member, people)} ${p.polarity === "must" ? "must" : "must not"} serve ${at}${as}.`;
    }
    case "bl_backup":
      return "Back up the BL/TB: in each band, if the BL/TB can't make it, someone free that day can take over their instrument and BL/TB, or someone free can take the instrument and a bandmate can take BL/TB.";
    case "singer_balance":
      return "Balance the singers: in each band, about as many male as female worship leaders and vocalists.";
    case "variety":
      return "Mix up the teams: everyone should serve with as many different people as possible.";
    case "spacing":
      return "Space out services: each person's service dates should be as far apart as possible.";
    case "fairness":
      return "Share the load fairly: spread services evenly, and P&Ps evenly, counted separately so no one only does P&Ps.";
  }
}

/**
 * Specific beats general for "how often someone serves": if a person has their own (enabled)
 * frequency rule for a period, group frequency rules for the same period (everyone, EM/CM team,
 * a role) don't apply to them. Returns the people a group rule skips, in name order.
 * The roster generator must use this too.
 */
export function frequencyExemptions(rule: { id: string | null; params: RuleParams }, rules: Rule[], people: People): string[] {
  const p = rule.params;
  if (p.template !== "frequency" || p.subject.kind === "member") return [];
  const covered = new Set(subjectMembers(p.subject, people).map((x) => x.id));
  const own = new Set(
    rules
      .filter((r) => r.enabled && r.id !== rule.id && r.params.template === "frequency" && r.params.subject.kind === "member" && r.params.period === p.period)
      .map((r) => (r.params as Extract<RuleParams, { template: "frequency" }>).subject as { kind: "member"; value: string })
      .map((s) => s.value)
      .filter((id) => covered.has(id)),
  );
  return people.filter((x) => own.has(x.id)).map((x) => x.id);
}

/** Group "how often" rules a person's own rule takes precedence over. */
export function overriddenGroupRules(rule: { id: string | null; params: RuleParams }, rules: Rule[], people: People): Rule[] {
  const p = rule.params;
  if (p.template !== "frequency" || p.subject.kind !== "member") return [];
  const person = p.subject.value;
  return rules.filter(
    (r) =>
      r.enabled &&
      r.id !== rule.id &&
      r.params.template === "frequency" &&
      r.params.subject.kind !== "member" &&
      r.params.period === p.period &&
      subjectMembers(r.params.subject, people).some((x) => x.id === person),
  );
}

/** Who a subject covers. */
export function subjectMembers(s: Subject, people: People): People {
  switch (s.kind) {
    case "everyone":
      return people;
    case "ministry":
      return people.filter((p) => (s.value === "em" ? (p.emPercent ?? 0) > 0 : (p.emPercent ?? 100) < 100));
    case "role":
      return people.filter((p) => p.instruments.includes(s.value));
    case "member":
      return people.filter((p) => p.id === s.value);
  }
}

export type Advice = { level: "error" | "warning"; message: string };

/**
 * Sense checks for a rule. "error" means it can never be satisfied (or is meaningless) and
 * can't be saved as written; "warning" means it's probably not what was meant.
 */
export function checkRule(p: RuleParams, people: People, hard: boolean): Advice[] {
  const out: Advice[] = [];
  const err = (message: string) => out.push({ level: "error", message });
  const warn = (message: string) => out.push({ level: "warning", message });

  const maxPer = (period: "month" | "quarter") => (period === "month" ? 6 : 16); // Sundays + P&P a person could do

  if (p.template === "frequency") {
    const { op, count, polarity, period } = p;
    if (!Number.isInteger(count) || count < 0) err("The number of times must be 0 or more.");
    if (subjectMembers(p.subject, people).length === 0) err("No one in the team matches who this rule is about.");
    // Rules that are always or never true
    const alwaysFalse =
      (polarity === "should" && ((op === "<" && count === 0) || ((op === ">" || op === ">=" || op === "=") && count > maxPer(period)))) ||
      (polarity === "should_not" && op === ">=" && count === 0);
    const alwaysTrue =
      (polarity === "should" && op === ">=" && count === 0) || (polarity === "should_not" && op === "<" && count === 0);
    if (alwaysFalse) {
      err(
        polarity === "should_not"
          ? `Everyone always serves at least 0 times, so "should not serve at least 0 times" can never be met.`
          : `No roster can satisfy this: no one can serve ${OP_WORDS[op]} ${times(count)} a ${period}.`,
      );
    }
    if (alwaysTrue) warn("This is always true, so it won't change anything.");
    if (polarity === "should_not" && !alwaysFalse && !alwaysTrue) {
      const flip: Record<Op, Op> = { ">": "<=", ">=": "<", "=": "=", "<=": ">", "<": ">=" };
      if (op !== "=") warn(`Double negatives are easy to misread. This means the same as "should serve ${OP_WORDS[flip[op]]} ${times(count)} a ${period}".`);
    }
    if (polarity === "should" && (op === ">=" || op === ">" || op === "=") && count >= 4 && period === "month") {
      warn(`${times(count)} a month is a lot: most months have 4 Sundays and one prayer & praise.`);
    }
    if (hard && p.subject.kind !== "member" && polarity === "should" && (op === ">=" || op === ">" || op === "=") && count > 0) {
      warn("As a hard rule this forces every person it covers to be rostered that often. If there aren't enough slots, no roster will be possible.");
    }
  }

  if (p.template === "pair") {
    if (!p.a || !p.b) err("Choose two people.");
    else if (p.a === p.b) err("Choose two different people.");
    // Same date (any session that day), so EM and CM people can still share a date.
  }

  if (p.template === "break") {
    const { op, weeks } = p;
    if (!Number.isInteger(weeks) || weeks < 0) err("The number of weeks must be 0 or more.");
    if (op === "<" && weeks === 0) err("A break can't be shorter than 0 weeks.");
    if (op === ">=" && weeks === 0) warn("At least 0 weeks is always true, so this won't change anything.");
    if (op === "=") warn(`Exactly ${weeksText(weeks)} between every service is very strict: did you mean "at least" or "at most"?`);
    if ((op === "<=" && weeks === 0) || (op === "<" && weeks === 1)) warn("No weeks off in between means serving every week.");
    if (subjectMembers(p.subject, people).filter((x) => !p.except.includes(x.id)).length === 0) err("No one is left once the exceptions are removed.");
    if (p.subject.kind === "member" && p.except.length) warn("Exceptions only matter when the rule is about a group.");
  }

  if (p.template === "date") {
    if (!p.member) err("Choose a person.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) err("Choose a session.");
    else if (p.date < todayYmd()) warn("That session has already passed.");
  }

  return out;
}

/** The session a date rule is about, e.g. "CM Sunday Service" (a custom event by its own name). */
export function dateRuleSessionName(p: { sessionKind?: SessionKind; sessionName?: string }): string {
  if (!p.sessionKind) return "";
  return p.sessionKind === "custom" ? (p.sessionName ?? "the event") : SESSION_TYPES[p.sessionKind].name;
}

/** Does this session match the rule: the same day, and the same session if the rule names one. */
export function dateRuleMatches(p: { date: string; sessionKind?: SessionKind; sessionName?: string }, s: { date: string; kind: SessionKind; name: string }) {
  if (s.date !== p.date) return false;
  if (!p.sessionKind) return true; // older rules: any session that day
  return s.kind === p.sessionKind && (s.kind !== "custom" || s.name === p.sessionName);
}

/** Extra check against a specific roster: is the session there, and could the person serve at it? */
export function checkDateRuleAgainst(
  p: Extract<RuleParams, { template: "date" }>,
  sessions: { date: string; kind: SessionKind; name: string; ministry: Ministry; cancelled: boolean; composition: Composition }[],
  people: People,
): Advice[] {
  const person = people.find((x) => x.id === p.member);
  const at = sessions.filter((s) => dateRuleMatches(p, s) && !s.cancelled);
  if (!at.length) return [{ level: "warning", message: p.sessionKind ? "That session isn't in this roster." : "There's no session on that date in this roster." }];
  if (person && p.polarity === "must") {
    const fits = at.some(
      (s) =>
        (s.ministry === "any" ||
          (s.ministry === "em" ? (person.emPercent ?? 0) > 0 : (person.emPercent ?? 100) < 100)) &&
        person.instruments.some((i) => (s.composition[i as Role] ?? 0) > 0 && !ATTACHED_ROLES.includes(i)),
    );
    if (!fits) {
      const where = p.sessionKind ? "that session" : "the sessions on that date";
      return [{ level: "error", message: `${person.name} can't fill any role at ${where} (ministry or instruments don't match).` }];
    }
  }
  return [];
}

/** Look up a rule's sentence by id (for results that refer to rules by id). */
export function makeSentence(rules: Rule[], people: People) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  return (id: string) => {
    const r = byId.get(id);
    return r ? ruleSentence(r.params, people) : "(a rule that has since been changed or deleted)";
  };
}

export type MemberRuleReason = "personal" | "group" | "instrument" | "exception" | "serve-less";

/**
 * The rules that single out one member (not "everyone" rules): about them by name, about a
 * ministry or instrument group they're in, or naming them as an exception or as serving less.
 */
export function rulesAbout(
  person: { id: string; instruments: string[]; emPercent: number | null },
  rules: Rule[],
): { rule: Rule; reason: MemberRuleReason }[] {
  const inMinistry = (m: "em" | "cm") =>
    person.emPercent === null || (m === "em" ? person.emPercent > 0 : person.emPercent < 100);
  const out: { rule: Rule; reason: MemberRuleReason }[] = [];
  for (const rule of rules) {
    const p = rule.params;
    let reason: MemberRuleReason | null = null;
    if (p.template === "fairness") reason = p.reduced && person.id in p.reduced ? "serve-less" : null;
    else if (p.template === "pair") reason = p.a === person.id || p.b === person.id ? "personal" : null;
    else if (p.template === "date") reason = p.member === person.id ? "personal" : null;
    else if (p.template === "frequency" || p.template === "break") {
      const s = p.subject;
      if (s.kind === "member") reason = s.value === person.id ? "personal" : null;
      else if (p.template === "break" && p.except.includes(person.id)) reason = "exception";
      else if (s.kind === "ministry") reason = inMinistry(s.value) ? "group" : null;
      else if (s.kind === "role") reason = person.instruments.includes(s.value) ? "instrument" : null;
    }
    if (reason) out.push({ rule, reason });
  }
  return out;
}
