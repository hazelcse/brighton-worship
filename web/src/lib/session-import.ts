/**
 * Reading past sessions from the worship team's records spreadsheet: its "Database" sheet as an
 * Excel workbook (.xlsx, read by lib/xlsx.ts) or saved as CSV. One row per session.
 *
 * Columns, found by their header (any order; the rows above the header are skipped):
 *   Date · Worship Leader · Singer · Drummer · Electric Guitarist · Acoustic Guitarist · Bassist ·
 *   Keyboardist · Synth Player · then for songs 1–5: WL (that song's lead), Artist n, Song n, Key n ·
 *   Link 1 · Link 2
 * Optional: Service ("EM Sunday Service", "CM Prayer & Praise", any other name for an ad-hoc
 * event), Ministry (EM / CM), Comments. Without a Service column a Sunday is the EM Sunday
 * Service. Other columns (No., Unique ID, Artists, Songs, ...) are ignored.
 */
import { BAND_COLUMNS, isSunday, type Band, type BandKey, type TrackedMinistry, type TrackedSong } from "@/lib/tracking";

export type ImportedSession = {
  line: number;
  date: string;
  kind: string;
  serviceName: string;
  ministry: TrackedMinistry;
  band: Band;
  songs: TrackedSong[];
  links: string[];
  comments: string;
};

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const BAND_HEADERS: Record<string, BandKey> = {
  "worship leader": "wl",
  singer: "vox",
  singers: "vox",
  vocalist: "vox",
  vocals: "vox",
  vox: "vox",
  drummer: "drums",
  drums: "drums",
  "electric guitarist": "eg",
  "electric guitar": "eg",
  eg: "eg",
  "acoustic guitarist": "ag",
  "acoustic guitar": "ag",
  ag: "ag",
  bassist: "bass",
  bass: "bass",
  keyboardist: "keys",
  keys: "keys",
  "synth player": "keys",
  synth: "keys",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** A date cell as YYYY-MM-DD: 2016-10-29, 29/10/2016 (day first), 29 Oct 2016, Oct 29, 2016 or an Excel day number. */
export function parseDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+r[1]!, +r[2]!, +r[3]!];
  else if ((r = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    [d, m, y] = [+r[1]!, +r[2]!, +r[3]!];
    if (m > 12 && d <= 12) [d, m] = [m, d]; // written month first
    if (y < 100) y += 2000;
  } else if ((r = v.match(/^(\d{1,2})[\s-]+([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{4})$/))) [d, m, y] = [+r[1]!, MONTHS.indexOf(r[2]!.toLowerCase()) + 1, +r[3]!];
  else if ((r = v.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})$/))) [m, d, y] = [MONTHS.indexOf(r[1]!.toLowerCase()) + 1, +r[2]!, +r[3]!];
  else if (/^\d{5}(\.\d+)?$/.test(v)) {
    // Excel counts days from 30 Dec 1899.
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86_400_000);
    [y, m, d] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  } else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const names = (cell: string | undefined) =>
  (cell ?? "")
    .split(/[,;\n]/)
    .map((n) => n.trim().replace(/\s+/g, " "))
    .filter(Boolean);

/** Which service a row is: from its Service and Ministry cells, else a Sunday is the EM Sunday Service. */
function service(date: string, serviceCell: string, ministryCell: string): { kind: string; name: string; ministry: TrackedMinistry } {
  const s = serviceCell.trim();
  const mc = ministryCell.trim().toLowerCase();
  const ministry: TrackedMinistry | null = /\bcm\b|chinese/i.test(s) || mc === "cm" ? "cm" : /\bem\b|english/i.test(s) || mc === "em" ? "em" : null;
  const sunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
  const pnp = /p\s*&\s*p|pnp|prayer/i.test(s);
  if (pnp) return ministry === "cm" ? { kind: "cm_pnp", name: "CM Prayer & Praise", ministry: "cm" } : { kind: "em_pnp", name: "EM Prayer & Praise", ministry: "em" };
  if ((!s && sunday) || /sunday/i.test(s))
    return ministry === "cm" ? { kind: "cm_sunday", name: "CM Sunday Service", ministry: "cm" } : { kind: "em_sunday", name: "EM Sunday Service", ministry: "em" };
  return { kind: "custom", name: s || "Worship Session", ministry: ministry ?? (mc === "any" ? "any" : "em") };
}

const isLink = (v: string) => {
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

/** What was read: the sessions, and the rows that couldn't be read (by line or row number). */
type Read = { sessions: ImportedSession[]; problems: string[] };

export function readSessionsCsv(text: string): Read {
  return readSessionsRows(parseCsv(text));
}

/** A workbook's sessions: from its "Database" sheet, else the first sheet that has them. */
export function readSessionsWorkbook(sheets: { name: string; rows: string[][] }[]): Read {
  const ordered = [...sheets].sort((a, b) => Number(b.name.trim().toLowerCase() === "database") - Number(a.name.trim().toLowerCase() === "database"));
  let first: Read | null = null;
  for (const s of ordered) {
    const r = readSessionsRows(s.rows);
    if (r.sessions.length) return r;
    first ??= r;
  }
  return first ?? { sessions: [], problems: ["The workbook has no sheets."] };
}

/** The sessions in a table of cells (header row anywhere near the top), and the rows it couldn't read (by line number). */
export function readSessionsRows(rows: string[][]): Read {
  const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");
  const headerAt = rows.findIndex((r) => r.map(norm).includes("date") && r.map(norm).includes("worship leader"));
  if (headerAt < 0) return { sessions: [], problems: ['There\'s no header row with "Date" and "Worship Leader" columns.'] };
  const header = rows[headerAt]!.map(norm);

  const col = (name: string) => header.indexOf(name);
  const band = header.flatMap((h, i) => (BAND_HEADERS[h] ? [{ i, key: BAND_HEADERS[h]! }] : []));
  const songCols = new Map<number, { title?: number; artist?: number; key?: number; lead?: number }>();
  const slot = (n: number) => songCols.get(n) ?? (songCols.set(n, {}), songCols.get(n)!);
  const links: number[] = [];
  header.forEach((h, i) => {
    let r: RegExpMatchArray | null;
    if ((r = h.match(/^song\s*(\d)/))) slot(+r[1]!).title = i;
    else if ((r = h.match(/^artist\s*(\d)/))) slot(+r[1]!).artist = i;
    else if ((r = h.match(/^key\s*(\d)/))) slot(+r[1]!).key = i;
    else if ((r = h.match(/^(?:wl|lead(?: vox)?)\s*(\d)?$/))) {
      // "WL" heads the lead column of the song whose columns follow it.
      const next = r[1] ? +r[1] : Number(header[i + 1]?.match(/^(?:artist|song)\s*(\d)/)?.[1]);
      if (next) slot(next).lead = i;
    } else if (/^link\s*\d/.test(h)) links.push(i);
  });
  if (!songCols.size) return { sessions: [], problems: ['There are no "Song 1", "Song 2", ... columns.'] };

  const sessions: ImportedSession[] = [];
  const problems: string[] = [];
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const cell = (i: number | undefined) => (i === undefined || i < 0 ? "" : (row[i] ?? "").trim());
    if (!row.some((c) => c.trim())) continue;
    const line = r + 1;
    const rawDate = cell(col("date"));
    const date = parseDate(rawDate);
    if (!date) {
      // Rows with nothing in them but formulas' leftovers have no date and no songs: skip quietly.
      if (rawDate || [...songCols.values()].some((c) => cell(c.title))) problems.push(`Line ${line}: couldn't read the date "${rawDate}".`);
      continue;
    }
    const svc = service(date, cell(col("service")), cell(col("ministry")));

    const people: Band = {};
    for (const { i, key } of band) for (const n of names(row[i])) if (!(people[key] ??= []).includes(n)) people[key]!.push(n);
    // The Singer column often lists the worship leader too.
    if (people.vox && people.wl) people.vox = people.vox.filter((n) => !people.wl!.includes(n));
    const ordered: Band = Object.fromEntries(BAND_COLUMNS.filter((c) => people[c.key]?.length).map((c) => [c.key, people[c.key]]));

    const songs: TrackedSong[] = [...songCols.entries()]
      .sort(([a], [b]) => a - b)
      .flatMap(([n, c]) => {
        const title = cell(c.title);
        if (!title) return [];
        return [{ title, artist: cell(c.artist), key: cell(c.key), lead: cell(c.lead), ...(n === 5 && isSunday(svc.kind) ? { closing: true } : {}) }];
      })
      .slice(0, 5);

    const notes: string[] = [];
    const urls: string[] = [];
    links.forEach((i, j) => {
      const v = cell(i);
      if (!v) return;
      if (isLink(v)) urls.push(v);
      else notes.push(`Link ${j + 1}: ${v}`); // e.g. "Closing Song - O Praise the name"
    });
    const comments = [cell(col("comments")), ...notes].filter(Boolean).join("\n");
    // Not a session: a date filled in ahead of time, or a note like "NO SERVICE" or "REKINDLE 2024"
    // in the Worship Leader column. A session has at least a song, a link or a comment.
    if (!songs.length && !urls.length && !comments) continue;
    // A week with no worship team (the livestream link is the service without one).
    if (/service\s+team\s+break/i.test(cell(col("worship leader")))) continue;

    sessions.push({ line, date, kind: svc.kind, serviceName: svc.name, ministry: svc.ministry, band: ordered, songs, links: urls.slice(0, 2), comments });
  }
  return { sessions, problems };
}
