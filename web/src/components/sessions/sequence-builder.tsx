"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { PART_ROLES, SUGGESTED_ELEMENTS, SUGGESTED_TAGS, copySteps, insertElement, partInfo, partTint, stepLabel, type SeqStep } from "@/lib/session-plan";

const chipBase = "inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 text-sm";
const smallBtn = "rounded-md border border-border px-2 py-1 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-40";
// These "add" boxes sit inside the song's Details form. Pointing them at a form id that doesn't exist
// detaches them from it, so Enter in them can't save the Details form (and they aren't sent with it).
const NO_FORM = "sequence-builder-no-form";
const input =
  "h-8 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/** A sequence, read-only: Verse 1 x2 → Chorus (High) → ... `highlight`: the viewer's instrument. */
/**
 * A sequence to read, like a chord chart: || Intro | Verse | Chorus x2 (High) [Drums] | End ||.
 * Each linked instrument is a badge in its colour (as in the builder); the viewer's own is filled.
 */
export function SequenceView({ steps, highlight }: { steps: SeqStep[]; highlight?: string | null }) {
  if (!steps.length) return <p className="text-sm text-muted">No sequence yet.</p>;
  const bar = (double: boolean) => (
    <span aria-hidden className="select-none font-light text-muted">
      {double ? "||" : "|"}
    </span>
  );
  return (
    <ol aria-label="Sequence" className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5 leading-6">
      {steps.map((s, i) => {
        const parts = (s.parts ?? []).map((r) => partInfo(r)).filter((p) => p !== undefined);
        const last = i === steps.length - 1;
        return (
          // A step keeps its bar (and the closing ||) with it when the line wraps.
          <li key={s.id} className="inline-flex flex-wrap items-baseline gap-x-2">
            {bar(i === 0)}
            <span>
              <span className="font-medium">{s.name}</span>
              {s.repeat > 1 && <span className="font-semibold text-accent"> x{s.repeat}</span>}
              {s.tags.length > 0 && <span className="text-muted"> ({s.tags.join(", ")})</span>}
              {parts.map((p) => {
                const mine = p.role === highlight;
                return (
                  <span
                    key={p.role}
                    title={`${p.label} featured here`}
                    className="ml-1.5 inline-block whitespace-nowrap rounded-full border px-1.5 align-[1px] text-[11px] font-semibold leading-4"
                    style={{ borderColor: p.color, color: mine ? "#fff" : p.color, background: mine ? p.color : partTint(p.color) }}
                  >
                    {p.label}
                  </span>
                );
              })}
              {s.comment && <span className="ml-1.5 text-xs italic text-muted">{s.comment}</span>}
            </span>
            {last && bar(true)}
          </li>
        );
      })}
    </ol>
  );
}

/** Ends the line in a sequence, so a commented step starts a line of its own. */
const LineBreak = () => <li aria-hidden className="h-0 basis-full" />;

/** A step's comment, on its own line under it. The next step starts on the line after. */
function Comment({ text, indent }: { text: string; indent?: boolean }) {
  return (
    <li className={`basis-full -mt-1 text-sm italic text-muted ${indent ? "pl-4" : "pl-1"}`}>
      <span aria-hidden>↳ </span>
      {text}
    </li>
  );
}

/** A step with its linked instruments beside it, joined by a line. */
function StepColumn({ step, highlight, active, onClick }: { step: SeqStep; highlight?: string | null; active?: boolean; onClick?: () => void }) {
  const parts = (step.parts ?? []).map((r) => partInfo(r)).filter((p) => p !== undefined);
  return (
    <div className="flex items-center">
      <StepChip step={step} active={active} onClick={onClick} />
      {parts.map((p) => {
        const mine = p.role === highlight;
        return (
          <div key={p.role} className="flex items-center">
            <span aria-hidden className="h-0.5 w-2.5" style={{ background: p.color }} />
            <span
              title={`${p.label} linked here`}
              className={`whitespace-nowrap rounded-md border-2 px-1.5 py-px text-[11px] font-semibold leading-4 ${mine ? "text-white" : ""}`}
              style={{ borderColor: p.color, color: mine ? undefined : p.color, background: mine ? p.color : partTint(p.color) }}
            >
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StepChip({ step, active, onClick }: { step: SeqStep; active?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="font-medium">{step.name}</span>
      {step.repeat > 1 && <span className="text-xs font-semibold text-accent">x{step.repeat}</span>}
      {step.tags.length > 0 && <span className="text-muted">({step.tags.join(", ")})</span>}
    </>
  );
  if (!onClick) return <span className={`${chipBase} border-border bg-surface`}>{body}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${stepLabel(step)}: edit`}
      className={`${chipBase} ${active ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/60"}`}
    >
      {body}
    </button>
  );
}

/**
 * Build a song's sequence by clicking its elements: the songsheet's sections, plus any the worship
 * leader adds for this session. Elements go in at the insertion point (the bar), so the middle of
 * a sequence can be edited; clicking the same element again right after itself makes it x2.
 */
export function SequenceBuilder({
  steps,
  onChange,
  scanned,
  presets,
  custom,
  onCustom,
  tagSuggestions,
}: {
  steps: SeqStep[];
  onChange: (steps: SeqStep[]) => void;
  /** Sections the scanner found on the songsheet. */
  scanned: string[];
  /** Ready-made sequences to start from, e.g. the song's standard sequence. An empty one shows disabled. */
  presets: { label: string; steps: SeqStep[] }[];
  /** Elements added for this song in this session. */
  custom: string[];
  onCustom: (elements: string[]) => void;
  /** Tags used elsewhere in the session, offered as well as High/Low/Half. */
  tagSuggestions: string[];
}) {
  const [caret, setCaret] = useState(steps.length);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ownElement, setOwnElement] = useState("");
  const [ownTag, setOwnTag] = useState("");
  const at = Math.min(caret, steps.length);
  // Clicking anywhere but the sequence or the element's box closes the box.
  const stripRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeId) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!stripRef.current?.contains(t) && !boxRef.current?.contains(t)) setActiveId(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [activeId]);
  const activeIndex = steps.findIndex((s) => s.id === activeId);
  const active = activeIndex >= 0 ? steps[activeIndex] : null;

  const palette = [...new Set([...scanned, ...custom, ...SUGGESTED_ELEMENTS])];
  const tags = [...new Set([...SUGGESTED_TAGS, ...tagSuggestions, ...(active?.tags ?? [])])];

  function add(name: string) {
    const r = insertElement(steps, at, name);
    onChange(r.steps);
    setCaret(r.at);
    setActiveId(null);
  }

  function addOwn() {
    const name = ownElement.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return;
    if (!palette.some((p) => p.toLowerCase() === name.toLowerCase())) onCustom([...custom, name]);
    add(palette.find((p) => p.toLowerCase() === name.toLowerCase()) ?? name);
    setOwnElement("");
  }

  const patch = (id: string, p: Partial<SeqStep>) => onChange(steps.map((s) => (s.id === id ? { ...s, ...p } : s)));

  function move(dir: -1 | 1) {
    if (activeIndex < 0) return;
    const j = activeIndex + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[activeIndex], next[j]] = [next[j], next[activeIndex]];
    onChange(next);
    setCaret(j + 1);
  }

  function remove() {
    if (activeIndex < 0) return;
    onChange(steps.filter((s) => s.id !== activeId));
    setCaret(activeIndex);
    setActiveId(null);
  }

  function toggleTag(t: string) {
    if (!active) return;
    patch(active.id, { tags: active.tags.includes(t) ? active.tags.filter((x) => x !== t) : [...active.tags, t] });
  }

  function togglePart(role: string) {
    if (!active) return;
    const parts = active.parts ?? [];
    const next = parts.includes(role) ? parts.filter((x) => x !== role) : [...parts, role];
    // Keep them in roster order.
    patch(active.id, { parts: PART_ROLES.map((p) => p.role).filter((r) => next.includes(r)) });
  }

  function addTag() {
    const t = ownTag.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!t || !active) return;
    if (!active.tags.some((x) => x.toLowerCase() === t.toLowerCase())) patch(active.id, { tags: [...active.tags, t] });
    setOwnTag("");
  }

  // A thin spot between chips; the one in use shows as a bar.
  const slot = (i: number) => (
    <button
      key={`slot-${i}`}
      type="button"
      onClick={() => {
        setCaret(i);
        setActiveId(null);
      }}
      aria-label={i === at ? "Insertion point" : `Insert here (position ${i + 1})`}
      title="Add elements here"
      className="group flex h-8 w-3 shrink-0 items-center justify-center"
    >
      <span className={`h-6 rounded-full transition-all ${i === at ? "w-1 bg-accent" : "w-px bg-transparent group-hover:w-1 group-hover:bg-accent/40"}`} />
    </button>
  );

  return (
    <div className="space-y-3">
      <div ref={stripRef} className="rounded-lg border border-border bg-surface p-2">
        {steps.length ? (
          <ol className="flex flex-wrap items-start gap-y-2">
            {steps.map((s, i) => (
              <Fragment key={s.id}>
                {i > 0 && s.comment && <LineBreak />}
                <li className="flex items-start">
                  {slot(i)}
                  <StepColumn
                    step={s}
                    active={s.id === activeId}
                    onClick={() => {
                      setActiveId(s.id === activeId ? null : s.id);
                      setCaret(i + 1);
                    }}
                  />
                </li>
                {s.comment && <Comment text={s.comment} indent />}
              </Fragment>
            ))}
            <li>
              {slot(steps.length)}
            </li>
          </ol>
        ) : (
          <p className="px-1 py-1 text-sm text-muted">Click elements below to build the sequence.</p>
        )}
      </div>

      {active && (
        <div ref={boxRef} className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{active.name}</span>
            <span className="flex items-center rounded-md border border-border bg-surface">
              <button type="button" aria-label="Fewer times" disabled={active.repeat <= 1} onClick={() => patch(active.id, { repeat: active.repeat - 1 })} className="px-2 py-1 text-sm disabled:opacity-30">
                −
              </button>
              <span className="min-w-8 text-center text-sm font-medium">x{active.repeat}</span>
              <button type="button" aria-label="More times" disabled={active.repeat >= 20} onClick={() => patch(active.id, { repeat: active.repeat + 1 })} className="px-2 py-1 text-sm disabled:opacity-30">
                +
              </button>
            </span>
            <span className="ml-auto flex gap-1">
              <button type="button" onClick={() => move(-1)} disabled={activeIndex === 0} aria-label="Move earlier" className={smallBtn}>
                ←
              </button>
              <button type="button" onClick={() => move(1)} disabled={activeIndex === steps.length - 1} aria-label="Move later" className={smallBtn}>
                →
              </button>
              <button type="button" onClick={remove} className={`${smallBtn} hover:border-danger hover:text-danger`}>
                Remove
              </button>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tags">
            {tags.map((t) => {
              const on = active.tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTag(t)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${on ? "border-ink bg-ink text-ink-foreground" : "border-border bg-surface hover:border-accent"}`}
                >
                  {t}
                </button>
              );
            })}
            {/* Not a <form>: this builder sits inside the song's Details form, and forms can't nest. */}
            <div className="flex items-center gap-1">
              <input
                value={ownTag}
                onChange={(e) => setOwnTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return; // not while typing Chinese etc.
                  e.preventDefault(); // add the tag, don't submit the form around this builder
                  addTag();
                }}
                placeholder="New tag"
                aria-label="New tag"
                form={NO_FORM}
                className={`${input} h-7 w-28 text-xs`}
              />
              <button type="button" onClick={addTag} disabled={!ownTag.trim()} className={smallBtn}>
                Add
              </button>
            </div>
          </div>
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Comment:</span>
            <input
              value={active.comment ?? ""}
              onChange={(e) => patch(active.id, { comment: e.target.value.slice(0, 160) || undefined })}
              placeholder='e.g. WL sings "You are good" x3'
              className={`${input} h-7 min-w-0 flex-1 text-xs`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Instruments to bring out">
            <span className="text-xs font-medium text-muted" title="Each linked player is told you want more of their instrument here">
              Link:
            </span>
            {PART_ROLES.map((p) => {
              const on = (active.parts ?? []).includes(p.role);
              return (
                <button
                  key={p.role}
                  type="button"
                  aria-pressed={on}
                  onClick={() => togglePart(p.role)}
                  className={`rounded-md border-2 px-2 py-0.5 text-xs font-semibold ${on ? "" : "border-dashed opacity-75 hover:opacity-100"}`}
                  style={{ borderColor: p.color, color: p.color, background: on ? partTint(p.color) : undefined }}
                >
                  {on ? "✓ " : "+ "}
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {palette.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => add(name)}
              className={`rounded-lg border px-2.5 py-1 text-sm hover:border-accent hover:text-accent ${
                scanned.includes(name) ? "border-border bg-background" : "border-dashed border-border bg-surface"
              }`}
            >
              + {name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              value={ownElement}
              onChange={(e) => setOwnElement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return; // not while typing Chinese etc.
                e.preventDefault(); // add the element, don't submit the form around this builder
                addOwn();
              }}
              placeholder="Own element, e.g. Tag"
              aria-label="Add your own element"
              form={NO_FORM}
              className={`${input} w-44`}
            />
            <button type="button" onClick={addOwn} disabled={!ownElement.trim()} className={smallBtn}>
              Add
            </button>
          </div>
          <span className="ml-auto flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={!p.steps.length}
                title={p.steps.length ? p.steps.map(stepLabel).join(" → ") : "Nothing to use yet"}
                onClick={() => {
                  const next = copySteps(p.steps);
                  onChange(next);
                  setCaret(next.length);
                  setActiveId(null);
                }}
                className={smallBtn}
              >
                {p.label}
              </button>
            ))}
            {steps.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onChange([]);
                  setCaret(0);
                  setActiveId(null);
                }}
                className={`${smallBtn} hover:border-danger hover:text-danger`}
              >
                Clear
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
