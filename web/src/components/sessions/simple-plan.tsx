"use client";

import { Fragment } from "react";
import { isLongComment, keyLabel, partInfo, partTint, shortName, type PlanItem, type PlanSection, type SeqStep } from "@/lib/session-plan";

const isChorus = (s: SeqStep | undefined) => Boolean(s && /^chorus\b/i.test(s.name.trim()));

/** How much room a step takes on a line, roughly in characters (with its " | "). A long comment has a line of its own. */
const width = (s: SeqStep) =>
  shortName(s.name).length +
  (s.repeat > 1 ? 3 : 0) +
  (s.tags.length ? s.tags.join(", ").length + 3 : 0) +
  (s.comment && !isLongComment(s.comment) ? s.comment.length + 1 : 0) +
  3;

/**
 * The sequence split into lines. A step with a long comment has a line of its own (the comment goes
 * under it); the steps in between are evened out into lines (see balanced).
 */
function lines(steps: SeqStep[]): SeqStep[][] {
  const out: SeqStep[][] = [];
  let run: SeqStep[] = [];
  const flush = () => {
    if (run.length) out.push(...balanced(run));
    run = [];
  };
  for (const s of steps) {
    if (isLongComment(s.comment)) {
      flush();
      out.push([s]);
    } else run.push(s);
  }
  flush();
  return out;
}

/**
 * Steps split into lines of about the same length (the last can be shorter), about four
 * steps or 32 characters each. Lines prefer to end on a chorus that's followed by something new
 * (a verse, the bridge), so each line reads as one pass of the song.
 */
function balanced(steps: SeqStep[]): SeqStep[][] {
  const n = steps.length;
  if (n <= 3) return [steps];
  const w = steps.map(width);
  const total = w.reduce((a, b) => a + b, 0);
  const k = Math.min(n, Math.max(Math.ceil(n / 5), Math.ceil(total / 32)));
  if (k <= 1) return [steps];
  const avg = total / k;
  const sum = (a: number, b: number) => w.slice(a, b).reduce((x, y) => x + y, 0);
  // A break that doesn't come after a chorus costs about a third of a line's length, squared.
  const offBeat = (avg * 0.35) ** 2;
  const lineCost = (a: number, b: number, last: boolean) => {
    const d = sum(a, b) - avg;
    return last && d < 0 ? d * d * 0.2 : d * d;
  };
  // best[j][i]: cheapest way to put the first i steps on j lines; from[j][i]: where line j starts.
  const best = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(Infinity));
  const from = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(0));
  best[0][0] = 0;
  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      for (let a = j - 1; a < i; a++) {
        if (best[j - 1][a] === Infinity) continue;
        const brk = a > 0 && !(isChorus(steps[a - 1]) && !isChorus(steps[a])) ? offBeat : 0;
        const c = best[j - 1][a] + brk + lineCost(a, i, j === k);
        if (c < best[j][i]) {
          best[j][i] = c;
          from[j][i] = a;
        }
      }
    }
  }
  const out: SeqStep[][] = [];
  for (let j = k, i = n; j > 0; j--) {
    const a = from[j][i];
    out.unshift(steps.slice(a, i));
    i = a;
  }
  return out;
}

/**
 * One line of a sequence: || Intro x2 | V1 | C |, with the viewer's instrument picked out. Each step
 * keeps its closing bar with it, so a line that wraps on a narrow screen still ends in |. A comment
 * sits beside its step; a step with a long one starts a line of its own (see lines), with no bar
 * after it, and the comment wraps onto the lines under it.
 */
function SeqLine({ steps, first, last, highlight }: { steps: SeqStep[]; first: boolean; last: boolean; highlight: string | null }) {
  const mine = highlight ? partInfo(highlight) : undefined;
  // A step with a long comment is on a line of its own: "| Chorus" with no bar after it, then the
  // comment, wrapping (ending in || if it's the song's last step).
  const longComment = steps.length === 1 && isLongComment(steps[0].comment) ? steps[0].comment : null;
  return (
    <p className="break-words leading-7">
      {steps.map((s, i) => {
        const featured = mine && s.parts?.includes(mine.role);
        const label = (
          <>
            {shortName(s.name)}
            {s.repeat > 1 && <span className="font-semibold"> x{s.repeat}</span>}
            {s.tags.length > 0 && <span className={featured ? "" : "text-muted"}> ({s.tags.join(", ")})</span>}
          </>
        );
        const closing = last && i === steps.length - 1 ? "||" : "|";
        return (
          <Fragment key={s.id}>
            {i > 0 && " "}
            {/* The step, its instruments and a short comment on one line, never split. */}
            <span className="whitespace-nowrap">
              {i === 0 && <span className="text-muted">{first ? "|| " : "| "}</span>}
              {featured ? (
                <span title={`${mine.label} featured here`} className="rounded px-1 py-px font-semibold" style={{ color: mine.color, background: partTint(mine.color) }}>
                  {label}
                </span>
              ) : (
                label
              )}
              {s.comment && !isLongComment(s.comment) && <span className="text-xs italic text-muted"> {s.comment}</span>}
              {!longComment && <span className="text-muted"> {closing}</span>}
            </span>
          </Fragment>
        );
      })}
      {longComment && (
        <>
          {" "}
          <span className="text-xs italic text-muted">{longComment}</span>
          {last && <span className="text-muted">{" ||"}</span>}
        </>
      )}
    </p>
  );
}

function SongBlock({ item, n, lead, highlight }: { item: PlanItem; n: number; lead: string | null; highlight: string | null }) {
  const key = keyLabel(item.key, item.transpose_to);
  const steps = item.sequence ?? [];
  const ls = lines(steps);
  // The links set for this song in the session (as in the full view), under its title and above its sequence.
  const links = (item.links ?? []).filter((l) => l.url);
  return (
    <li className="space-y-1">
      <p className="font-semibold">
        {n}. {item.title || "Song to be chosen"}
        {key && ` (${key})`}
        {item.bpm && ` - ${item.bpm}bpm`}
        {lead && ` [${lead}]`}
      </p>
      {links.length > 0 && (
        // "Live version: https://…", one per line. A link with no name is just its address.
        <ul className="space-y-0.5 pl-4 leading-6">
          {links.map((l, i) => (
            <li key={i}>
              {l.label && `${l.label}: `}
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="break-all text-blue-600 underline underline-offset-2 hover:text-blue-800">
                {l.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      {steps.length > 0 && (
        <div className="pl-4">
          {ls.map((l, i) => (
            <SeqLine key={l[0]?.id ?? i} steps={l} first={i === 0} last={i === ls.length - 1} highlight={highlight} />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * The whole set as one block of text, like a printed run sheet: each section's songs numbered,
 * with key, tempo and lead, and the sequence written out with short names (V1, C).
 * Transitions sit in their place between the songs, unnumbered, as in the full view.
 */
export function SimplePlan({ plan, leadName, highlight }: { plan: PlanSection[]; leadName: (id: string | null) => string | null; highlight: string | null }) {
  const sections = plan.filter((s) => s.items.length > 0);
  if (!sections.length) return <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">Nothing planned yet.</p>;
  return (
    <article
      aria-label="Simplified set"
      className="space-y-6 rounded-xl border border-border bg-surface p-4 text-sm sm:p-5"
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      {sections.map((s) => (
        <section key={s.id} className="space-y-3">
          <h2 className="text-base font-bold underline underline-offset-4">{s.name}</h2>
          <ol className="space-y-4">
            {s.items.map((item, i) =>
              item.kind === "transition" ? (
                <li key={item.id} className="italic text-foreground/80">
                  {"// Transition"}{item.notes ? `: ${item.notes}` : ""}
                </li>
              ) : (
                // Songs are numbered on their own; transitions don't count.
                <SongBlock
                  key={item.id}
                  item={item}
                  n={s.items.slice(0, i + 1).filter((x) => x.kind === "song").length}
                  lead={leadName(item.lead_id)}
                  highlight={highlight}
                />
              ),
            )}
          </ol>
        </section>
      ))}
    </article>
  );
}
