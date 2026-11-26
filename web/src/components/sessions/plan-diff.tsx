"use client";

import { Fragment, type ReactNode } from "react";
import { FreeText, SlantWords } from "@/components/sessions/slant";
import { useCopyOnClick } from "@/components/sessions/copy-on-click";
import type { PlanCopy } from "@/components/sessions/plan-text";
import { lines } from "@/lib/seq-lines";
import { PART_ROLES, keyLabel, shortName, type PlanItem, type PlanLink, type PlanSection, type SeqStep } from "@/lib/session-plan";

/*
 * "Show changes": the session as a run sheet (like the simplified view), with what the last
 * publishing took out struck through in light red and what it put in highlighted in light green,
 * the way GitHub shows a change. Things are matched by id from one version to the next (a revision
 * starts as a copy of the published plan), so a song that moved is the same song.
 */

const DEL = "rounded-sm bg-red-100 px-0.5 text-red-900 line-through decoration-red-500 decoration-1";
const INS = "rounded-sm bg-green-100 px-0.5 text-green-900 no-underline";

function Del({ children }: { children: ReactNode }) {
  return <del className={DEL}>{children}</del>;
}
function Ins({ children }: { children: ReactNode }) {
  return <ins className={INS}>{children}</ins>;
}

/** The value as it is, or the old one struck out and the new one highlighted. Blank sides are left out. */
function Changed({ a, b }: { a: string | null | undefined; b: string | null | undefined }) {
  const was = a?.trim() ?? "";
  const now = b?.trim() ?? "";
  if (was === now) return <>{now}</>;
  return (
    <>
      {was && <Del>{was}</Del>}
      {was && now && " "}
      {now && <Ins>{now}</Ins>}
    </>
  );
}

type State = "same" | "added" | "removed";
type Row<T> = { state: State; a?: T; b?: T; moved?: boolean };

/**
 * The two lists merged in the new order, with anything taken out put back where it used to be.
 * `elsewhere` finds an item the old version had somewhere else (e.g. another section): it's kept,
 * not added, and marked as moved.
 */
function merge<T extends { id: string }>(before: T[], after: T[], gone: (id: string) => boolean, elsewhere?: (id: string) => T | undefined): Row<T>[] {
  const oldIdx = new Map(before.map((x, i) => [x.id, i]));
  const out: Row<T>[] = [];
  let i = 0;
  let last = -1;
  const flush = (upTo: number) => {
    for (; i < upTo; i++) if (gone(before[i].id)) out.push({ state: "removed", a: before[i] });
  };
  for (const b of after) {
    const j = oldIdx.get(b.id);
    if (j === undefined) {
      const a = elsewhere?.(b.id);
      out.push(a ? { state: "same", a, b, moved: true } : { state: "added", b });
      continue;
    }
    if (j >= i) flush(j);
    out.push({ state: "same", a: before[j], b, moved: j < last });
    last = Math.max(last, j);
  }
  flush(before.length);
  return out;
}

/** A whole block put in or taken out: tinted, with a bar down the left like a diff's lines. */
function blockClass(state: State) {
  if (state === "added") return "-mx-2 rounded-md border-l-4 border-green-500 bg-green-50 px-2 py-1";
  if (state === "removed") return "-mx-2 rounded-md border-l-4 border-red-400 bg-red-50 px-2 py-1 text-red-900 line-through decoration-red-500 decoration-1";
  return "";
}

/** Comments: Gmail's grey, as in the simplified view. */
const NOTE = "text-[#666666]";

/**
 * A song's notes: a bold "Notes:", then each line as in the simplified view ("• " lines as dot
 * points), lines put in highlighted and lines taken out struck through under them. plain: nothing marked.
 */
function Notes({ a, b, plain = false, className = "" }: { a: string; b: string; plain?: boolean; className?: string }) {
  const words = (t: string) => t.trim().replace(/^(?:•|-)\s+/, "");
  const rows = (t: string) => t.trim().split("\n").filter((x) => x.trim());
  const was = new Set(rows(a).map(words));
  const now = new Set(rows(b).map(words));
  const shown = [
    ...rows(b).map((t) => ({ t, state: plain || was.has(words(t)) ? "same" : "added" })),
    ...rows(a).filter((t) => !now.has(words(t))).map((t) => ({ t, state: "removed" })),
  ];
  return (
    <div className={`pl-6 ${className}`}>
      <p className="font-bold">Notes:</p>
      {shown.map((r, i) => {
        const w = words(r.t);
        const body = r.state === "added" ? <Ins>{w}</Ins> : r.state === "removed" ? <Del>{w}</Del> : w;
        return /^\s*(?:•|-)\s+/.test(r.t) ? (
          <ul key={i} className="list-disc pl-5">
            <li>{body}</li>
          </ul>
        ) : (
          <p key={i}>{body}</p>
        );
      })}
    </div>
  );
}

const partLabel = (role: string) => PART_ROLES.find((p) => p.role === role)?.label ?? role;

/** A comment: grey and slanted, its <> dropped (as in the simplified view). */
const note = (t: string) => (
  <span className={NOTE}>
    <SlantWords text={t} />
  </span>
);

/** "V1 x2 (High)", as the simplified view writes a step's element (or its free text). */
const core = (s: SeqStep) => `${s.free ? s.name : shortName(s.name)}${s.repeat > 1 ? ` x${s.repeat}` : ""}${s.tags.length ? ` (${s.tags.join(", ")})` : ""}`;
/** Free text's <notes> grey and slanted, as in the simplified view; an element as it reads. */
const coreView = (t: string, free: boolean | undefined) => (free ? <FreeText text={t} noteClass={NOTE} /> : t);

/** As it is, or the old one struck out and the new one highlighted, each drawn by `show`. Blank sides are left out. */
function Diffed({ a, b, show }: { a: string | undefined; b: string | undefined; show: (t: string) => ReactNode }) {
  const was = a?.trim() ?? "";
  const now = b?.trim() ?? "";
  if (was === now) return <>{now && show(now)}</>;
  return (
    <>
      {was && <Del>{show(was)}</Del>}
      {was && now && " "}
      {now && <Ins>{show(now)}</Ins>}
    </>
  );
}

const partsText = (s: SeqStep) => ((s.parts ?? []).length > 0 ? <span> [{s.parts!.map(partLabel).join(", ")}]</span> : null);

/** A step put in or taken out, whole: comment before, element, instruments, comment after. */
function WholeStep({ s }: { s: SeqStep }) {
  return (
    <>
      {s.before && <>{note(s.before)} </>}
      {coreView(core(s), s.free)}
      {partsText(s)}
      {s.comment && <> {note(s.comment)}</>}
    </>
  );
}

function Step({ row }: { row: Row<SeqStep> }) {
  const a = row.a;
  const b = row.b;
  if (row.state === "added") return <Ins><WholeStep s={b!} /></Ins>;
  if (row.state === "removed") return <Del><WholeStep s={a!} /></Del>;
  const was = new Set(a!.parts ?? []);
  const now = new Set(b!.parts ?? []);
  const parts = PART_ROLES.map((p) => p.role).filter((r) => was.has(r) || now.has(r));
  const partsChanged = parts.some((r) => was.has(r) !== now.has(r));
  return (
    <>
      {(a!.before || b!.before) && (
        <>
          <Diffed a={a!.before} b={b!.before} show={note} />{" "}
        </>
      )}
      <Diffed a={core(a!)} b={core(b!)} show={(t) => coreView(t, b!.free)} />
      {row.moved && <span className="text-[10px] font-semibold uppercase text-amber-700"> moved</span>}
      {/* Instruments only when they changed: the ones that stayed in plain text. */}
      {partsChanged && (
        <span>
          {" ["}
          {parts.map((r, i) => (
            <Fragment key={r}>
              {i > 0 && ", "}
              {was.has(r) && now.has(r) ? partLabel(r) : was.has(r) ? <Del>{partLabel(r)}</Del> : <Ins>{partLabel(r)}</Ins>}
            </Fragment>
          ))}
          {"]"}
        </span>
      )}
      {/* The space sits outside the comment, so it always shows between the element and it. */}
      {(a!.comment || b!.comment) && (
        <>
          {" "}
          <Diffed a={a!.comment} b={b!.comment} show={note} />
        </>
      )}
    </>
  );
}

/** The sequence in the simplified view's lines (|| V1 | C |, then | B | C ||), steps taken out in their old places. */
function Sequence({ a, b, className = "" }: { a: SeqStep[]; b: SeqStep[]; className?: string }) {
  const after = new Set(b.map((s) => s.id));
  const rows = merge(a, b, (id) => !after.has(id));
  if (!rows.length) return null;
  const byId = new Map(rows.map((r) => [(r.b ?? r.a)!.id, r]));
  const ls = lines(rows.map((r) => (r.b ?? r.a)!));
  return (
    <div className={`pl-6 ${className}`}>
      {ls.map((l, li) => (
        <p key={l[0].id} className="break-words">
          {li === 0 ? "|| " : "| "}
          {l.map((s, i) => (
            <Fragment key={s.id}>
              {i > 0 && " "}
              <Step row={byId.get(s.id)!} />
              {li === ls.length - 1 && i === l.length - 1 ? " ||" : " |"}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

function Links({ a, b }: { a: PlanLink[]; b: PlanLink[] }) {
  const was = new Map(a.filter((l) => l.url).map((l) => [l.url, l]));
  const now = new Map(b.filter((l) => l.url).map((l) => [l.url, l]));
  const rows: { url: string; a?: PlanLink; b?: PlanLink }[] = [
    ...[...now.values()].map((l) => ({ url: l.url, a: was.get(l.url), b: l })),
    ...[...was.values()].filter((l) => !now.has(l.url)).map((l) => ({ url: l.url, a: l })),
  ];
  if (!rows.length) return null;
  return (
    <ul className="pl-6">
      {rows.map((r) => {
        const link = (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="break-all text-[#1155cc] underline">
            {r.url}
          </a>
        );
        if (!r.a) return <li key={r.url}><Ins>{r.b!.label && `${r.b!.label}: `}{link}</Ins></li>;
        if (!r.b) return <li key={r.url}><Del>{r.a.label && `${r.a.label}: `}{r.url}</Del></li>;
        return (
          <li key={r.url}>
            {(r.a.label || r.b.label) && (
              <>
                <Changed a={r.a.label} b={r.b.label} />
                {": "}
              </>
            )}
            {link}
          </li>
        );
      })}
    </ul>
  );
}

/** A song: its line (number, title, key, tempo, lead), links, notes when they changed, and its sequence. */
function Song({ row, n, leadName }: { row: Row<PlanItem>; n: number; leadName: (id: string | null) => string | null }) {
  const a = row.state === "added" ? null : row.a!;
  const b = row.state === "removed" ? null : row.b!;
  const one = (b ?? a)!;
  const title = (i: PlanItem | null) => (i ? i.title.trim() || "Song to be chosen" : null);
  const key = (i: PlanItem | null) => (i ? keyLabel(i.key, i.transpose_to) : null);
  const bpm = (i: PlanItem | null) => (i?.bpm ? `${i.bpm}bpm` : null);
  const lead = (i: PlanItem | null) => (i?.lead_id ? (leadName(i.lead_id) ?? "Someone") : null);
  const whole = row.state !== "same";
  const hasLinks = [...(a?.links ?? []), ...(b?.links ?? [])].some((l) => l.url);
  const hasSequence = (a?.sequence ?? []).length > 0 || (b?.sequence ?? []).length > 0;
  // A whole song in or out is tinted as one block; a kept one shows each change in place.
  const field = (f: (i: PlanItem | null) => string | null) => (whole ? f(one) : null);
  return (
    <li className={blockClass(row.state)}>
      <p className="font-bold">
        {n}.{" "}
        {whole ? title(one) : <Changed a={title(a)} b={title(b)} />}
        {(whole ? field(key) : key(a) || key(b)) && (
          <>
            {" ("}
            {whole ? field(key) : <Changed a={key(a)} b={key(b)} />}
            {")"}
          </>
        )}
        {(whole ? field(bpm) : bpm(a) || bpm(b)) && (
          <>
            {" - "}
            {whole ? field(bpm) : <Changed a={bpm(a)} b={bpm(b)} />}
          </>
        )}
        {(whole ? field(lead) : lead(a) || lead(b)) && (
          <>
            {" ["}
            {whole ? field(lead) : <Changed a={lead(a)} b={lead(b)} />}
            {"]"}
          </>
        )}
        {row.moved && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800 no-underline">Moved</span>}
      </p>
      <Links a={a?.links ?? []} b={b?.links ?? []} />
      {/* A little room (8px) between the sequence and the links above it and the notes under it, as in the simplified view. */}
      <Sequence a={a?.sequence ?? []} b={b?.sequence ?? []} className={hasLinks ? "mt-2" : ""} />
      {/* Notes under the sequence, as in the simplified view: a bold "Notes:", then line by line. */}
      {whole ? one.notes.trim() && <Notes a="" b={one.notes} plain className={hasSequence ? "mt-2" : ""} /> : (a?.notes.trim() || b?.notes.trim()) && <Notes a={a?.notes ?? ""} b={b?.notes ?? ""} className={hasSequence ? "mt-2" : ""} />}
    </li>
  );
}

function Transition({ row }: { row: Row<PlanItem> }) {
  const a = row.a;
  const b = row.b;
  return (
    <li className={blockClass(row.state)}>
      {"// Transition"}
      {row.state === "same" ? (
        (a!.notes || b!.notes) && (
          <>
            {": "}
            <Changed a={a!.notes} b={b!.notes} />
          </>
        )
      ) : (
        (row.b ?? row.a)!.notes && `: ${(row.b ?? row.a)!.notes}`
      )}
    </li>
  );
}

export function PlanDiff({
  before,
  after,
  linksBefore,
  linksAfter,
  leadName,
  copy,
}: {
  before: PlanSection[];
  after: PlanSection[];
  linksBefore: PlanLink[];
  linksAfter: PlanLink[];
  leadName: (id: string | null) => string | null;
  /** Worship leaders, once published: clicking the box copies this (see useCopyOnClick). */
  copy?: () => PlanCopy;
}) {
  const copier = useCopyOnClick(copy, "the edits");
  const oldItems = new Map(before.flatMap((s) => s.items).map((i) => [i.id, i]));
  const newItems = new Set(after.flatMap((s) => s.items).map((i) => i.id));
  const newSections = new Set(after.map((s) => s.id));
  const sections = merge(before, after, (id) => !newSections.has(id));
  const unchanged = JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(linksBefore) === JSON.stringify(linksAfter);

  // Songs are numbered as each version numbers them: kept and new ones by the new plan, ones taken out by the old.
  const numberIn = (plan: PlanSection[]) => {
    const out = new Map<string, number>();
    let n = 0;
    for (const s of plan) for (const i of s.items) if (i.kind === "song") out.set(i.id, ++n);
    return out;
  };
  const oldN = numberIn(before);
  const newN = numberIn(after);

  return (
    <>
    <article
      aria-label="Changes"
      className={`space-y-[1.15em] rounded-xl border border-border bg-surface px-5 py-4 text-[13px] leading-[1.4] text-[#222222] [overflow-wrap:anywhere] sm:p-5 sm:text-[14px] ${copier.className}`}
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      {...copier.props}
    >
      {copier.badge}
      {unchanged && <p className="text-muted">Nothing in the plan changed.</p>}
      {(linksBefore.length > 0 || linksAfter.length > 0) && JSON.stringify(linksBefore) !== JSON.stringify(linksAfter) && (
        <section>
          <h2 className="font-bold underline">Session links</h2>
          <Links a={linksBefore} b={linksAfter} />
        </section>
      )}
      {sections.map((sec) => {
        const a = sec.a;
        const b = sec.b;
        const rows: Row<PlanItem>[] =
          sec.state === "removed"
            ? a!.items.filter((i) => !newItems.has(i.id)).map((i) => ({ state: "removed", a: i }))
            : merge(a?.items ?? [], b!.items, (id) => !newItems.has(id), (id) => oldItems.get(id));
        if (!rows.length && sec.state === "same") return null;
        return (
          <section key={(b ?? a)!.id} className="space-y-[1.15em]">
            <h2 className="font-bold underline">
              {sec.state === "same" ? <Changed a={a!.name} b={b!.name} /> : sec.state === "added" ? <Ins>{b!.name}</Ins> : <Del>{a!.name}</Del>}
            </h2>
            <ol className="space-y-[1.15em]">
              {rows.map((r) => {
                const item = (r.b ?? r.a)!;
                return item.kind === "transition" ? (
                  <Transition key={item.id} row={r} />
                ) : (
                  <Song key={item.id} row={r} n={(r.state === "removed" ? oldN : newN).get(item.id) ?? 0} leadName={leadName} />
                );
              })}
            </ol>
          </section>
        );
      })}
    </article>
    {copier.hint}
    </>
  );
}
