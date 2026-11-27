import { label, lines } from "@/lib/seq-lines";
import { noteBlocks } from "@/lib/notes";
import { noteParts, unbracket } from "@/lib/seq-text";
import { isLongComment, keyLabel, looseParts, type PlanItem, type PlanLink, type PlanSection, type SeqStep } from "@/lib/session-plan";

/*
 * The simplified view as text, for worship leaders to copy into a message or email: the published
 * run sheet (sections, numbered songs with key, tempo and lead, links, the sequence in the same lines,
 * notes, transitions). "Copy new edits" is the same run sheet with what the last publishing put in or
 * changed in red, and nothing of what it took out. Each comes as HTML and as plain text: pasted
 * somewhere that takes formatting, section names are bold and underlined, song lines bold, a song's
 * links, sequence and notes indented, links stay links, and new parts are red. Plain text has no
 * colour or bold, and indents with spaces.
 */

type Names = (id: string | null) => string | null;

/** A run of text on a line; red: new since the last publishing; note: a comment (grey italic). */
type Seg = { t: string; red?: boolean; note?: boolean };
/** One line of the copy. bullet: a point of a dot list (the song's notes); lines in a row make one list. */
type Line = { segs: Seg[]; style?: "bold" | "section"; indent?: boolean; link?: PlanLink; bullet?: boolean };
export type PlanCopy = { text: string; html: string };

const line = (t: string, more: Omit<Line, "segs"> & { red?: boolean } = {}): Line => {
  const { red, ...rest } = more;
  return { segs: [{ t, red }], ...rest };
};
const textOf = (l: Line) => l.segs.map((s) => s.t).join("");

/** Gmail's default "Normal" text: Sans Serif (arial) at size small (13px, about 10pt). */
const FONT = "font-family:arial,sans-serif;font-size:small";
/** Gmail's own red (its text colour palette). */
const RED = "#ff0000";
/** Comments: Gmail's dark grey, in italics, as the simplified view mutes and slants them. */
const NOTE = "#666666";

const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Runs of text, neighbours that look the same joined into one. */
function segsHtml(segs: Seg[]): string {
  const runs: Seg[] = [];
  for (const s of segs) {
    if (!s.t) continue;
    const last = runs.at(-1);
    if (last && Boolean(last.red) === Boolean(s.red) && Boolean(last.note) === Boolean(s.note)) last.t += s.t;
    else runs.push({ ...s });
  }
  return runs
    .map((s) => {
      const t = escape(s.t);
      // A new comment stays red (new matters more), still in italics.
      if (s.note) return `<i style="color:${s.red ? RED : NOTE}">${t}</i>`;
      return s.red ? `<span style="color:${RED}">${t}</span>` : t;
    })
    .join("");
}

/** A comment's words without the <> it was typed in. */
const commentText = (text: string) => noteParts(text).map((p) => (p.note ? unbracket(p.text) : p.text)).join("");
/** A comment, as one note run. */
const comment = (text: string, red: boolean): Seg => ({ t: commentText(text), red, note: true });
/** Free text: its <notes> as notes (brackets gone), the rest as it is. */
const freeSegs = (text: string, red: boolean): Seg[] => noteParts(text).map((p) => (p.note ? { t: unbracket(p.text), red, note: true } : { t: p.text, red }));

/** A line's words; a link line's address as a link (only web addresses; anything else stays text). */
function bodyHtml(l: Line): string {
  const red = l.segs.some((s) => s.red);
  if (!l.link || !/^https?:\/\//i.test(l.link.url)) return segsHtml(l.segs);
  return segsHtml(l.link.label ? [{ t: `${l.link.label}: `, red }] : []) + `<a href="${escape(l.link.url)}"${red ? ` style="color:${RED}"` : ""}>${escape(l.link.url)}</a>`;
}

function lineHtml(l: Line): string {
  let body = bodyHtml(l);
  if (l.style === "section") body = `<b><u>${body}</u></b>`;
  else if (l.style === "bold") body = `<b>${body}</b>`;
  return `<p style="${FONT};margin:0${l.indent ? ";margin-left:24px" : ""}">${body}</p>`;
}

/** A block's lines as HTML, bullet points in runs as one <ul>. */
function blockHtml(ls: Line[]): string {
  let out = "";
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (!l.bullet) {
      out += lineHtml(l);
      continue;
    }
    let items = "";
    for (; i < ls.length && ls[i].bullet; i++) items += `<li style="${FONT}">${bodyHtml(ls[i])}</li>`;
    i--;
    out += `<ul style="${FONT};margin:0;padding-left:${l.indent ? 48 : 24}px">${items}</ul>`;
  }
  return out;
}

/** Blocks with a blank line between them; a block's lines one under another. */
function render(blocks: Line[][]): PlanCopy {
  const text = blocks.map((b) => b.map((l) => `${l.indent ? "    " : ""}${l.bullet ? "• " : ""}${textOf(l)}`).join("\n")).join("\n\n");
  // Gmail's own "Normal" text, so a paste into an email matches what's typed around it. Each line
  // and list item carries it too, as some editors drop the wrapper's.
  const html = `<div style="${FONT}">${blocks.map(blockHtml).join(`<p style="${FONT};margin:0"><br></p>`)}</div>`;
  return { text, html };
}

/** "EM Sunday Service, Sun, 30 Nov 2026". */
function heading(service: string, date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const day = Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return `${service}, ${day}`;
}

/** What the last publishing replaced, to tell what's new; null: nothing is marked. */
type Before = { items: Map<string, PlanItem>; sections: Map<string, PlanSection>; links: Map<string, PlanLink> } | null;

const linkLine = (l: PlanLink, red: boolean, indent = false): Line => line(`${l.label ? `${l.label}: ` : ""}${l.url}`, { link: l, indent, red });
/** New, or its name changed. */
const linkIsNew = (l: PlanLink, was: Map<string, PlanLink> | null) => Boolean(was && (!was.has(l.url) || was.get(l.url)!.label !== l.label));

/** How a step reads in the copy (its instruments aren't shown, so they don't count). */
const stepSig = (s: SeqStep) => JSON.stringify([s.before ?? "", s.name, s.free ?? false, s.repeat, s.tags, s.comment ?? ""]);

/**
 * The sequence in the simplified view's lines: || Intro x2 | V1 | C | ... ||. `old`: the song's
 * steps as last published (null: nothing marked); a step not there, or that reads differently now, is red.
 */
function sequenceLines(all: SeqStep[], old: SeqStep[] | null): Seg[][] {
  const was = old ? new Map(old.map((s) => [s.id, stepSig(s)])) : null;
  const isNew = (s: SeqStep) => Boolean(was && was.get(s.id) !== stepSig(s));
  const { head, body, tail } = looseParts(all);
  const ls = lines(body);
  return ls.map((steps, li) => {
    const first = li === 0;
    const last = li === ls.length - 1;
    const long = steps.length === 1 && isLongComment(steps[0].comment) ? steps[0].comment : null;
    const out: Seg[] = [];
    if (first && head) out.push(comment(head.name, isNew(head)), { t: " " });
    steps.forEach((s, i) => {
      if (i > 0) out.push({ t: " " });
      if (i === 0) out.push({ t: first ? "|| " : "| " });
      const red = isNew(s);
      // Comments before and after the element in grey italics; the element (or free text) as it reads.
      if (s.before) out.push(comment(s.before, red), { t: " ", red });
      if (s.free) out.push(...freeSegs(label(s), red));
      else out.push({ t: label(s), red });
      let t = "";
      if (s.repeat > 1) t += ` x${s.repeat}`;
      if (s.tags.length) t += ` (${s.tags.join(", ")})`;
      out.push({ t, red });
      const after = long ?? (s.comment && !isLongComment(s.comment) ? s.comment : null);
      if (after) out.push({ t: " ", red }, comment(after, red));
      out.push({ t: last && i === steps.length - 1 ? " ||" : " |" });
    });
    if (last && tail) out.push({ t: " " }, comment(tail.name, isNew(tail)));
    return out;
  });
}

/** A song's title line, "2. Worthy (E→G) - 72bpm [Anna]", each part red if it changed. */
function titleLine(item: PlanItem, n: number, names: Names, was: PlanItem | null, marking: boolean): Seg[] {
  const changed = (a: unknown, b: unknown) => marking && JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  const key = keyLabel(item.key, item.transpose_to);
  const lead = names(item.lead_id);
  const out: Seg[] = [{ t: `${n}. ` }, { t: item.title || "Song to be chosen", red: changed(was?.title.trim(), item.title.trim()) }];
  if (key) out.push({ t: " (" }, { t: key, red: changed(was && keyLabel(was.key, was.transpose_to), key) }, { t: ")" });
  if (item.bpm) out.push({ t: " - " }, { t: `${item.bpm}bpm`, red: changed(was?.bpm, item.bpm) });
  if (lead) out.push({ t: " [" }, { t: lead, red: changed(was?.lead_id, item.lead_id) }, { t: "]" });
  return out;
}

/** A song: title line, links, sequence, then a bold "Notes:" and the notes under it ("• " lines as bullets). */
function songText(item: PlanItem, n: number, names: Names, before: Before): Line[] {
  const was = before?.items.get(item.id) ?? null;
  // A whole new song is red throughout; a kept one marks what changed.
  const all = Boolean(before && !was);
  const mark = (red: boolean) => all || red;
  const out: Line[] = [{ segs: titleLine(item, n, names, was, Boolean(before)).map((s) => ({ ...s, red: mark(Boolean(s.red)) })), style: "bold" }];
  const oldLinks = was ? new Map((was.links ?? []).filter((l) => l.url).map((l) => [l.url, l])) : null;
  for (const l of (item.links ?? []).filter((l) => l.url)) out.push(linkLine(l, all || linkIsNew(l, oldLinks), true));
  for (const segs of sequenceLines(item.sequence ?? [], before ? (was?.sequence ?? []) : null)) out.push({ segs: all ? segs.map((s) => ({ ...s, red: true })) : segs, indent: true });
  if (item.notes.trim()) {
    const oldNotes = new Set((was?.notes ?? "").split("\n").map((x) => x.trim().replace(/^(?:•|-)\s+/, "")));
    const isNew = (t: string) => Boolean(before) && (all || !oldNotes.has(t.trim().replace(/^(?:•|-)\s+/, "")));
    out.push(line("Notes:", { style: "bold", indent: true, red: all }));
    for (const b of noteBlocks(item.notes)) {
      if (b.kind === "list") out.push(...b.items.map((t) => line(t, { indent: true, bullet: true, red: isNew(t) })));
      else out.push(...b.text.split("\n").map((t) => line(t, { indent: true, red: isNew(t) })));
    }
  }
  return out;
}

function transitionText(item: PlanItem, before: Before): Line {
  const was = before?.items.get(item.id);
  const out: Seg[] = [{ t: "// Transition", red: Boolean(before && !was) }];
  if (item.notes) out.push({ t: ": ", red: Boolean(before && !was) }, { t: item.notes, red: Boolean(before && (was?.notes ?? "") !== item.notes) });
  return { segs: out };
}

function songNumbers(plan: PlanSection[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const s of plan) for (const i of s.items) if (i.kind === "song") out.set(i.id, ++n);
  return out;
}

/** The run sheet; with `before`, what's new since it is red and what it had that's gone is left out. */
function runSheet(title: string, plan: PlanSection[], links: PlanLink[], names: Names, before: Before): PlanCopy {
  const nums = songNumbers(plan);
  const blocks: Line[][] = [[line(title, { style: "bold" })]];
  const ls = links.filter((l) => l.url);
  if (ls.length) blocks.push([line("Session links", { style: "section" }), ...ls.map((l) => linkLine(l, linkIsNew(l, before?.links ?? null)))]);
  for (const sec of plan) {
    if (!sec.items.length) continue;
    const old = before?.sections.get(sec.id);
    blocks.push([line(sec.name, { style: "section", red: Boolean(before && (!old || old.name !== sec.name)) })]);
    for (const item of sec.items) blocks.push(item.kind === "transition" ? [transitionText(item, before)] : songText(item, nums.get(item.id) ?? 0, names, before));
  }
  return render(blocks);
}

/** The whole published plan, as the simplified view shows it. */
export function simplePlanText({ service, date, plan, links, names }: { service: string; date: string; plan: PlanSection[]; links: PlanLink[]; names: Names }): PlanCopy {
  return runSheet(heading(service, date), plan, links, names, null);
}

/**
 * The whole published plan again, with what the last publishing put in or changed in red (what Show
 * changes has in green): new songs, transitions and session links throughout; in a kept song, each
 * changed part of its title line, new links, new or changed sequence steps and new note lines.
 * Nothing it took out is shown.
 */
export function newEditsText({
  service,
  date,
  before,
  after,
  linksBefore,
  linksAfter,
  names,
}: {
  service: string;
  date: string;
  before: PlanSection[];
  after: PlanSection[];
  linksBefore: PlanLink[];
  linksAfter: PlanLink[];
  names: Names;
}): PlanCopy {
  return runSheet(`${heading(service, date)} (updated)`, after, linksAfter, names, {
    items: new Map(before.flatMap((s) => s.items).map((i) => [i.id, i])),
    sections: new Map(before.map((s) => [s.id, s])),
    links: new Map(linksBefore.filter((l) => l.url).map((l) => [l.url, l])),
  });
}
