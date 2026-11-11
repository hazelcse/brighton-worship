import "server-only";
import { inflateRawSync } from "node:zlib";

/**
 * Reads the cell values of an Excel workbook (.xlsx): each sheet's rows as text, numbers as
 * written (so dates are Excel day numbers). Enough for importing tables; formatting, formulas and
 * merged cells are ignored.
 */

/** The files in a zip (an .xlsx is a zip of XML files). */
function unzip(buf: Buffer): Map<string, Buffer> {
  // The end-of-central-directory record is in the last 64 KB (after an optional comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file isn't an Excel workbook (.xlsx).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("The workbook is damaged.");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, "&");

/** The text of a cell's or shared string's <t> runs (phonetic guides left out). */
const runs = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join("");

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/** "AB12" → column 27 (0-based). */
function column(ref: string): number {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)?.[0] ?? "A") n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export type Sheet = { name: string; rows: string[][] };

export function readXlsx(data: Buffer): Sheet[] {
  const files = unzip(data);
  const text = (path: string) => files.get(path)?.toString("utf8") ?? "";
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("That file isn't an Excel workbook (.xlsx).");

  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1]!));
  const targets = new Map(
    [...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target") ?? ""]),
  );

  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = unescape(attr(m[0], "name") ?? "");
    const target = targets.get(attr(m[0], "r:id")) ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const rows: string[][] = [];
    for (const r of text(path).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const index = Number(attr(r[1]!, "r") ?? rows.length + 1) - 1;
      const row: string[] = [];
      for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = c[1]!;
        const body = c[2] ?? "";
        const type = attr(tag, "t");
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const value = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? runs(body) : v !== undefined ? unescape(v) : "";
        const ref = attr(tag, "r");
        row[ref ? column(ref) : row.length] = value;
      }
      rows[index] = Array.from(row, (x) => x ?? "");
    }
    return { name, rows: Array.from(rows, (x) => x ?? []) };
  });
}
