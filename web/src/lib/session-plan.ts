/**
 * Session plans, shared by the server and the browser: the shape of a plan, the default
 * sections for each kind of service, and the editing lock timings.
 */

export type SongType = "praise" | "worship" | "praise_worship";
export type PlanStatus = "draft" | "published";
/** Where a session the worship leader can build is up to. */
export type BuildStage = "not_started" | PlanStatus;

export type PlanLink = { label: string; url: string };

/**
 * One step of a song's sequence, e.g. Chorus x2 (High, Half-time), with the instruments the worship
 * leader wants to come through more there (roster roles, e.g. "drums"). Plans saved before parts
 * existed have no `parts`. A comment (e.g. WL sings "You are good" x3) puts the step on a line of
 * its own in the sequence, with the comment under it.
 */
export type SeqStep = { id: string; name: string; repeat: number; tags: string[]; parts?: string[]; comment?: string };

export type PlanItem = {
  id: string;
  kind: "song" | "transition";
  /** Picked from the song bank (null = typed in, or still blank). */
  song_id: string | null;
  /** The worship leader or vocalist leading it. Can be set before the song is picked. */
  lead_id: string | null;
  title: string;
  type: SongType | null;
  bpm: number | null;
  key: string | null;
  /** The key it changes to partway through (e.g. E -> G), or null for no key change. */
  transpose_to: string | null;
  artist: string | null;
  /** null = not set yet. */
  sequence: SeqStep[] | null;
  /** Elements added for this song in this session, on top of the songsheet's (e.g. Music, L2L). */
  custom_elements: string[];
  /** null = not set yet. */
  links: PlanLink[] | null;
  notes: string;
  /** The worship leader's own songsheet for this song (null = none; a bank song uses the library's). */
  sheet: UploadedSheet | null;
};

export type PlanSection = { id: string; name: string; items: PlanItem[] };

/**
 * A songsheet the worship leader attached to a song themselves (a PDF, or a .docx turned into one),
 * instead of a song from the bank. Kept with the session only. For a .docx, the sections and
 * sequence the scanner read from it, offered in the sequence builder.
 */
export type UploadedSheet = {
  id: string;
  file_name: string;
  format: "pdf" | "docx";
  /** The key the songsheet is written in. The song's own key can differ. */
  key?: string | null;
  /** A Word sheet whose original is kept: it's shown transposed to the song's key. */
  transposable?: boolean;
  /** Key changes written in the sheet, in semitones up (e.g. [2] for "E→F#"): transposing keeps them. */
  changes?: number[];
  sections?: string[];
  sequence?: string[];
};

/** What attaching a .docx read from it, to fill in the song's details. */
export type SheetScan = {
  title: string | null;
  artist: string | null;
  key: string | null;
  bpm: number | null;
  type: SongType | null;
  sequence: string[];
  youtube_links: string[];
  /** A key change written in the sheet: semitones up from its first key to the next (e.g. 2 for "E→F#"). */
  key_change?: number | null;
};

/** Songsheets a worship leader can attach: up to 4 MB (under the host's request limit), PDF or .docx. */
export const MAX_SESSION_SHEET_BYTES = 4 * 1024 * 1024;

export function sessionSheetProblem(file: { name: string; size: number }): string | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) return "Choose a PDF or a Word (.docx) songsheet. For an older .doc, open it in Word and Save As .docx or PDF.";
  if (file.size > MAX_SESSION_SHEET_BYTES) return "This file is larger than 4 MB.";
  if (file.size === 0) return "This file is empty.";
  return null;
}

export const SONG_TYPE_LABEL: Record<SongType, string> = {
  praise: "Praise",
  worship: "Worship",
  praise_worship: "Praise / Worship",
};

export const STAGE_LABEL: Record<BuildStage, string> = {
  not_started: "Not started",
  draft: "Draft",
  published: "Published",
};

/** A lock not renewed for this long is free for the other worship leader. */
export const LOCK_STALE_MS = 2 * 60_000;
/** How often the editor's page renews its lock. */
export const LOCK_RENEW_MS = 30_000;

export function newId(): string {
  return crypto.randomUUID();
}

export function blankSong(): PlanItem {
  return {
    id: newId(),
    kind: "song",
    song_id: null,
    lead_id: null,
    title: "",
    type: null,
    bpm: null,
    key: null,
    transpose_to: null,
    artist: null,
    sequence: null,
    custom_elements: [],
    links: null,
    notes: "",
    sheet: null,
  };
}

export function blankTransition(): PlanItem {
  return { ...blankSong(), kind: "transition" };
}

const section = (name: string, songs: number): PlanSection => ({ id: newId(), name, items: Array.from({ length: songs }, blankSong) });

/** The sections a new session starts with: blank songs, ready to fill in. */
export function defaultPlan(service: string): PlanSection[] {
  switch (service) {
    case "em_sunday":
    case "cm_sunday":
      return [section("Main Set", 4), section("Closing Song", 1)];
    case "cm_pnp":
      return [section("Main Set", 3)];
    case "em_pnp":
      return [section("Set 1", 2), section("Set 2", 2)];
    default:
      return [section("Main Set", 4)];
  }
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

/** Offered as extra elements for any song. */
export const SUGGESTED_ELEMENTS = ["Music", "L2L", "L3L"];
/** Offered as tags for any step, alongside every tag already used in the session. */
export const SUGGESTED_TAGS = ["High", "Low", "Soft", "Half-time"];

export const step = (name: string): SeqStep => ({ id: newId(), name, repeat: 1, tags: [] });

/** A sequence from a list of section names, e.g. the songsheet's. Repeats in a row become x2. */
export function stepsFrom(names: string[]): SeqStep[] {
  return names.reduce<SeqStep[]>((out, n) => insertElement(out, out.length, n).steps, []);
}

/**
 * Put an element into the sequence at position `at` (0 = start). The same element right before
 * that spot (with no tags of its own) just counts one more time: Verse x2.
 * Returns the new steps and where the next one goes.
 */
export function insertElement(steps: SeqStep[], at: number, name: string): { steps: SeqStep[]; at: number } {
  const prev = steps[at - 1];
  if (prev && prev.name === name && prev.tags.length === 0 && !prev.parts?.length && !prev.comment) {
    return { steps: steps.map((s, i) => (i === at - 1 ? { ...s, repeat: s.repeat + 1 } : s)), at };
  }
  return { steps: [...steps.slice(0, at), step(name), ...steps.slice(at)], at: at + 1 };
}

/** The same steps with new ids, e.g. a song's standard sequence copied into a session. */
export const copySteps = (steps: SeqStep[]): SeqStep[] => steps.map((s) => ({ ...s, id: newId(), tags: [...s.tags], parts: s.parts ? [...s.parts] : undefined }));

/** A sequence as plain section names, repeats written out: Verse x2 → Verse, Verse. */
export const stepNames = (steps: SeqStep[]): string[] => steps.flatMap((s) => Array<string>(s.repeat).fill(s.name));

/** A song's standard sequence: the steps built on its page, or else its plain section names. */
export function songSteps(standardSteps: unknown, standardSequence: string[] | null | undefined): SeqStep[] {
  return Array.isArray(standardSteps) && standardSteps.length ? cleanSteps(standardSteps) : stepsFrom(standardSequence ?? []);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Check and tidy a sequence sent from the browser (or read back from the database). */
export function cleanSteps(raw: unknown[]): SeqStep[] {
  return raw
    .map((x): SeqStep | null => {
      const s = x as Record<string, unknown>;
      const name = clip(s?.name, 40);
      if (!name) return null;
      const repeat = Math.round(Number(s.repeat));
      return {
        id: typeof s.id === "string" && UUID_RE.test(s.id) ? s.id : newId(),
        name,
        repeat: Number.isFinite(repeat) ? Math.min(20, Math.max(1, repeat)) : 1,
        tags: Array.isArray(s.tags) ? [...new Set((s.tags as unknown[]).map((t) => clip(t, 30)).filter(Boolean))].slice(0, 8) : [],
        parts: Array.isArray(s.parts) ? PART_ROLES.map((p) => p.role).filter((r) => (s.parts as unknown[]).includes(r)) : [],
        ...(clip(s.comment, 160) ? { comment: clip(s.comment, 160) } : {}),
      };
    })
    .filter((s): s is SeqStep => s !== null)
    .slice(0, 60);
}

/** Short names for the simplified view: Verse 3 -> V3, Chorus -> C. Anything else stays as it is. */
const SHORT_NAMES: Record<string, string> = { verse: "V", chorus: "C" };

export function shortName(name: string): string {
  const m = /^(verse|chorus)\s*(.*)$/i.exec(name.trim());
  if (!m) return name;
  const short = SHORT_NAMES[m[1].toLowerCase()];
  const rest = m[2];
  // A number sticks to it (V3); anything else keeps a space (C (alt)).
  return !rest ? short : /^\d/.test(rest) ? `${short}${rest}` : `${short} ${rest}`;
}

/** "Verse 1 x2 (High, Half-time)". */
export function stepLabel(s: SeqStep): string {
  return `${s.name}${s.repeat > 1 ? ` x${s.repeat}` : ""}${s.tags.length ? ` (${s.tags.join(", ")})` : ""}`;
}

// ---------------------------------------------------------------------------
// Instrument parts: "this bit is drum-heavy"
// ---------------------------------------------------------------------------

/** The instruments a step can feature, in roster order, each with its own colour. */
export const PART_ROLES: { role: string; label: string; color: string }[] = [
  { role: "keys", label: "Keys", color: "#4a6fa5" },
  { role: "synth/pads", label: "Synth/Pads", color: "#7b68a6" },
  { role: "electric guitar", label: "Electric Guitar", color: "#b0564f" },
  { role: "acoustic guitar", label: "Acoustic Guitar", color: "#5b8a5a" },
  { role: "bass", label: "Bass", color: "#3d8580" },
  { role: "drums", label: "Drums", color: "#ad5a7f" },
];

export const partInfo = (role: string) => PART_ROLES.find((p) => p.role === role);

/** Worship leader and vocalist colours, apart from the instruments', for roles that aren't parts. */
const SINGER_COLORS: Record<string, string> = { "worship leader": "#b5852a", vocalist: "#c4692f" };

/** Media teams' roles, each its own colour (for the viewer's highlight on a crew). */
const CREW_COLORS: Record<string, string> = {
  "media ic": "#9a6b2f",
  "wide angle cam": "#3f78a8",
  "close up cam": "#2f8a8a",
  "roving cam": "#6a8a3a",
  director: "#a0525a",
  "video mixer": "#7b5ea7",
  projectionist: "#c0702f",
  lights: "#b59a2a",
  soundboard: "#5a6b8c",
};

/** Any rostered role's colour (singers, instruments or a crew's roles); null for anything else. */
export const roleColor = (role: string) => SINGER_COLORS[role] ?? partInfo(role)?.color ?? CREW_COLORS[role] ?? null;

/** An instrument's colour, see-through: the tint behind its cards. */
export const partTint = (color: string) => `${color}26`;

/** A song where the worship leader wants more of one instrument, and the steps where they do. */
export type PartCue = { title: string; steps: string[] };

/** Where the plan features this instrument (none if the role isn't an instrument). */
export function partCues(items: Pick<PlanItem, "kind" | "title" | "sequence">[], role: string | null): PartCue[] {
  if (!role || !partInfo(role)) return [];
  return items
    .filter((i) => i.kind === "song")
    .map((i) => ({
      title: i.title || "Untitled song",
      steps: (Array.isArray(i.sequence) ? i.sequence : []).filter((s) => s.parts?.includes(role)).map(stepLabel),
    }))
    .filter((c) => c.steps.length > 0);
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** The keys a session song can be in: the 12 major keys, spelled the way worship charts usually are. */
export const MAJOR_KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

const ENHARMONIC: Record<string, string> = { "C#": "Db", "D#": "Eb", Gb: "F#", "G#": "Ab", "A#": "Bb", Cb: "B", "B#": "C", Fb: "E", "E#": "F" };

/**
 * One of MAJOR_KEYS from whatever a songsheet says ("E", "C#", "Bbm", "F → F#": the first key),
 * or null if it isn't a key. Minor keys become their tonic's major key.
 */
export function majorKey(raw: string | null | undefined): string | null {
  const m = /^\s*([A-Ga-g])\s*([#b♯♭]?)/.exec(raw ?? "");
  if (!m) return null;
  const name = m[1].toUpperCase() + (m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2]);
  const key = ENHARMONIC[name] ?? name;
  return (MAJOR_KEYS as readonly string[]).includes(key) ? key : null;
}

/** 0-11 from C, or null if it isn't a key. */
export function pitchClass(raw: string | null | undefined): number | null {
  const k = majorKey(raw);
  return k ? MAJOR_KEYS.indexOf(k as (typeof MAJOR_KEYS)[number]) : null;
}

/** Semitones up from one key to another (0-11), or null if either isn't a key. */
export function semitonesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = pitchClass(from);
  const b = pitchClass(to);
  return a === null || b === null ? null : (b - a + 12) % 12;
}

/** "E", or "E→G" for a song that changes key. */
export function keyLabel(key: string | null, transposeTo?: string | null): string | null {
  if (!key) return null;
  return transposeTo && majorKey(transposeTo) !== majorKey(key) ? `${key}→${transposeTo}` : key;
}

/**
 * The key distances a songsheet already has in it: its key changes (key_display "E→F#" has 2, and
 * "C→D→E" has 2 and 4) and copies written out in another key (alternate_keys), from its first key.
 * Transposing the sheet keeps them, so a session's E→G is covered by one sheet with a +3 in it.
 */
export function sheetIntervals(keyDisplay: string | null | undefined, keys: string[] | null | undefined, alternateKeys: string[] | null | undefined): number[] {
  const main = (keyDisplay ? keyDisplay.split(/\s*(?:→|->|-|–|—|,|\/)\s*/) : (keys ?? [])).filter((k) => pitchClass(k) !== null);
  const out = new Set<number>();
  for (let i = 0; i < main.length; i++) for (let j = i + 1; j < main.length; j++) out.add(semitonesBetween(main[i], main[j])!);
  const first = main[0] ?? keys?.[0];
  for (const alt of alternateKeys ?? []) {
    const d = semitonesBetween(first, alt);
    if (d !== null) out.add(d);
  }
  out.delete(0);
  return [...out];
}

/** Check and tidy an attached songsheet sent from the browser (or read back from the database). */
export function cleanSheet(raw: unknown): UploadedSheet | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s !== "object" || typeof s.id !== "string" || !UUID_RE.test(s.id)) return null;
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => clip(x, 40)).filter(Boolean).slice(0, 60) : undefined);
  const sections = names(s.sections);
  const sequence = names(s.sequence);
  const key = majorKey(typeof s.key === "string" ? s.key : null);
  const changes = Array.isArray(s.changes) ? [...new Set(s.changes.filter((n): n is number => Number.isInteger(n) && n > 0 && n < 12))].slice(0, 10) : [];
  return {
    id: s.id.toLowerCase(),
    file_name: clip(s.file_name, 200) || "Songsheet.pdf",
    format: s.format === "docx" ? "docx" : "pdf",
    ...(key ? { key } : {}),
    ...(s.transposable === true && s.format === "docx" ? { transposable: true } : {}),
    ...(changes.length ? { changes } : {}),
    ...(sections?.length ? { sections } : {}),
    ...(sequence?.length ? { sequence } : {}),
  };
}

/**
 * The key a worship leader's own songsheet is shown in: a Word sheet is transposed to the song's
 * key; a PDF stays in the key it's written in.
 */
export function ownSheetShownKey(item: Pick<PlanItem, "key" | "sheet">): string | null {
  if (!item.sheet) return null;
  return item.sheet.transposable && item.key ? majorKey(item.key) : (item.sheet.key ?? null);
}

/**
 * The keys a worship leader's own Word songsheet comes in: the song's key, and for a song that
 * changes key (C→E) a second copy in the key it changes to, as for a bank song. A PDF, or a sheet
 * without its original, comes in one key: empty here.
 */
export function ownSheetKeys(item: Pick<PlanItem, "key" | "transpose_to" | "sheet">): string[] {
  if (!item.sheet?.transposable || !item.sheet.key) return [];
  const from = majorKey(item.key);
  const to = majorKey(item.transpose_to);
  if (!from) return [];
  // The sheet already has that key change written in (E→F# for a song going F→G): one copy covers it.
  if (to && to !== from && !item.sheet.changes?.includes(semitonesBetween(from, to)!)) return [from, to];
  return [from];
}

/**
 * A step comment too long to sit beside the step in a sequence you read: it goes on its own line
 * under the step instead, and the next step starts a new line.
 */
export const isLongComment = (comment: string | null | undefined) => (comment?.trim().length ?? 0) > 24;

/** The key `n` semitones up from `key` (one of MAJOR_KEYS), or null if it isn't a key. */
export function keyUp(key: string | null | undefined, n: number): string | null {
  const pc = pitchClass(key);
  return pc === null ? null : MAJOR_KEYS[(((pc + n) % 12) + 12) % 12];
}

/** The key of a worship leader's own songsheet when it's shown in another key than the song's (null when they match or either is unknown). */
export function sheetKeyMismatch(item: Pick<PlanItem, "key" | "sheet">): string | null {
  const shown = ownSheetShownKey(item);
  return shown && item.key && majorKey(shown) !== majorKey(item.key) ? shown : null;
}
