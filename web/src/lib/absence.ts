/** Checking what someone typed for an absence. Shared by the absence actions. */

export type AbsenceInput = { id?: string; startsOn: string; endsOn: string; reason: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_ABSENCE_REASON = 80;

/** The absence tidied up, or the message to show if it can't be saved. */
export function cleanAbsence(input: AbsenceInput): { startsOn: string; endsOn: string; reason: string } | { error: string } {
  const startsOn = String(input.startsOn ?? "");
  const endsOn = String(input.endsOn || startsOn);
  const reason = String(input.reason ?? "").trim().replace(/\s+/g, " ") || "Absence";
  if (!DATE.test(startsOn) || !DATE.test(endsOn)) return { error: "Choose a date." };
  if (endsOn < startsOn) return { error: "The end date can't be before the start date." };
  if (reason.length > MAX_ABSENCE_REASON) return { error: `Keep the reason under ${MAX_ABSENCE_REASON} characters.` };
  return { startsOn, endsOn, reason };
}

/** Longest range someone can mark themselves away for when turning down a request. */
export const MAX_DECLINE_DAYS = 92;

const dayNumber = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000;
/** A YYYY-MM-DD that is a real calendar day (not 2026-02-31). */
const realDay = (ymd: string) => DATE.test(ymd) && new Date(dayNumber(ymd) * 86_400_000).toISOString().slice(0, 10) === ymd;

/**
 * The days to mark someone away when they turn down a serve request: one of the request's own days
 * (its service day or rehearsal day), or a range that takes in at least one of them. Nothing chosen
 * means the service day, as before.
 */
export function declineAbsence(
  choice: { startsOn?: string | null; endsOn?: string | null } | null | undefined,
  days: { service: string; rehearsal?: string | null },
): { startsOn: string; endsOn: string } | { error: string } {
  const own = [days.service, ...(days.rehearsal ? [days.rehearsal] : [])];
  const startsOn = String(choice?.startsOn ?? "") || days.service;
  const endsOn = String(choice?.endsOn ?? "") || startsOn;
  if (!realDay(startsOn) || !realDay(endsOn)) {
    return { error: "Choose the day you're away." };
  }
  if (startsOn === endsOn && own.includes(startsOn)) return { startsOn, endsOn };
  if (endsOn < startsOn) return { error: "The end date can't be before the start date." };
  if (dayNumber(endsOn) - dayNumber(startsOn) + 1 > MAX_DECLINE_DAYS) {
    return { error: `Keep the dates within ${MAX_DECLINE_DAYS} days. Add a longer absence on your schedule.` };
  }
  if (!own.some((d) => startsOn <= d && d <= endsOn)) {
    return { error: "The dates must include the service day or its rehearsal." };
  }
  return { startsOn, endsOn };
}
