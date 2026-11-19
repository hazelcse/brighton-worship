import { PART_ROLES, keyLabel, type PlanItem, type PlanLink, type PlanSection, type SeqStep } from "@/lib/session-plan";

/** The whole session's links added, removed or renamed, as sentences for the band (matched by address). */
export function describeLinkChanges(before: PlanLink[], after: PlanLink[]): string[] {
  const name = (l: PlanLink) => l.label || l.url;
  const was = new Map(before.map((l) => [l.url, l]));
  const now = new Map(after.map((l) => [l.url, l]));
  const out: string[] = [];
  for (const l of after) {
    const old = was.get(l.url);
    if (!old) out.push(`A session link has been added: ${name(l)}`);
    else if (old.label !== l.label) out.push(`The session link ${name(old)} has been renamed to ${name(l)}`);
  }
  for (const l of before) if (!now.has(l.url)) out.push(`The session link ${name(l)} has been removed`);
  return out;
}

/**
 * What changed between the published plan and the revision about to replace it, as sentences for
 * the band, e.g. "All Glory's key has been changed from E to G" or "Worthy Is The Lamb (A) has been
 * removed". Items and sequence steps keep their ids from one version to the next (the revision
 * starts as a copy of the published plan), which is how a song is followed when it moves.
 */
export function describePlanChanges(before: PlanSection[], after: PlanSection[], names: (id: string) => string | null): string[] {
  const out: string[] = [];
  const songsBefore = songs(before);
  const songsAfter = songs(after);
  const oldById = new Map(songsBefore.map((s) => [s.item.id, s]));
  const newById = new Map(songsAfter.map((s) => [s.item.id, s]));

  // Songs taken out and put in. One put in where one was taken out is a switch.
  let removed = songsBefore.filter((s) => !newById.has(s.item.id));
  const added = songsAfter.filter((s) => !oldById.has(s.item.id));
  for (const a of added) {
    const swapped = removed.find((r) => r.n === a.n);
    if (swapped) {
      removed = removed.filter((r) => r !== swapped);
      out.push(`${ordinal(a.n)} song has been switched to ${label(a.item, a.n)}`);
    } else {
      out.push(`${cap(label(a.item, a.n))} has been added as the ${ordinal(a.n)} song`);
    }
  }
  for (const r of removed) out.push(`${cap(label(r.item, r.n))} has been removed`);

  // Songs kept: moved, changed to another song, or changed in themselves.
  const kept = songsAfter.filter((s) => oldById.has(s.item.id));
  const moved = outOfOrder(kept.map((s) => s.item.id), (id) => oldById.get(id)!.n);
  for (const now of kept) {
    const was = oldById.get(now.item.id)!;
    const a = was.item;
    const b = now.item;
    if (a.song_id !== b.song_id || a.title.trim() !== b.title.trim()) {
      out.push(`${ordinal(now.n)} song has been switched to ${label(b, now.n)}`);
      continue;
    }
    if (moved.has(b.id)) out.push(`${cap(label(b, now.n))} has been switched to the ${ordinal(now.n)} song`);
    out.push(...songChanges(a, b, label(b, now.n), names));
  }

  // Sections and transitions, briefly.
  const oldSections = new Map(before.map((s) => [s.id, s]));
  const newSections = new Map(after.map((s) => [s.id, s]));
  for (const s of after) {
    const was = oldSections.get(s.id);
    if (!was) out.push(`There is a new section: ${s.name}`);
    else if (was.name.trim() !== s.name.trim()) out.push(`The ${was.name} section is now called ${s.name}`);
  }
  for (const s of before) if (!newSections.has(s.id)) out.push(`The ${s.name} section has been removed`);
  if (transitionsKey(before) !== transitionsKey(after)) out.push("The transitions between songs have changed");

  return out;
}

type Numbered = { item: PlanItem; n: number };

/** Songs in order, numbered through the whole plan as the session page numbers them. */
function songs(plan: PlanSection[]): Numbered[] {
  let n = 0;
  return plan.flatMap((s) => s.items).flatMap((item) => (item.kind === "song" ? [{ item, n: ++n }] : []));
}

/** "Holy Forever (G)"; a song not picked yet is "the 3rd song". */
function label(i: PlanItem, n: number): string {
  const title = i.title.trim();
  if (!title) return `the ${ordinal(n)} song`;
  return i.key ? `${title} (${keyLabel(i.key, i.transpose_to)})` : title;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/**
 * Ids (in their new order) that have moved: everything outside the longest run that's still in the
 * old order. Things that only shifted because others came or went before them don't count.
 */
function outOfOrder(ids: string[], oldPos: (id: string) => number): Set<string> {
  const pos = ids.map(oldPos);
  // Longest increasing subsequence, O(n²): plans are short. On a tie the later one is kept, so when
  // two swap places it's the one brought forward that counts as moved ("Praise has been switched
  // to the 2nd song").
  const len = pos.map(() => 1);
  const prev = pos.map(() => -1);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pos[j]! < pos[i]! && len[j]! + 1 >= len[i]!) {
        len[i] = len[j]! + 1;
        prev[i] = j;
      }
    }
  }
  let end = len.indexOf(Math.max(0, ...len));
  const inOrder = new Set<string>();
  while (end >= 0) {
    inOrder.add(ids[end]!);
    end = prev[end]!;
  }
  return new Set(ids.filter((id) => !inOrder.has(id)));
}

const PART_NOUN: Record<string, string> = {
  keys: "keys part",
  "synth/pads": "synth/pads part",
  "electric guitar": "electric guitar part",
  "acoustic guitar": "acoustic guitar part",
  bass: "bass part",
  drums: "drum part",
};
const partNoun = (role: string) => PART_NOUN[role] ?? `${PART_ROLES.find((p) => p.role === role)?.label.toLowerCase() ?? role} part`;

/** "Chorus x2 (High)". */
const stepText = (s: SeqStep) => `${s.name}${s.repeat > 1 ? ` x${s.repeat}` : ""}${s.tags.length ? ` (${s.tags.join(", ")})` : ""}`;
/** "Chorus (High)": where in the song, for instrument parts. */
const stepPlace = (s: SeqStep) => `${s.name}${s.tags.length ? ` (${s.tags.join(", ")})` : ""}`;

/** "A", "A and B", "A, B and C". */
function list(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

function songChanges(a: PlanItem, b: PlanItem, song: string, names: (id: string) => string | null): string[] {
  const out: string[] = [];
  const title = b.title.trim() || song;
  if ((a.key ?? "") !== (b.key ?? "")) {
    if (a.key && b.key) out.push(`${title}'s key has been changed from ${a.key} to ${b.key}`);
    else if (b.key) out.push(`${title}'s key has been set to ${b.key}`);
    else out.push(`${title} no longer has a key set`);
  }
  if ((a.transpose_to ?? "") !== (b.transpose_to ?? "") && b.key) {
    if (b.transpose_to) out.push(`${title} now changes key from ${b.key} to ${b.transpose_to}`);
    else out.push(`${title} no longer changes key`);
  }
  if ((a.bpm ?? null) !== (b.bpm ?? null) && b.bpm) out.push(`${cap(song)} is now at ${b.bpm} bpm`);
  if (a.lead_id !== b.lead_id) {
    const who = b.lead_id ? names(b.lead_id) : null;
    out.push(who ? `${who} is now leading ${song}` : `Nobody is set to lead ${song} now`);
  }
  out.push(...sequenceChanges(a.sequence, b.sequence, song));
  if (a.notes.trim() !== b.notes.trim()) out.push(`The notes for ${song} have changed`);
  if (JSON.stringify(a.links ?? []) !== JSON.stringify(b.links ?? [])) out.push(`The links for ${song} have changed`);
  if ((a.sheet?.id ?? null) !== (b.sheet?.id ?? null)) {
    if (b.sheet) out.push(a.sheet ? `${cap(song)} has a new songsheet` : `${cap(song)} has its own songsheet now`);
    else out.push(`${cap(song)}'s uploaded songsheet has been removed`);
  }
  return out;
}

/**
 * The band's notice only says that a song's sequence changed, in one line: the steps, parts and
 * comments themselves are shown in the session's "Show changes" view (see plan-diff).
 */
function sequenceChanges(before: SeqStep[] | null, after: SeqStep[] | null, song: string): string[] {
  const a = before ?? [];
  const b = after ?? [];
  if (!a.length && b.length) return [`A sequence has been added to ${song}`];
  if (a.length && !b.length) return [`The sequence for ${song} has been cleared`];
  return sequenceDetails(a, b, song).length ? [`The song sequence for ${song} has changed`] : [];
}

/** Every change to a sequence in words (kept for telling whether anything changed). */
function sequenceDetails(before: SeqStep[] | null, after: SeqStep[] | null, song: string): string[] {
  const a = before ?? [];
  const b = after ?? [];
  if (!a.length && b.length) {
    return [`A sequence has been added to ${song}`, ...b.flatMap((s) => (s.parts ?? []).map((p) => `There is a new ${partNoun(p)} during ${stepPlace(s)} in ${song}`))];
  }
  if (a.length && !b.length) return [`The sequence for ${song} has been cleared`];

  const out: string[] = [];
  const oldById = new Map(a.map((s) => [s.id, s]));
  const newById = new Map(b.map((s) => [s.id, s]));
  const added = b.filter((s) => !oldById.has(s.id));
  const removed = a.filter((s) => !newById.has(s.id));
  if (added.length) out.push(`There is a new ${list(added.map(stepText))} in ${song}`);
  if (removed.length) out.push(`${removed.map(stepText).join(", ")} has been removed from ${song}`);

  const kept = b.filter((s) => oldById.has(s.id));
  if (outOfOrder(kept.map((s) => s.id), (id) => a.findIndex((s) => s.id === id)).size) {
    out.push(`The sequence of ${song} has been rearranged`);
  }
  for (const s of b) {
    const was = oldById.get(s.id);
    if (was && stepText(was) !== stepText(s)) out.push(`${stepText(was)} is now ${stepText(s)} in ${song}`);
    const before = new Set(was?.parts ?? []);
    const now = new Set(s.parts ?? []);
    for (const p of now) if (!before.has(p)) out.push(`There is a new ${partNoun(p)} during ${stepPlace(s)} in ${song}`);
    for (const p of before) if (!now.has(p)) out.push(`The ${partNoun(p)} during ${stepPlace(s)} in ${song} has been taken out`);
    if (was && (was.comment ?? "") !== (s.comment ?? "")) {
      out.push(s.comment ? `New note on ${stepPlace(s)} in ${song}: “${s.comment}”` : `The note on ${stepPlace(s)} in ${song} has been taken out`);
    }
  }
  return out;
}

/** The transitions, to tell whether any changed. */
function transitionsKey(plan: PlanSection[]): string {
  return JSON.stringify(
    plan.flatMap((s) => s.items).filter((i) => i.kind === "transition").map((i) => [i.id, i.key ?? "", i.notes.trim()]),
  );
}
