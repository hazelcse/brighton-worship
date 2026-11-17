import { MINISTRY_LABEL, ROLE_GROUP, ROLE_LABEL, formatDate, type People } from "@/lib/roster";
import type { GenerationResult, SessionRow } from "@/lib/roster-data";

/** What the worker saves in rosters.check after a hand edit (see worker roster_service.evaluate). */
export type RosterCheck = {
  checked_at: string;
  edited_cells: string[]; // "sessionId|role"
  hard: {
    kind: "unfilled" | "hard_rule" | "skill" | "ministry" | "serves" | "two_roles" | "double_date" | "attached_singer" | "extra" | "inactive" | "absent" | "absent_rehearsal" | "other_team";
    session?: string;
    member?: string | null;
    role?: string;
    rule?: string;
    count?: number;
    other?: string;
    /** other_team: the team they already serve in that day. */
    team?: string;
  }[];
  soft: {
    kind: "score" | "fairness" | "spacing" | "split" | "variety" | "soft_rule" | "back_to_back";
    pct?: number;
    points?: number;
    rule?: string;
    was?: number;
    now?: number;
  }[];
  score: { generated: number; edited: number; change_pct: number; change_points?: number };
  result: GenerationResult;
};

export type Warning = { id: string; text: string };

const label = (role?: string) => (role ? (ROLE_LABEL[role] ?? role) : "");
const lower = (role?: string) => label(role).toLowerCase();

/** Turn the check into sentences. Hard problems can't be dismissed; soft warnings can. */
export function describeCheck(
  check: RosterCheck,
  sessions: SessionRow[],
  people: People,
  sentence: (ruleId: string) => string,
): { hard: Warning[]; soft: Warning[] } {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const where = (id?: string) => {
    const s = id ? byId.get(id) : undefined;
    return s ? `${formatDate(s.date, { weekday: "short", day: "numeric", month: "short" })} ${s.name}` : "A session";
  };
  const who = (id?: string | null) => people.find((p) => p.id === id)?.name ?? "A removed member";

  const hard = check.hard.map((h, i): Warning => {
    const id = `h:${h.kind}:${h.session ?? ""}:${h.member ?? ""}:${h.role ?? ""}:${h.rule ?? ""}:${i}`;
    switch (h.kind) {
      case "unfilled":
        return { id, text: `${where(h.session)} has no ${h.count === 1 ? lower(h.role) : `${h.count} ${(ROLE_GROUP[h.role ?? ""] ?? lower(h.role)).toLowerCase()}`}.` };
      case "hard_rule":
        return { id, text: `Hard rule broken: “${sentence(h.rule ?? "")}”` };
      case "skill":
        return { id, text: `${who(h.member)} isn't set up to play ${lower(h.role)} (${where(h.session)}).` };
      case "ministry": {
        const s = byId.get(h.session ?? "");
        return { id, text: `${who(h.member)} doesn't serve ${s ? MINISTRY_LABEL[s.ministry] : "this ministry"} (${where(h.session)}).` };
      }
      case "serves":
        return { id, text: `${who(h.member)} isn't set to serve at ${byId.get(h.session ?? "")?.kind.endsWith("_pnp") ? "P&P" : "Sunday services"} (${where(h.session)}).` };
      case "absent":
        return { id, text: `${who(h.member)} is marked absent that day (${where(h.session)}).` };
      case "absent_rehearsal":
        return { id, text: `${who(h.member)} is marked absent on the rehearsal day (${where(h.session)}).` };
      case "other_team":
        return { id, text: `${who(h.member)} already serves with ${h.team ?? "another team"} that day (${where(h.session)}).` };
      case "two_roles":
        return { id, text: `${who(h.member)} has two parts in ${where(h.session)}.` };
      case "double_date":
        return { id, text: `${who(h.member)} is in two sessions on the same day (${where(h.other)} and ${where(h.session)}).` };
      case "attached_singer":
        return { id, text: `${who(h.member)} can't be ${lower(h.role)} while singing (${where(h.session)}).` };
      case "extra":
        return { id, text: `${where(h.session)} has ${h.count} more ${lower(h.role)} than the band needs.` };
      case "inactive":
        return { id, text: `${where(h.session)} still has someone who's no longer on the team.` };
    }
  });

  const soft = check.soft.map((w): Warning => {
    const id = `s:${w.kind}:${w.rule ?? ""}:${w.pct ?? ""}:${w.points ?? ""}:${w.was ?? ""}:${w.now ?? ""}`;
    switch (w.kind) {
      case "score":
        return { id, text: `The roster's score is ${w.points} points lower than generated (1 point = missing a weight-1 soft rule once).` };
      case "fairness":
        return { id, text: `The load is shared less evenly (${w.pct}% worse than generated).` };
      case "spacing":
        return { id, text: `People's services are less spread out (${w.pct}% worse than generated).` };
      case "variety":
        return { id, text: `Teams are less mixed: more of the same people serving together (${w.pct}% worse than generated).` };
      case "split":
        return { id, text: `EM/CM splits are further from people's targets (${w.pct}% worse than generated).` };
      case "soft_rule":
        return { id, text: `“${sentence(w.rule ?? "")}” is now missed ${w.now}× (was ${w.was}×).` };
      case "back_to_back":
        return { id, text: `More people serving back-to-back weeks: ${w.now} times, up from ${w.was}.` };
    }
  });
  return { hard, soft };
}

/** Hard problems for a roster: from the hand-edit check, or (unedited) from the generated result. */
export function rosterProblems(
  check: RosterCheck | null,
  result: GenerationResult | null,
  sessions: SessionRow[],
  people: People,
  sentence: (ruleId: string) => string,
): Warning[] {
  if (check) return describeCheck(check, sessions, people, sentence).hard;
  if (!result) return [];
  const asCheck: RosterCheck = {
    checked_at: "",
    edited_cells: [],
    hard: [
      ...result.unfilled.map((u) => ({ kind: "unfilled" as const, session: u.session, role: u.role, count: u.missing })),
      ...result.hard_broken.map((h) => ({ kind: "hard_rule" as const, rule: h.rule })),
    ],
    soft: [],
    score: { generated: 0, edited: 0, change_pct: 0 },
    result,
  };
  return describeCheck(asCheck, sessions, people, sentence).hard;
}

/**
 * The cells a hard problem is in ("sessionId|role" -> what's wrong), so the roster table can mark
 * them red. Problems not tied to one cell (a broken hard rule) are only in the list.
 */
export function problemCells(
  check: RosterCheck | null,
  result: GenerationResult | null,
  sessions: SessionRow[],
  people: People,
  sentence: (ruleId: string) => string,
): Record<string, string> {
  const entries: RosterCheck["hard"] = check
    ? check.hard
    : (result?.unfilled ?? []).map((u) => ({ kind: "unfilled" as const, session: u.session, role: u.role, count: u.missing }));
  const texts = describeCheck(
    { checked_at: "", edited_cells: [], hard: entries, soft: [], score: { generated: 0, edited: 0, change_pct: 0 }, result: result as GenerationResult },
    sessions,
    people,
    sentence,
  ).hard;
  const out: Record<string, string> = {};
  entries.forEach((h, i) => {
    if (!h.session || !h.role) return;
    const k = `${h.session}|${h.role}`;
    out[k] = out[k] ? `${out[k]}\n${texts[i].text}` : texts[i].text;
  });
  return out;
}
