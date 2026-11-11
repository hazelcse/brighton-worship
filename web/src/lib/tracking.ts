/**
 * Session tracking (root only): a record of each session that has happened, with who played and
 * what was sung. Shared by the server and the browser.
 */

/** The band columns of the tracking table, in order. */
export const BAND_COLUMNS = [
  { key: "wl", label: "WL", long: "Worship Leader" },
  { key: "vox", label: "Vox", long: "Vocals" },
  { key: "keys", label: "Keys", long: "Keys" },
  { key: "ag", label: "AG", long: "Acoustic Guitar" },
  { key: "eg", label: "EG", long: "Electric Guitar" },
  { key: "bass", label: "Bass", long: "Bass" },
  { key: "drums", label: "Drums", long: "Drums" },
] as const;
export type BandKey = (typeof BAND_COLUMNS)[number]["key"];

/** Which column a roster role goes in (synth/pads shares Keys; band leader is on top of an instrument). */
export const ROLE_TO_BAND: Record<string, BandKey> = {
  "worship leader": "wl",
  vocalist: "vox",
  keys: "keys",
  "synth/pads": "keys",
  "acoustic guitar": "ag",
  "electric guitar": "eg",
  bass: "bass",
  drums: "drums",
};

export type Band = Partial<Record<BandKey, string[]>>;
/** A song as tracked. `closing`: the Sunday service's closing song (it goes in the Song 5 column). */
export type TrackedSong = {
  title: string;
  artist: string;
  key: string;
  lead: string;
  closing?: boolean;
};

/** Songs and links kept per session (the table has five song groups and two link columns). */
export const MAX_SONGS = 5;
export const MAX_LINKS = 2;
/** A Sunday service keeps up to four main-set songs and one closing song. */
export const MAX_MAIN_SET = 4;

/** Sunday services have a main set plus a closing song. */
export const isSunday = (kind: string) => kind === "em_sunday" || kind === "cm_sunday";

/**
 * A session's songs by table column (index 0 is Song 1). With a closing song, the main set fills
 * Songs 1–4 and the closing song is Song 5; otherwise the songs go in order.
 */
export function songSlots(songs: TrackedSong[]): (TrackedSong | undefined)[] {
  const closing = songs.find((s) => s.closing);
  if (!closing) return Array.from({ length: MAX_SONGS }, (_, i) => songs[i]);
  const main = songs.filter((s) => !s.closing);
  return [...Array.from({ length: MAX_MAIN_SET }, (_, i) => main[i]), closing];
}

export type TrackedMinistry = "em" | "cm" | "any";

export type SessionRecord = {
  id: string;
  date: string;
  ministry: TrackedMinistry;
  kind: string;
  serviceName: string;
  band: Band;
  songs: TrackedSong[];
  links: string[];
  comments: string;
  /** Set for a session that didn't happen: why (e.g. "REKINDLE 2026"), from roster setup. Not editable here. */
  cancelReason?: string;
};

/** A session that has happened and isn't in tracking yet. Songs: everything in its plan (may be more than fit). */
export type PendingSession = {
  rosterSessionId: string;
  date: string;
  ministry: TrackedMinistry;
  kind: string;
  serviceName: string;
  band: Band;
  songs: TrackedSong[];
  /** The worship leaders made a plan for it (songs may still be empty). */
  hasPlan: boolean;
};

/** What root saves when confirming or editing a session. */
export type RecordInput = {
  band: Band;
  songs: TrackedSong[];
  links: string[];
  comments: string;
};

export const MINISTRY_TEXT: Record<TrackedMinistry, string> = {
  em: "EM",
  cm: "CM",
  any: "EM/CM",
};

/** The kind of service, for filtering: Sunday Service and Prayer & Praise group EM and CM together. */
export function serviceType(kind: string, serviceName: string): string {
  if (kind === "em_sunday" || kind === "cm_sunday") return "Sunday Service";
  if (kind === "em_pnp" || kind === "cm_pnp") return "Prayer & Praise";
  return serviceName;
}

/** A link's short label, e.g. "youtube.com". */
export function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Tidy what root typed (names trimmed, blanks dropped, at most five songs and two links). A
 * Sunday service keeps up to four main-set songs then one closing song; other services have no
 * closing song.
 */
export function cleanRecordInput(input: RecordInput, kind: string): RecordInput {
  const band: Band = {};
  for (const c of BAND_COLUMNS) {
    const names = (input.band?.[c.key] ?? []).map((n) => String(n).trim()).filter(Boolean);
    if (names.length) band[c.key] = names;
  }
  const sunday = isSunday(kind);
  const all = (input.songs ?? [])
    .map((s) => ({
      title: String(s.title ?? "").trim(),
      artist: String(s.artist ?? "").trim(),
      key: String(s.key ?? "").trim(),
      lead: String(s.lead ?? "").trim(),
      closing: sunday && s.closing === true,
    }))
    .filter((s) => s.title);
  const main = all.filter((s) => !s.closing).map((s) => ({ title: s.title, artist: s.artist, key: s.key, lead: s.lead }));
  const closing = all.filter((s) => s.closing);
  let songs: TrackedSong[];
  if (sunday) {
    if (main.length > MAX_MAIN_SET) throw new Error(`Pick at most ${MAX_MAIN_SET} main-set songs.`);
    if (closing.length > 1) throw new Error("Pick one closing song.");
    songs = [...main, ...closing];
  } else {
    if (main.length > MAX_SONGS) throw new Error(`Pick at most ${MAX_SONGS} songs.`);
    songs = main;
  }
  const links = (input.links ?? []).map((l) => String(l).trim()).filter(Boolean);
  if (links.length > MAX_LINKS) throw new Error(`Add at most ${MAX_LINKS} links.`);
  for (const l of links) {
    let ok = false;
    try {
      ok = ["http:", "https:"].includes(new URL(l).protocol);
    } catch {}
    if (!ok) throw new Error(`"${l}" isn't a web link (it should start with https://).`);
  }
  return {
    band,
    songs,
    links,
    comments: String(input.comments ?? "")
      .trim()
      .slice(0, 4000),
  };
}
