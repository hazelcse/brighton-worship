"use client";

import { Fragment, type ReactNode } from "react";
import { SlantWords } from "@/components/sessions/slant";
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

const partLabel = (role: string) => PART_ROLES.find((p) => p.role === role)?.label ?? role;

/** "V1 x2 (High)", as the simplified view writes a step. */
const stepText = (s: SeqStep) =>
  `${s.before ? `${s.before} ` : ""}${s.free ? s.name : shortName(s.name)}${s.repeat > 1 ? ` x${s.repeat}` : ""}${s.tags.length ? ` (${s.tags.join(", ")})` : ""}`;

function Step({ row }: { row: Row<SeqStep> }) {
  const a = row.a;
  const b = row.b;
  if (row.state === "added") {
    return (
      <Ins>
        {stepText(b!)}
        {(b!.parts ?? []).length > 0 && <span className="text-xs"> [{b!.parts!.map(partLabel).join(", ")}]</span>}
        {b!.comment && <span className="text-xs"> <SlantWords text={b!.comment} /></span>}
      </Ins>
    );
  }
  if (row.state === "removed") {
    return (
      <Del>
        {stepText(a!)}
        {(a!.parts ?? []).length > 0 && <span className="text-xs"> [{a!.parts!.map(partLabel).join(", ")}]</span>}
        {a!.comment && <span className="text-xs"> <SlantWords text={a!.comment} /></span>}
      </Del>
    );
  }
  const was = new Set(a!.parts ?? []);
  const now = new Set(b!.parts ?? []);
  const parts = PART_ROLES.map((p) => p.role).filter((r) => was.has(r) || now.has(r));
  const partsChanged = parts.some((r) => was.has(r) !== now.has(r));
  return (
    <>
      <Changed a={stepText(a!)} b={stepText(b!)} />
      {row.moved && <span className="text-[10px] font-semibold uppercase text-amber-700"> moved</span>}
      {/* Instruments only when they changed: the ones that stayed in plain text. */}
      {partsChanged && (
        <span className="text-xs">
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
      {(a!.comment || b!.comment) && (
        <span className="slant inline-block text-xs text-muted">
          {" "}
          <Changed a={a!.comment} b={b!.comment} />
        </span>
      )}
    </>
  );
}

function Sequence({ a, b }: { a: SeqStep[]; b: SeqStep[] }) {
  const after = new Set(b.map((s) => s.id));
  const rows = merge(a, b, (id) => !after.has(id));
  if (!rows.length) return null;
  return (
    <p className="break-words pl-4 leading-7">
      <span className="text-muted">|| </span>
      {rows.map((r, i) => (
        <Fragment key={(r.b ?? r.a)!.id}>
          <Step row={r} />
          <span className="text-muted">{i === rows.length - 1 ? " ||" : " | "}</span>
        </Fragment>
      ))}
    </p>
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
    <ul className="space-y-0.5 pl-4 leading-6">
      {rows.map((r) => {
        const link = (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="break-all text-blue-600 underline underline-offset-2 hover:text-blue-800">
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
  // A whole song in or out is tinted as one block; a kept one shows each change in place.
  const field = (f: (i: PlanItem | null) => string | null) => (whole ? f(one) : null);
  return (
    <li className={`space-y-1 ${blockClass(row.state)}`}>
      <p className="font-semibold">
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
      <Sequence a={a?.sequence ?? []} b={b?.sequence ?? []} />
      {/* Notes under the sequence, as in the simplified view. */}
      {whole
        ? one.notes.trim() && <p className="whitespace-pre-line pl-4 text-xs">Notes: {one.notes}</p>
        : (a?.notes.trim() || b?.notes.trim()) && (
            <p className="whitespace-pre-line pl-4 text-xs">
              <span className="text-muted">Notes: </span>
              <Changed a={a?.notes} b={b?.notes} />
            </p>
          )}
    </li>
  );
}

function Transition({ row }: { row: Row<PlanItem> }) {
  const a = row.a;
  const b = row.b;
  return (
    <li className={`italic text-foreground/80 ${blockClass(row.state)}`}>
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
  caption,
}: {
  before: PlanSection[];
  after: PlanSection[];
  linksBefore: PlanLink[];
  linksAfter: PlanLink[];
  leadName: (id: string | null) => string | null;
  /** What's being compared, e.g. "Changes published by Anna on 3 Nov, 14:20". */
  caption: string;
}) {
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
    <article aria-label="Changes" className="space-y-6 rounded-xl border border-border bg-surface p-4 text-sm sm:p-5" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      <p className="text-xs text-muted">{caption}</p>
      {unchanged && <p className="text-muted">Nothing in the plan changed.</p>}
      {(linksBefore.length > 0 || linksAfter.length > 0) && JSON.stringify(linksBefore) !== JSON.stringify(linksAfter) && (
        <section className="space-y-1">
          <h2 className="text-base font-bold underline underline-offset-4">Session links</h2>
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
          <section key={(b ?? a)!.id} className="space-y-3">
            <h2 className="text-base font-bold underline underline-offset-4">
              {sec.state === "same" ? <Changed a={a!.name} b={b!.name} /> : sec.state === "added" ? <Ins>{b!.name}</Ins> : <Del>{a!.name}</Del>}
            </h2>
            <ol className="space-y-4">
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
  );
}
