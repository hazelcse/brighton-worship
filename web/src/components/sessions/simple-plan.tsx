"use client";

import { Fragment } from "react";
import { FreeText, SlantWords } from "@/components/sessions/slant";
import { NotesText } from "@/components/sessions/notes-text";
import { useCopyOnClick } from "@/components/sessions/copy-on-click";
import type { PlanCopy } from "@/components/sessions/plan-text";
import { SectionSongsheets, type SessionSheet } from "@/components/sessions/plan-editor";
import { isLongComment, keyLabel, looseParts, partInfo, partsPlayedBy, partTint, type PlanItem, type PlanSection, type SeqStep } from "@/lib/session-plan";
import { label, lines } from "@/lib/seq-lines";

/** Comments: Gmail's grey, as in the copied email (slanted rather than italic, see FONTS.md). */
const NOTE = "text-[#666666]";

/**
 * One line of a sequence: || Intro x2 | V1 | C |, with the viewer's instrument picked out. Each step
 * keeps its closing bar with it, so a line that wraps on a narrow screen still ends in |. A comment
 * sits beside its step; a step with a long one starts a line of its own (see lines), with no bar
 * after it, and the comment wraps onto the lines under it.
 */
function SeqLine({
  steps,
  first,
  last,
  highlight,
  head,
  tail,
}: {
  steps: SeqStep[];
  first: boolean;
  last: boolean;
  highlight: string | null;
  /** Loose text before the first bar / after the last (first and last lines only): a note, not a step. */
  head?: string;
  tail?: string;
}) {
  const played = partsPlayedBy(highlight);
  // A step with a long comment is on a line of its own: "| Chorus" with no bar after it, then the
  // comment, wrapping (ending in || if it's the song's last step).
  const longComment = steps.length === 1 && isLongComment(steps[0].comment) ? steps[0].comment : null;
  return (
    <p className="break-words">
      {head && (
        <span className={NOTE}>
          <SlantWords text={head} />{" "}
        </span>
      )}
      {steps.map((s, i) => {
        // The viewer's own part if it's here, else another they play (keys also covers synth/pads).
        const featuredRole = played.find((r) => s.parts?.includes(r));
        const featured = featuredRole ? partInfo(featuredRole) : undefined;
        const name = (
          <>
            {/* Free text the same size as the elements; its <notes> grey and slanted like the other comments. */}
            {s.free ? <FreeText text={label(s)} noteClass={NOTE} /> : label(s)}
            {s.repeat > 1 && ` x${s.repeat}`}
            {s.tags.length > 0 && ` (${s.tags.join(", ")})`}
          </>
        );
        const closing = last && i === steps.length - 1 ? "||" : "|";
        return (
          <Fragment key={s.id}>
            {i > 0 && " "}
            {/* The step, its instruments and a short comment on one line, never split; free text (up to
                160 characters) wraps like words, so it can't run past the box on a phone. */}
            <span className={s.free ? undefined : "whitespace-nowrap"}>
              {i === 0 && (first ? "|| " : "| ")}
              {s.before && (
                <span className={NOTE}>
                  <SlantWords text={s.before} />{" "}
                </span>
              )}
              {featured ? (
                <span title={`${featured.label} featured here`} className="rounded px-1 py-px font-semibold" style={{ color: featured.color, background: partTint(featured.color) }}>
                  {name}
                </span>
              ) : (
                name
              )}
              {s.comment && !isLongComment(s.comment) && (
                <span className={NOTE}>
                  {" "}
                  <SlantWords text={s.comment} />
                </span>
              )}
              {!longComment && ` ${closing}`}
            </span>
          </Fragment>
        );
      })}
      {longComment && (
        <>
          {" "}
          <span className={NOTE}>
            <SlantWords text={longComment} />
          </span>
          {last && " ||"}
        </>
      )}
      {tail && (
        <span className={NOTE}>
          {" "}
          <SlantWords text={tail} />
        </span>
      )}
    </p>
  );
}

function SongBlock({ item, n, lead, highlight }: { item: PlanItem; n: number; lead: string | null; highlight: string | null }) {
  const key = keyLabel(item.key, item.transpose_to);
  const { head, body: steps, tail } = looseParts(item.sequence ?? []);
  const ls = lines(steps);
  // The links set for this song in the session (as in the full view), under its title and above its sequence.
  const links = (item.links ?? []).filter((l) => l.url);
  return (
    <li>
      <p className="font-bold">
        {n}. {item.title || "Song to be chosen"}
        {key && ` (${key})`}
        {item.bpm && ` - ${item.bpm}bpm`}
        {lead && ` [${lead}]`}
      </p>
      {links.length > 0 && (
        // "Live version: https://…", one per line. A link with no name is just its address.
        <ul className="pl-6">
          {links.map((l, i) => (
            <li key={i}>
              {l.label && `${l.label}: `}
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="break-all text-[#1155cc] underline">
                {l.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      {/* A little room (8px) between the sequence and the links above it and the notes under it. */}
      {steps.length > 0 && (
        <div className={`pl-6 ${links.length ? "mt-2" : ""}`}>
          {ls.map((l, i) => (
            <SeqLine
              key={l[0]?.id ?? i}
              steps={l}
              first={i === 0}
              last={i === ls.length - 1}
              highlight={highlight}
              head={i === 0 ? head?.name : undefined}
              tail={i === ls.length - 1 ? tail?.name : undefined}
            />
          ))}
        </div>
      )}
      {/* The song's notes under its sequence: a bold "Notes:", then the notes on the lines under it, as
          written ("• " lines as a dot list), the elements' size. */}
      {item.notes.trim() && (
        <div className={`pl-6 ${steps.length ? "mt-2" : ""}`}>
          <p className="font-bold">Notes:</p>
          <NotesText notes={item.notes} />
        </div>
      )}
    </li>
  );
}

/**
 * Styled like the copied email in Gmail (see plan-text): arial (14px, a touch bigger than Gmail's 13px Normal; #222),
 * section names bold and underlined, song lines bold, links / sequence / notes indented 24px, a
 * blank line's space between blocks. The whole set as one block of text, like a printed run sheet: each section's songs numbered,
 * with key, tempo and lead, and the sequence written out with short names (V1, C).
 * Transitions sit in their place between the songs, unnumbered, as in the full view.
 */
export function SimplePlan({
  plan,
  leadName,
  highlight,
  sheetsFor = null,
  sheetKeys = {},
  onOpenSheet,
  copy,
}: {
  plan: PlanSection[];
  leadName: (id: string | null) => string | null;
  highlight: string | null;
  /** Once the plan's published: the session's id, for every song's songsheet at the bottom (as in the full view). */
  sheetsFor?: string | null;
  sheetKeys?: Record<string, string[]>;
  /** Open a songsheet in the right-hand panel instead of a popup. */
  onOpenSheet?: (sheet: SessionSheet) => void;
  /** Worship leaders, once published: clicking the box copies this (see useCopyOnClick). */
  copy?: () => PlanCopy;
}) {
  const copier = useCopyOnClick(copy, "the simplified version");
  const sections = plan.filter((s) => s.items.length > 0);
  if (!sections.length) return <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">Nothing planned yet.</p>;
  const sheets = sheetsFor && (
    // Every song's songsheet in one place under the run sheet, in the app's own font (not the run sheet's Arial).
    <SectionSongsheets sessionId={sheetsFor} items={sections.flatMap((s) => s.items)} sheetKeys={sheetKeys} onOpen={onOpenSheet} className="rounded-xl border border-border bg-surface p-3 sm:p-4" />
  );
  return (
    <>
    <article
      aria-label="Simplified set"
      className={`space-y-[1.15em] rounded-xl border border-border bg-surface px-5 py-4 text-[13px] leading-[1.4] text-[#222222] [overflow-wrap:anywhere] sm:p-5 sm:text-[14px] ${copier.className}`}
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      {...copier.props}
    >
      {copier.badge}
      {sections.map((s) => (
        <section key={s.id} className="space-y-[1.15em]">
          <h2 className="font-bold underline">{s.name}</h2>
          <ol className="space-y-[1.15em]">
            {s.items.map((item, i) =>
              item.kind === "transition" ? (
                <li key={item.id}>
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
    {copier.hint}
    {sheets}
    </>
  );
}
