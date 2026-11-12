/**
 * The Tracking page's query search: a small pandas-like language over the tracking columns.
 *
 *   [WL = "Vanessa"] and [Song Title = "Praise"]
 *   [WL = "Caleb"] or [Vox = "Caleb"]
 *   [Keys = "Shang Yew"] and ![AG = "Chong Han"]
 *   [Song Title = "Praise"] and ![Song 1 Title = "The Joy"]
 *
 * Values go in double quotes (optional); single quotes and apostrophes are part of the value,
 * so [Song Title = "I'm Not Ashamed"] works. Each [column op value] tests one column. A column holding several values (Vox's names, the five
 * song titles…) matches when any of them does. Text is compared ignoring case and outer spaces.
 * Ops: = (or ==) exact, != not equal, ~ contains; >, <, >=, <= compare as text (dates are
 * YYYY-MM-DD). Combine with and (&, &&), or (|, ||), not (!), and brackets ( ). And binds tighter
 * than or, as in pandas.
 */
import { BAND_COLUMNS, MAX_SONGS, MINISTRY_TEXT, serviceType, songSlots, type SessionRecord, type TrackedSong } from "./tracking";

type Op = "=" | "!=" | "~" | ">" | "<" | ">=" | "<=";
type Test = { kind: "test"; label: string; values: (r: SessionRecord) => string[]; op: Op; value: string };
type Node = Test | { kind: "not"; node: Node } | { kind: "and" | "or"; left: Node; right: Node };

export type Query = { ok: true; node: Node } | { ok: false; error: string };

const squash = (s: string) => s.toLowerCase().replace(/[\s_\-&/.]+/g, "");

const SONG_FIELDS: Record<string, keyof Omit<TrackedSong, "closing">> = {
  title: "title",
  name: "title",
  "": "title",
  artist: "artist",
  key: "key",
  lead: "lead",
  leadvox: "lead",
  leadvocals: "lead",
};

const BAND_NAMES: Record<string, (typeof BAND_COLUMNS)[number]["key"]> = {};
for (const c of BAND_COLUMNS) {
  BAND_NAMES[squash(c.label)] = c.key;
  BAND_NAMES[squash(c.long)] = c.key;
}
// "Key" (singular) is a song's key, not the keys player.
Object.assign(BAND_NAMES, { worshipleaders: "wl", vocal: "vox", vocalist: "vox", vocalists: "vox", keyboard: "keys", drum: "drums", drummer: "drums" });

const allBand = (r: SessionRecord) => BAND_COLUMNS.flatMap((c) => r.band[c.key] ?? []);

/** The column a field name means, or null. */
function column(raw: string): Test["values"] | null {
  const f = squash(raw);
  if (BAND_NAMES[f]) {
    const key = BAND_NAMES[f];
    return (r) => r.band[key] ?? [];
  }
  if (["musician", "musicians", "band", "anyone", "person", "people"].includes(f)) return allBand;
  // Song 3 Title, Song3Artist, Song 1 → title of that slot; Song Title / Title → any song.
  const numbered = f.match(/^songs?([1-9])(.*)$/);
  if (numbered) {
    const n = Number(numbered[1]);
    const field = SONG_FIELDS[numbered[2]];
    if (!field || n > MAX_SONGS) return null;
    return (r) => {
      const s = songSlots(r.songs)[n - 1];
      return s ? [s[field]] : [];
    };
  }
  // Song Title / Song Artist / Title / Key… → that field of any of the songs.
  const field = SONG_FIELDS[f.replace(/^songs?/, "")];
  if (field && (f.startsWith("song") || f !== "")) return (r) => r.songs.map((s) => s[field]);
  if (f === "service" || f === "servicename" || f === "type") return (r) => [r.serviceName, serviceType(r.kind, r.serviceName)];
  // A session for both ministries counts as EM and as CM, like the Ministry filter.
  if (f === "ministry" || f === "emcm") return (r) => (r.ministry === "any" ? ["EM", "CM", MINISTRY_TEXT.any] : [MINISTRY_TEXT[r.ministry]]);
  if (f === "date") return (r) => [r.date];
  if (f === "link" || f === "links") return (r) => r.links;
  if (f === "link1" || f === "link2") return (r) => (r.links[Number(f.slice(4)) - 1] ? [r.links[Number(f.slice(4)) - 1]] : []);
  if (f === "comment" || f === "comments" || f === "notes") return (r) => (r.comments ? [r.comments] : []);
  if (f === "reason" || f === "cancelled" || f === "nosession") return (r) => (r.cancelReason ? [r.cancelReason] : []);
  return null;
}

export const QUERY_COLUMNS =
  "WL, Vox, Keys, AG, EG, Bass, Drums, Musician, Service, Ministry, Date, Song Title / Artist / Key / Lead (any song) or Song 1–5 Title / Artist / Key / Lead, Link, Comments";

const DOUBLE = ['"', "“", "”"];

type Tok = { t: "test"; field: string; op: Op; value: string; at: number } | { t: "and" | "or" | "not" | "(" | ")"; at: number };

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "[") {
      // Find the closing ], skipping anything in double quotes. Only double quotes (straight or
      // curly, as phones type them) wrap a value: apostrophes are part of it (I'm Not Ashamed).
      let j = i + 1;
      let quoted = false;
      for (; j < src.length; j++) {
        const d = src[j];
        if (DOUBLE.includes(d)) quoted = !quoted;
        else if (d === "]" && !quoted) break;
      }
      if (j >= src.length) return `Missing ] after "${src.slice(i, i + 24)}".`;
      const inner = src.slice(i + 1, j);
      const m = inner.match(/^\s*([^=!<>~"“”]+?)\s*(==|!=|>=|<=|=|>|<|~)\s*(.*?)\s*$/);
      if (!m) return `Write each test as [Column = "value"], e.g. [WL = "Vanessa"]. Couldn't read [${inner}].`;
      let value = m[3];
      const q = value.match(/^(["“”])(.*)(["“”])$/);
      if (q) value = q[2];
      out.push({ t: "test", field: m[1], op: (m[2] === "==" ? "=" : m[2]) as Op, value, at: i });
      i = j + 1;
      continue;
    }
    if (c === "(" || c === ")") {
      out.push({ t: c, at: i });
      i++;
      continue;
    }
    if (c === "!" || c === "~") {
      out.push({ t: "not", at: i });
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      out.push({ t: two === "&&" ? "and" : "or", at: i });
      i += 2;
      continue;
    }
    if (c === "&" || c === "|") {
      out.push({ t: c === "&" ? "and" : "or", at: i });
      i++;
      continue;
    }
    const word = src.slice(i).match(/^[a-z]+/i)?.[0];
    if (word && ["and", "or", "not"].includes(word.toLowerCase())) {
      out.push({ t: word.toLowerCase() as "and" | "or" | "not", at: i });
      i += word.length;
      continue;
    }
    return `Didn't understand "${src.slice(i, i + 16)}". Put each test in [ ], and join them with and / or.`;
  }
  return out;
}

/** Parse a query. An empty one comes back not ok with an empty error (nothing to filter by). */
export function parseQuery(src: string): Query {
  const toks = tokenize(src);
  if (typeof toks === "string") return { ok: false, error: toks };
  if (!toks.length) return { ok: false, error: "" };
  let p = 0;
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  const orExpr = (): Node => {
    let left = andExpr();
    while (toks[p]?.t === "or") {
      p++;
      left = { kind: "or", left, right: andExpr() };
    }
    return left;
  };
  const andExpr = (): Node => {
    let left = unary();
    while (toks[p]?.t === "and") {
      p++;
      left = { kind: "and", left, right: unary() };
    }
    return left;
  };
  const unary = (): Node => {
    if (toks[p]?.t === "not") {
      p++;
      return { kind: "not", node: unary() };
    }
    return primary();
  };
  const primary = (): Node => {
    const t = toks[p];
    if (!t) return fail("The query ends too soon: add a test like [WL = \"Vanessa\"].");
    if (t.t === "(") {
      p++;
      const n = orExpr();
      if (toks[p]?.t !== ")") fail("Missing ) to close a bracket.");
      p++;
      return n;
    }
    if (t.t === "test") {
      p++;
      const values = column(t.field);
      if (!values) return fail(`No column called "${t.field.trim()}". Columns: ${QUERY_COLUMNS}.`);
      return { kind: "test", label: t.field, values, op: t.op, value: t.value };
    }
    return fail(`Expected a test like [WL = "Vanessa"] before "${t.t}".`);
  };
  try {
    const node = orExpr();
    if (p < toks.length) {
      const t = toks[p];
      fail(t.t === ")" ? "There's a ) without a matching (." : "Join tests with and / or, e.g. [WL = \"Caleb\"] or [Vox = \"Caleb\"].");
    }
    return { ok: true, node };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const clean = (s: string) => s.trim().toLowerCase();

function test(t: Test, r: SessionRecord): boolean {
  const want = clean(t.value);
  const have = t.values(r).map(clean);
  switch (t.op) {
    case "=":
      return have.includes(want);
    // Not equal: none of the column's values is it (Vox != "Caleb": Caleb wasn't on vocals).
    case "!=":
      return !have.includes(want);
    case "~":
      return have.some((h) => h.includes(want));
    case ">":
      return have.some((h) => h > want);
    case "<":
      return have.some((h) => h !== "" && h < want);
    case ">=":
      return have.some((h) => h >= want);
    case "<=":
      return have.some((h) => h !== "" && h <= want);
  }
}

export function runQuery(node: Node, r: SessionRecord): boolean {
  switch (node.kind) {
    case "test":
      return test(node, r);
    case "not":
      return !runQuery(node.node, r);
    case "and":
      return runQuery(node.left, r) && runQuery(node.right, r);
    case "or":
      return runQuery(node.left, r) || runQuery(node.right, r);
  }
}
