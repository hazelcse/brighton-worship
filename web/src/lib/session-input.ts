import "server-only";
import { ROLES, addDays, type Composition, type Ministry } from "@/lib/roster";

/** Checking a session's details as sent from the browser (roster planning and ad-hoc sessions). */

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function cleanComposition(raw: unknown): Composition {
  const out: Composition = {};
  if (raw && typeof raw === "object") {
    for (const r of ROLES) {
      const n = Number((raw as Record<string, unknown>)[r.value] ?? 0);
      if (Number.isInteger(n) && n > 0 && n <= 6) out[r.value] = n;
    }
  }
  return out;
}

export function compositionProblem(c: Composition): string | null {
  const players = Object.entries(c)
    .filter(([role]) => role !== "band leader")
    .reduce((n, [, k]) => n + (k ?? 0), 0);
  if (players === 0) return "Add at least one person to the band.";
  const instrumentalists = Object.entries(c)
    .filter(([role]) => !["band leader", "worship leader", "vocalist"].includes(role))
    .reduce((n, [, k]) => n + (k ?? 0), 0);
  const attached = c["band leader"] ?? 0;
  if (attached > 0 && instrumentalists === 0) {
    return "Band leader / talkback is done by someone who's also playing an instrument, so the band needs at least one instrument.";
  }
  if (attached > instrumentalists) {
    return "There can't be more band leaders / talkback than instrument players.";
  }
  return null;
}


export type SessionInput = {
  date: string;
  name: string;
  ministry: Ministry;
  weight: number;
  composition: Composition;
  note?: string;
  /** null = no rehearsal. */
  rehearsal_date?: string | null;
  /** "HH:MM"; null = the default for its kind. */
  start_time?: string | null;
  rehearsal_time?: string | null;
};

export const isTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** How far before a session its rehearsal can be. */
export const REHEARSAL_MAX_DAYS = 14;

export function validateSession(s: SessionInput, quarter: { starts_on: string; ends_on: string }): string | null {
  if (!isDate(s.date)) return "Choose a date.";
  if (s.date < quarter.starts_on || s.date > quarter.ends_on) return "The date has to be inside this roster's quarter.";
  if (!s.name.trim()) return "Give the session a name.";
  if (!["em", "cm", "any"].includes(s.ministry)) return "Choose who can serve (EM, CM or both).";
  if (!(s.weight >= 0 && s.weight <= 1)) return "The weight must be between 0 and 1.";
  if (s.rehearsal_date) {
    if (!isDate(s.rehearsal_date)) return "Choose a rehearsal date, or tick no rehearsal.";
    if (s.rehearsal_date > s.date) return "The rehearsal has to be on or before the session's date.";
    if (s.rehearsal_date < addDays(s.date, -REHEARSAL_MAX_DAYS)) return `The rehearsal has to be within ${REHEARSAL_MAX_DAYS} days before the session.`;
  }
  if (s.start_time && !isTime(s.start_time)) return "Choose a start time, or leave it empty.";
  if (s.rehearsal_time && !isTime(s.rehearsal_time)) return "Choose a rehearsal time, or leave it empty.";
  return compositionProblem(s.composition);
}

