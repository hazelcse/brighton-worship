import { addDays, daysBetween, defaultRehearsalTime, defaultStartTime, formatTime, hhmm } from "@/lib/roster";

/** What the home page needs to say when you're next serving. */
export type ReminderSession = {
  date: string;
  name: string;
  kind: string;
  rehearsal: string | null;
  /** As stored ("HH:MM[:SS]"); null = the default for its kind. */
  startTime: string | null;
  rehearsalTime: string | null;
};

/** The time to give for a session or its rehearsal: the one set, else the default, else none. */
export function sessionTime(s: ReminderSession): string | null {
  return hhmm(s.startTime) ?? defaultStartTime(s.kind);
}
export function rehearsalTime(s: ReminderSession): string | null {
  return s.rehearsal ? (hhmm(s.rehearsalTime) ?? defaultRehearsalTime(s.kind, s.rehearsal)) : null;
}

const at = (t: string | null) => (t ? ` at ${formatTime(t)}` : "");

/**
 * The countdown line. The day before the next session: "See you at EM Sunday Service tomorrow at
 * 8:30am" (no time if it has none). Otherwise the day before one of your rehearsals: "See you at
 * rehearsal for … tomorrow at 8:00pm". Otherwise how many days to go.
 * `big` is the large headline; `small` the line under it (empty when the headline says it all).
 */
export function countdown(today: string, next: ReminderSession, rehearsalTomorrow: ReminderSession | null): { big: string; small: string } {
  const tomorrow = addDays(today, 1);
  if (next.date <= today) return { big: "Today", small: `You're serving at ${next.name}${at(sessionTime(next))}` };
  if (next.date === tomorrow) return { big: `See you at ${next.name} tomorrow${at(sessionTime(next))}`, small: "" };
  if (rehearsalTomorrow) {
    return { big: `See you at rehearsal for ${rehearsalTomorrow.name} tomorrow${at(rehearsalTime(rehearsalTomorrow))}`, small: "" };
  }
  const days = daysBetween(today, next.date);
  return { big: String(days), small: "days until you serve" };
}
