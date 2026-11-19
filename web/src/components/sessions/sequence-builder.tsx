"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { SlantWords } from "@/components/sessions/slant";
import { backspaceAtStart, fieldText, insertAtCursor, neighbour, splitAtBar, withLoose, withText, type Cursor, type Part } from "@/lib/seq-text";
import { PART_ROLES, SUGGESTED_ELEMENTS, looseParts, SUGGESTED_TAGS, copySteps, insertElement, isLongComment, partInfo, partTint, stepLabel, type SeqStep } from "@/lib/session-plan";

// The sequence's steps: small (24px, 12px text), fully rounded, with a very light amber tint.
const chipBase = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs";
const smallBtn = "rounded-md border border-border px-2 py-1 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-40";
const noSubscribe = () => () => {};

/**
 * Enter in an "add" box (own element, own tag) adds what's typed. The boxes sit inside the song's
 * Details form, and forms can't nest, so each gets a little form of its own outside the page's
 * (in <body>), joined to it by the box's form attribute. Enter in a form's only box submits it: the
 * browser does that for every keyboard, phones' too (whose Enter often comes while a word is still
 * being composed, which a keydown check would skip), and holds it back while a Chinese or Japanese
 * keyboard is still choosing characters. It also keeps Enter from saving the Details form.
 */
function useEnterToAdd(onEnter: () => void): { formId: string; form: ReactNode } {
  const formId = `add-${useId().replace(/:/g, "")}`;
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const form = mounted
    ? createPortal(
        <form
          id={formId}
          hidden
          onSubmit={(e) => {
            e.preventDefault();
            // Portalled events still reach React parents: keep it from the Details form.
            e.stopPropagation();
            onEnter();
          }}
        />,
        document.body,
      )
    : null;
  return { formId, form };
}
/**
 * The step's "Link:" instruments as a dropdown. The button shows the linked ones as pills in their
 * colours (or a dashed "Choose instruments"); the menu lists every instrument with a tick box in
 * its own colour, the linked ones tinted, and Clear at the bottom when any are linked.
 */
function LinkSelect({ selected, onToggle, onClear }: { selected: string[]; onToggle: (role: string) => void; onClear: () => void }) {
  const ROW = 34;
  const { at, open, buttonRef, menuRef, toggleOpen } = usePopover(224, 36 + PART_ROLES.length * ROW + 8 + 37);
  const linked = PART_ROLES.filter((p) => selected.includes(p.role));

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Instruments to bring out: ${linked.length ? linked.map((p) => p.label).join(", ") : "none"}`}
        onClick={toggleOpen}
        className={`group flex min-h-7 flex-wrap items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
          linked.length ? "border-border bg-surface" : "border-dashed border-muted/70 bg-transparent text-muted"
        } ${open ? "border-accent ring-2 ring-accent/15" : "hover:border-accent"}`}
      >
        {linked.length ? (
          linked.map((p) => (
            <span key={p.role} className="inline-flex items-center gap-1 rounded-full px-2 py-px font-medium" style={{ color: p.color, background: partTint(p.color) }}>
              <span className="size-1.5 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.label}
            </span>
          ))
        ) : (
          <span className="px-1 group-hover:text-accent">Choose instruments</span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden
          className={`mr-0.5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {at &&
        createPortal(
          <div
            ref={menuRef}
            data-seq-popover=""
            role="group"
            aria-label="Instruments to bring out"
            style={{ left: at.left, top: at.top }}
            className="fixed z-50 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
          >
            <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Bring out</p>
            <div className="px-1 pb-1">
              {PART_ROLES.map((p) => {
                const on = selected.includes(p.role);
                return (
                  <label
                    key={p.role}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm transition-colors hover:bg-background"
                    style={{ height: ROW, background: on ? partTint(p.color) : undefined }}
                  >
                    <input type="checkbox" checked={on} onChange={() => onToggle(p.role)} className="peer sr-only" />
                    {/* A tick box in the instrument's own colour. */}
                    <span
                      aria-hidden
                      className="flex size-4 shrink-0 items-center justify-center rounded-[5px] border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40"
                      style={{ borderColor: p.color, background: on ? p.color : "transparent" }}
                    >
                      {on && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12.5 10 17 19 7" />
                        </svg>
                      )}
                    </span>
                    <span className={on ? "font-medium" : ""} style={on ? { color: p.color } : undefined}>
                      {p.label}
                    </span>
                  </label>
                );
              })}
            </div>
            {linked.length > 0 && (
              <button type="button" onClick={onClear} className="w-full border-t border-border px-3 py-2 text-left text-xs text-muted hover:bg-background hover:text-foreground">
                Clear
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * A menu under a button, portalled to <body> at a fixed spot: the plan's song cards clip what
 * overflows them. Scrolling or resizing closes it rather than leaving it behind. width/height: the
 * menu's size, to place it above the button when there isn't room below and keep it in the window.
 */
function usePopover(width: number, height: number) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const open = at !== null;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => buttonRef.current?.contains(t as Node) || menuRef.current?.contains(t as Node);
    const close = (e: PointerEvent) => !inside(e.target) && setAt(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAt(null);
    const away = (e: Event) => !inside(e.target) && setAt(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [open]);
  const toggleOpen = () => {
    if (open) return setAt(null);
    const r = buttonRef.current!.getBoundingClientRect();
    // Under the button, or above it when there isn't room below; kept inside the window.
    const top = r.bottom + 4 + height > window.innerHeight && r.top - 4 - height > 0 ? r.top - 4 - height : r.bottom + 4;
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top });
  };
  return { at, open, buttonRef, menuRef, toggleOpen, close: () => setAt(null) };
}

/**
 * The element buttons, grouped by kind: Verse, Verse 1 and Verse 2 are one "Verse" group; Pre-Chorus,
 * Pre Chorus and Prechorus 1 one "Prechorus"; LL, L2L and L3L one "LL". A group's key is the name in
 * lower case without digits, spaces or punctuation; its label is a member's name without the digits
 * (one already without digits if there is one). Groups keep the place of their first member.
 */
export function groupElements(names: string[]): { label: string; members: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const key = name.toLowerCase().replace(/[\d\s\p{P}]/gu, "") || name;
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  return [...groups.values()].map((members) => {
    const plain = members.find((m) => !/\d/.test(m));
    const label = plain ?? (members[0].replace(/\d+/g, " ").replace(/\s+/g, " ").trim() || members[0]);
    return { label, members };
  });
}

// Light amber, like the app's other amber touches (the "unpublished changes" pill, notices).
// Solid border: on the songsheet; dashed: suggested or added for this session.
const elementBtn = (solid: boolean) =>
  `rounded-lg border border-orange-300/80 bg-amber-50 px-2.5 py-1 text-sm text-amber-900 hover:border-orange-400 hover:bg-amber-100 ${solid ? "" : "border-dashed"}`;

/**
 * One element button. With one name, a click adds it. With several (a group), it looks the same
 * plus a tiny ▾, and a click opens a menu of the names as plain words; picking one adds it.
 */
function ElementButton({ label, members, scanned, onAdd }: { label: string; members: string[]; scanned: string[]; onAdd: (name: string) => void }) {
  const { at, open, buttonRef, menuRef, toggleOpen, close } = usePopover(176, members.length * 32 + 8);
  if (members.length === 1) {
    return (
      <button type="button" onClick={() => onAdd(members[0])} className={elementBtn(scanned.includes(members[0]))}>
        + {members[0]}
      </button>
    );
  }
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={toggleOpen}
        className={`${elementBtn(members.some((m) => scanned.includes(m)))} inline-flex items-center gap-1`}
      >
        + {label}
        {/* Tiny ▾: there's more than one to pick from. */}
        <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden className="opacity-70">
          <path d="M1 3h8L5 8z" fill="currentColor" />
        </svg>
      </button>
      {at &&
        createPortal(
          <div
            ref={menuRef}
            data-seq-popover=""
            role="group"
            aria-label={label}
            style={{ left: at.left, top: at.top }}
            className="fixed z-50 w-44 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg"
          >
            {/* Plain words, one per row (not the amber buttons). */}
            {members.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onAdd(name);
                  close();
                }}
                className="flex h-8 w-full items-center px-3 text-left text-sm hover:bg-background"
              >
                {name}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

const input =
  "h-8 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/** A sequence, read-only: Verse 1 x2 → Chorus (High) → ... `highlight`: the viewer's instrument. */
/**
 * A sequence to read, like a chord chart: || Intro | Verse | Chorus x2 (High) [Drums] | End ||.
 * Each linked instrument is a badge in its colour (as in the builder); the viewer's own is filled.
 */
export function SequenceView({ steps: all, highlight }: { steps: SeqStep[]; highlight?: string | null }) {
  // Loose text (before the first bar, after the last) reads as a note outside the bars.
  const { head, body: steps, tail } = looseParts(all);
  if (!all.length) return <p className="text-sm text-muted">No sequence yet.</p>;
  const loose = (s: SeqStep) => (
    <li className="text-xs text-muted">
      <SlantWords text={s.name} />
    </li>
  );
  const bar = (double: boolean) => (
    <span aria-hidden className="select-none font-light text-muted">
      {double ? "||" : "|"}
    </span>
  );
  return (
    <ol aria-label="Sequence" className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5 leading-6">
      {head && loose(head)}
      {steps.map((s, i) => {
        const parts = (s.parts ?? []).map((r) => partInfo(r)).filter((p) => p !== undefined);
        const last = i === steps.length - 1;
        // A step with a long comment has a line of its own ("| Chorus"), with the comment on the line
        // under it (wrapping), and the next step starts a new line after that.
        const long = Boolean(s.comment) && isLongComment(s.comment);
        return (
          <Fragment key={s.id}>
            {long && i > 0 && <LineBreak />}
            {/* A step keeps its bar (and the closing ||) with it when the line wraps. */}
            <li className="inline-flex min-w-0 max-w-full items-baseline gap-x-2">
              {bar(i === 0)}
              <span className="min-w-0">
                {/* Text before the element (between the bar and it), then the element; free text alone. */}
                {s.before && (
                  <span className="mr-1.5 text-xs text-muted">
                    <SlantWords text={s.before} />
                  </span>
                )}
                <span className={s.free ? "text-[13px]" : "font-medium"}>{s.name}</span>
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
                {s.comment && !long && (
                  <span className="ml-1.5 text-xs text-muted">
                    <SlantWords text={s.comment} />
                  </span>
                )}
              </span>
              {last && !long && bar(true)}
            </li>
            {long && (
              <ReadComment text={s.comment!}>
                {/* The song's last step: its closing || ends the comment. */}
                {last && <> {bar(true)}</>}
              </ReadComment>
            )}
          </Fragment>
        );
      })}
      {tail && loose(tail)}
    </ol>
  );
}

/** A long step comment in a sequence you read: its own line under the step, wrapping if need be. */
function ReadComment({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <li className="basis-full -mt-1 break-words text-muted">
      <span className="text-xs">
        <SlantWords text={text} />
      </span>
      {children}
    </li>
  );
}

/** Ends the line in a sequence, so a commented step starts a line of its own. */
const LineBreak = () => <li aria-hidden className="h-0 basis-full" />;

/** Where the text cursor is in an editable span, as a character offset (null: not in it). */
function caretIn(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.focusNode || !el.contains(sel.focusNode)) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.focusNode, sel.focusOffset);
  return r.toString().length;
}

/** Put the text cursor at a character offset in an editable span (its one text node). */
function placeCaret(el: HTMLElement, offset: number) {
  if (!(el.firstChild instanceof Text)) el.textContent = el.textContent ?? "";
  if (!el.firstChild) el.appendChild(document.createTextNode(""));
  const t = el.firstChild as Text;
  const r = document.createRange();
  r.setStart(t, Math.min(offset, t.length));
  r.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/** The character offset in `el`'s text nearest a point on screen (null: not over its text). */
function offsetAt(el: HTMLElement, x: number, y: number): number | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let off = 0;
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    off = pos.offset;
  } else {
    const r = d.caretRangeFromPoint?.(x, y);
    if (r) {
      node = r.startContainer;
      off = r.startOffset;
    }
  }
  if (!node || !el.contains(node)) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, off);
  return r.toString().length;
}

/**
 * Text typed straight into the sequence: between a bar and an element or an element and a bar
 * (notes: muted, slanted), or on its own between two bars (free text: plain). It's inline text, so
 * a long one wraps like a line of writing, its next line starting at the left of the sequence box.
 * While you type in it, it's an editable span (upright, so the cursor stays upright); otherwise it
 * shows the words (notes slanted), and a tap there puts the cursor at the tapped letter. With the
 * builder's cursor here but not typing (an element button was just pressed, say), a blinking
 * cursor still shows where the next element goes.
 */
function TextField({
  field,
  value,
  plain,
  label,
  editing,
  caretAt,
  onPick,
  onInput,
  onCursor,
  onBlur,
  onKey,
}: {
  /** "id:part", for finding and focusing the box. */
  field: string;
  value: string;
  plain: boolean;
  label: string;
  /** Typing in it now: the editable span. */
  editing: boolean;
  /** Not typing: show a blinking cursor at this offset (the builder's cursor is here). */
  caretAt: number | null;
  /** A tap on the words while not typing: start typing at this offset. */
  onPick: (offset: number) => void;
  onInput: (v: string, caret: number) => void;
  /** The text cursor moved while typing: where it is now. */
  onCursor: (offset: number) => void;
  onBlur: (offset: number) => void;
  onKey: (e: React.KeyboardEvent<HTMLSpanElement>) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // The editable span's text is set here, not by React (the browser edits it as you type).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !editing || el.textContent === value) return;
    const at = caretIn(el);
    el.textContent = value;
    if (at !== null) placeCaret(el, Math.min(at, value.length));
  }, [value, editing]);
  // Follow the text cursor while typing (clicks, arrow keys inside the words).
  useEffect(() => {
    if (!editing) return;
    const moved = () => {
      const el = ref.current;
      const at = el && caretIn(el);
      if (at != null) onCursor(at);
    };
    document.addEventListener("selectionchange", moved);
    return () => document.removeEventListener("selectionchange", moved);
  }, [editing, onCursor]);

  const tone = plain ? "text-[13px] text-foreground" : "text-xs text-muted";
  if (editing) {
    return (
      // Its own key: the browser has edited this span's text, so React must not reuse it for the
      // words shown afterwards (or the typed text would stay in it).
      <span
        key="typing"
        ref={ref}
        data-field={field}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        role="textbox"
        aria-label={label}
        spellCheck={false}
        onInput={(e) => {
          const el = e.currentTarget;
          let v = (el.textContent ?? "").replace(/\n/g, " ");
          if (v.length > 160) v = v.slice(0, 160);
          const at = caretIn(el) ?? v.length;
          if (v !== el.textContent) {
            el.textContent = v;
            placeCaret(el, Math.min(at, v.length));
          }
          onInput(v, Math.min(at, v.length));
        }}
        onBlur={(e) => onBlur(caretIn(e.currentTarget) ?? value.length)}
        onKeyDown={onKey}
        className={`cursor-text select-text whitespace-pre-wrap break-words px-1.5 caret-foreground outline-none ${tone} ${value ? "" : "inline-block min-w-4"}`}
      />
    );
  }
  const words = (t: string) => (plain ? t : <SlantWords text={t} />);
  return (
    <span
      key="showing"
      data-field={field}
      onMouseDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        let at = offsetAt(el, e.clientX, e.clientY);
        if (at === null) {
          const r = el.getBoundingClientRect();
          at = e.clientX < r.left + r.width / 2 ? 0 : value.length;
        }
        onPick(Math.min(at, value.length));
      }}
      className={`cursor-text whitespace-pre-wrap break-words px-1.5 ${tone}`}
    >
      {caretAt === null ? (
        words(value)
      ) : (
        <>
          {words(value.slice(0, caretAt))}
          <span aria-hidden className="inline-block h-4 w-px align-[-3px] bg-foreground [animation:seq-caret_1.06s_steps(1)_infinite]" />
          {words(value.slice(caretAt))}
        </>
      )}
    </span>
  );
}

/** A step with its linked instruments beside it, joined by a line. */
function StepColumn({ step, highlight, active, onClick }: { step: SeqStep; highlight?: string | null; active?: boolean; onClick?: () => void }) {
  const parts = (step.parts ?? []).map((r) => partInfo(r)).filter((p) => p !== undefined);
  return (
    <div className="inline-flex items-center align-middle">
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
      {step.repeat > 1 && <span className="text-[10px] font-semibold text-accent">x{step.repeat}</span>}
      {step.tags.length > 0 && <span className="text-muted">({step.tags.join(", ")})</span>}
    </>
  );
  if (!onClick) return <span className={`${chipBase} border-border bg-amber-50/60`}>{body}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${stepLabel(step)}: edit`}
      className={`${chipBase} ${active ? "border-accent bg-amber-100/80" : "border-accent/45 bg-amber-50/60 hover:border-accent/70"}`}
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
  // Gaps where elements can go: between the bars, never out among loose text (see looseParts).
  const gapMin = steps[0]?.loose === "start" ? 1 : 0;
  const gapMax = steps.length > gapMin && steps.at(-1)?.loose === "end" ? steps.length - 1 : steps.length;
  const at = Math.max(gapMin, Math.min(caret, gapMax));
  // Clicking anywhere but the sequence or the element's box closes the box.
  const stripRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeId) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      // Clicks in a dropdown (portalled to <body>, e.g. the Link menu) count as inside.
      if ((t as Element).closest?.("[data-seq-popover]")) return;
      if (!stripRef.current?.contains(t) && !boxRef.current?.contains(t)) setActiveId(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [activeId]);
  // ← and → move the insertion point (the bar) between elements; Backspace deletes the selected
  // element, or with none selected the one before the bar (Delete: the one after it). Only for the
  // builder last clicked in (a page can hold several), and not while typing in a box.
  const rootRef = useRef<HTMLDivElement>(null);
  const engaged = useRef(false);
  const eraseRef = useRef<(key: "Backspace" | "Delete") => void>(() => {});
  const typeRef = useRef<(char: string) => boolean>(() => false);
  const moveRef = useRef<(dir: -1 | 1) => void>(() => {});
  useEffect(() => {
    const press = (e: PointerEvent) => {
      engaged.current = !!rootRef.current?.contains(e.target as Node);
    };
    const key = (e: KeyboardEvent) => {
      if (!engaged.current || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      // A letter, digit or symbol (not space, which presses a focused button) starts typing a note
      // for the element before the bar.
      if (e.key.length === 1 && e.key !== " ") {
        if (typeRef.current(e.key)) e.preventDefault();
        return;
      }
      if (e.shiftKey || !["ArrowLeft", "ArrowRight", "Backspace", "Delete"].includes(e.key)) return;
      e.preventDefault();
      if (e.key === "Backspace" || e.key === "Delete") {
        eraseRef.current(e.key);
        return;
      }
      moveRef.current(e.key === "ArrowLeft" ? -1 : 1);
    };
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("keydown", key);
    };
  }, []);
  const activeIndex = steps.findIndex((s) => s.id === activeId);
  const active = activeIndex >= 0 ? steps[activeIndex] : null;

  const palette = [...new Set([...scanned, ...custom, ...SUGGESTED_ELEMENTS])];
  const tags = [...new Set([...SUGGESTED_TAGS, ...tagSuggestions, ...(active?.tags ?? [])])];

  function add(name: string) {
    const placed = cur && insertAtCursor(steps, cur, name);
    if (placed) {
      onChange(placed.steps);
      setCur(placed.cursor);
    } else {
      const r = insertElement(steps, at, name);
      onChange(r.steps);
      setCaret(r.at);
    }
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

  function remove() {
    if (activeIndex < 0) return;
    onChange(steps.filter((s) => s.id !== activeId));
    setCaret(activeIndex);
    setActiveId(null);
  }

  // ---- typing in the sequence ---------------------------------------------
  // The text cursor (see lib/seq-text): which step's field it's in, and where. While it's set,
  // elements go in there; null: at the gap `at` (after a chip click, a drag, or before any typing).
  // editing: the field being typed in (its editable span is shown and focused).
  const [cur, setCur] = useState<Cursor | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const fieldKey = (id: string, part: Part) => `${id}:${part}`;

  /**
   * Put the text cursor in a field and focus its box. Drawn at once (flushSync) and focused in the
   * same tap, so phones open their keyboard. `change` (new steps) is applied in the same go.
   */
  const focusField = (c: { id: string; part: Part; offset: number | "end" }, change?: SeqStep[]) => {
    const list = change ?? steps;
    const s = list.find((x) => x.id === c.id);
    if (!s) return;
    const offset = c.offset === "end" ? fieldText(s, c.part).length : c.offset;
    flushSync(() => {
      if (change) onChange(change);
      setCur({ id: c.id, part: c.part, offset });
      setEditing(fieldKey(c.id, c.part));
      setActiveId(null);
    });
    const box = stripRef.current?.querySelector<HTMLElement>(`[data-field="${fieldKey(c.id, c.part)}"][contenteditable]`);
    if (!box) return;
    box.focus();
    placeCaret(box, offset);
  };

  /** Over the next element or bar; past the first or last bar, out to the loose text there. */
  const goNext = (c: { id: string; part: Part }, dir: -1 | 1) => {
    const n = neighbour(steps, c, dir);
    if (n) return focusField(n);
    const s = steps.find((x) => x.id === c.id);
    if (s?.loose) return;
    const r = withLoose(steps, dir < 0 ? "start" : "end");
    focusField(r.cursor, r.steps);
  };
  /** The blank spot before the first bar or after the last: loose text goes there. */
  const openLoose = (where: "start" | "end") => {
    const r = withLoose(steps, where);
    focusField({ ...r.cursor, offset: "end" }, r.steps);
  };

  /** The text spot on either side of gap i: dir 1 the start of the next step's, -1 the end of the previous one's. */
  const fieldAtGap = (i: number, dir: -1 | 1): Cursor | null => {
    const s = dir > 0 ? steps[i] : steps[i - 1];
    if (!s) return null;
    const part: Part = dir > 0 && !s.free ? "before" : "after";
    return { id: s.id, part, offset: dir > 0 ? 0 : fieldText(s, part).length };
  };

  // Tapping a gap's "|": the cursor goes to the side of it the tap landed on (the end of the text
  // before it, or the start of the text after it; past the first or last bar, the loose text there).
  const openGap = (i: number, side: -1 | 1) => {
    const c = fieldAtGap(i, side);
    if (c) return focusField(c);
    openLoose(side < 0 ? "start" : "end");
  };
  // Tapping blank space in the sequence box: the nearest text spot.
  const tapBlank = (e: React.MouseEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, input, [data-field], [data-step], [data-zone], [data-loose]")) return;
    let best: string | null = null;
    let dist = Infinity;
    stripRef.current?.querySelectorAll<HTMLElement>("[data-zone], [data-field]").forEach((el) => {
      const r = el.getBoundingClientRect();
      // Rows count for more than columns: a tap belongs to the line it's on.
      const d = Math.abs(e.clientX - (r.left + r.width / 2)) + 4 * Math.abs(e.clientY - (r.top + r.height / 2));
      if (d < dist) {
        dist = d;
        best = el.dataset.zone ?? el.dataset.field ?? null;
      }
    });
    if (!best) return;
    if (best === "__start" || best === "__end") return openLoose(best === "__start" ? "start" : "end");
    const [id, part] = (best as string).split(":") as [string, Part];
    focusField({ id, part, offset: "end" });
  };

  // Empty free text goes once the cursor leaves it (it's never saved either: see cleanSteps).
  useEffect(() => {
    const left = steps.filter((s) => !(s.free && !s.name && cur?.id !== s.id));
    if (left.length !== steps.length) onChange(left);
  }, [steps, cur, onChange]);

  /** Typing in a field; a "|" starts a new step (splitAtBar). */
  const typeIn = (id: string, part: Part, v: string, caret: number) => {
    if (v.includes("|")) {
      const r = splitAtBar(steps, id, part, v);
      // The cursor keeps its place from the end of the text (after a paste "a | bc", after "bc").
      const tail = v.length - caret;
      const now = r.steps.find((x) => x.id === r.cursor.id);
      const len = now ? fieldText(now, r.cursor.part).length : 0;
      return focusField({ ...r.cursor, offset: Math.max(0, len - tail) }, r.steps);
    }
    onChange(steps.map((s) => (s.id === id ? withText(s, part, v) : s)));
    setCur({ id, part, offset: caret });
  };

  /** Leave text mode with the cursor gone (back at a gap). */
  const dropCursor = (next: SeqStep[], gap: number) => {
    onChange(next);
    setCur(null);
    setCaret(gap);
  };

  /** ← / → past either end of a field, Backspace at its start, Enter / Escape to finish. */
  const fieldKeys = (id: string, part: Part) => (e: React.KeyboardEvent<HTMLSpanElement>) => {
    const el = e.currentTarget;
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      el.blur();
      return;
    }
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing || !window.getSelection()?.isCollapsed) return;
    const at = caretIn(el);
    const atStart = at === 0;
    const atEnd = at === (el.textContent ?? "").length;
    if ((e.key === "ArrowLeft" && atStart) || (e.key === "ArrowRight" && atEnd)) {
      e.preventDefault();
      goNext({ id, part }, e.key === "ArrowLeft" ? -1 : 1);
    } else if (e.key === "Backspace" && atStart) {
      const r = backspaceAtStart(steps, { id, part });
      if (!r) return;
      e.preventDefault();
      if (r.cursor) focusField(r.cursor, r.steps);
      else dropCursor(r.steps, 0);
    }
  };

  // Keys pressed outside a box (the cursor shown but not focused, or after clicking a chip): ← / →
  // move it, a letter starts typing there.
  useEffect(() => {
    moveRef.current = (dir) => {
      if (cur) {
        const s = steps.find((x) => x.id === cur.id);
        const len = s ? fieldText(s, cur.part).length : 0;
        const o = cur.offset + dir;
        if (o >= 0 && o <= len) return focusField({ ...cur, offset: o });
        goNext(cur, dir);
        return;
      }
      const c = fieldAtGap(at, dir);
      if (c) focusField(c);
    };
    typeRef.current = (char) => {
      const c = cur ?? fieldAtGap(at, -1) ?? fieldAtGap(at, 1);
      if (!c) return false;
      const s = steps.find((x) => x.id === c.id);
      if (!s) return false;
      const text = fieldText(s, c.part);
      const offset = Math.min(c.offset, text.length);
      const v = text.slice(0, offset) + char + text.slice(offset);
      if (v.includes("|")) {
        const r = splitAtBar(steps, c.id, c.part, v);
        focusField(r.cursor, r.steps);
      } else focusField({ id: c.id, part: c.part, offset: offset + 1 }, steps.map((x) => (x.id === c.id ? withText(x, c.part, v) : x)));
      return true;
    };
  });

  // The keyboard's delete (see the key handler above), kept current with this render's steps.
  useEffect(() => {
    eraseRef.current = (key) => {
      if (activeIndex >= 0) return remove();
      if (cur && key === "Backspace") {
        const s = steps.find((x) => x.id === cur.id);
        if (s && cur.offset > 0) {
          const text = fieldText(s, cur.part);
          return focusField({ ...cur, offset: cur.offset - 1 }, steps.map((x) => (x.id === cur.id ? withText(x, cur.part, text.slice(0, cur.offset - 1) + text.slice(cur.offset)) : x)));
        }
        const r = backspaceAtStart(steps, cur);
        if (r?.cursor) return focusField(r.cursor, r.steps);
        if (r) dropCursor(r.steps, 0);
        return;
      }
      const i = key === "Backspace" ? at - 1 : at;
      if (i < 0 || i >= steps.length) return;
      onChange(steps.filter((_, j) => j !== i));
      setCaret(i);
    };
  });

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

  const elementEnter = useEnterToAdd(addOwn);
  const tagEnter = useEnterToAdd(addTag);

  // ---- drag and drop -------------------------------------------------------
  // Drag a step (with its tags, linked instruments and comment, which are all part of it) to a gap
  // between steps. Mouse: press and move. Touch: press and hold, then move (a quick swipe still
  // scrolls the page).
  const [drag, setDrag] = useState<{ id: string; label: string; x: number; y: number; target: number | null } | null>(null);
  const pressed = useRef<{
    id: string;
    index: number;
    x: number;
    y: number;
    touch: boolean;
    timer: number | null;
    el: HTMLElement;
    pointerId: number;
  } | null>(null);
  const dragging = useRef(false);
  const justDragged = useRef(false);

  // While dragging by touch, stop the page scrolling under the finger.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const stop = (e: TouchEvent) => dragging.current && e.preventDefault();
    strip.addEventListener("touchmove", stop, { passive: false });
    return () => strip.removeEventListener("touchmove", stop);
  }, []);

  /** The gap nearest the pointer (rows count for more than columns). */
  function nearestSlot(x: number, y: number): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    stripRef.current?.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(x - (r.left + r.width / 2)) + 3 * Math.abs(y - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = Number(el.dataset.slot);
      }
    });
    return best;
  }

  function beginDrag(id: string, x: number, y: number) {
    const step = steps.find((s) => s.id === id);
    const p = pressed.current;
    if (!step || !p) return;
    // Captured only now, so a plain click still lands on the chip.
    try {
      p.el.setPointerCapture(p.pointerId);
    } catch {
      /* pointer already gone */
    }
    dragging.current = true;
    setActiveId(null);
    setDrag({ id, label: stepLabel(step), x, y, target: nearestSlot(x, y) });
  }

  /** Move the step at `from` into the gap before position `slot`. */
  function moveTo(from: number, target: number) {
    const slot = Math.max(gapMin, Math.min(target, gapMax));
    if (slot === from || slot === from + 1) return;
    const next = [...steps];
    const [s] = next.splice(from, 1);
    const to = slot > from ? slot - 1 : slot;
    next.splice(to, 0, s);
    onChange(next);
    setCaret(to + 1);
    setCur(null);
  }

  function endDrag(drop: { x: number; y: number } | null) {
    const p = pressed.current;
    pressed.current = null;
    if (p?.timer) window.clearTimeout(p.timer);
    if (!dragging.current) return;
    dragging.current = false;
    // The click that follows letting go isn't a click on the chip.
    justDragged.current = true;
    window.setTimeout(() => (justDragged.current = false), 0);
    setDrag(null);
    const target = drop ? nearestSlot(drop.x, drop.y) : null;
    if (p && target != null) moveTo(p.index, target);
  }

  const dragHandlers = (s: SeqStep, i: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const touch = e.pointerType !== "mouse";
      const p = { id: s.id, index: i, x: e.clientX, y: e.clientY, touch, timer: null as number | null, el: e.currentTarget, pointerId: e.pointerId };
      if (touch) {
        p.timer = window.setTimeout(() => {
          if (pressed.current !== p) return;
          beginDrag(p.id, p.x, p.y);
          navigator.vibrate?.(10);
        }, 350);
      }
      pressed.current = p;
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const p = pressed.current;
      if (!p) return;
      if (!dragging.current && e.buttons === 0) {
        // Let go somewhere else before a drag began.
        if (p.timer) window.clearTimeout(p.timer);
        pressed.current = null;
        return;
      }
      const x = e.clientX;
      const y = e.clientY;
      if (dragging.current) {
        setDrag((d) => d && { ...d, x, y, target: nearestSlot(x, y) });
        return;
      }
      if (Math.hypot(x - p.x, y - p.y) < 6) return;
      if (p.touch) {
        // Moved before the hold: it's a scroll, not a drag.
        if (p.timer) window.clearTimeout(p.timer);
        pressed.current = null;
        return;
      }
      beginDrag(p.id, x, y);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => endDrag({ x: e.clientX, y: e.clientY }),
    onPointerCancel: () => endDrag(null),
  });

  // A thin spot between chips with a faint "|". The insertion point shows as a blinking text cursor
  // (hidden while a note box has its own); while dragging, the drop spot shows as an accent bar.
  const slot = (i: number) => {
    const dropHere = drag ? drag.target === i : false;
    const cursorHere = !drag && i === at && !cur;
    return (
      <button
        key={`slot-${i}`}
        type="button"
        data-slot={i}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openGap(i, e.clientX < r.left + r.width / 2 ? -1 : 1);
        }}
        aria-label={i === at ? "Insertion point" : `Insert here (position ${i + 1})`}
        title="Add elements here"
        className="group inline-flex h-6 w-1.5 items-center justify-center align-middle"
      >
        {/* A "|" between elements, like a chord chart; the insertion point shows as the accent bar. */}
        {dropHere ? (
          <span className="h-5 w-1 rounded-full bg-accent" />
        ) : cursorHere ? (
          // The "|" stays; the cursor blinks just after it.
          <span className="flex items-center gap-0.5">
            <span aria-hidden className="text-xs leading-none text-muted/70">
              |
            </span>
            <span className="h-4 w-px bg-foreground [animation:seq-caret_1.06s_steps(1)_infinite]" />
          </span>
        ) : (
          <span aria-hidden className="text-xs leading-none text-muted/70 group-hover:text-accent">
            |
          </span>
        )}
      </button>
    );
  };

  // The blank spot before the first bar or after the last, to tap for loose text.
  const looseZone = (where: "start" | "end") => (
    <span data-zone={where === "start" ? "__start" : "__end"} data-loose="" onClick={() => openLoose(where)} className="inline-block h-6 w-2 cursor-text align-middle" />
  );

  // A step's text spot: the box when it has text or the cursor, else a small blank spot to tap.
  const field = (s: SeqStep, part: Part) => {
    const value = fieldText(s, part);
    const here = cur?.id === s.id && cur.part === part;
    const key = fieldKey(s.id, part);
    if (!value && !here) {
      // 10px: the room between the element and its bars is all tappable.
      return <span data-zone={key} onClick={() => focusField({ id: s.id, part, offset: 0 })} className="inline-block h-6 w-2.5 cursor-text align-middle" />;
    }
    return (
      <TextField
        field={key}
        value={value}
        plain={Boolean(s.free)}
        label={s.free ? "Text" : `${part === "before" ? "Before" : "After"} ${stepLabel(s)}`}
        editing={editing === key}
        caretAt={here && cur && editing !== key && !drag ? Math.min(cur.offset, value.length) : null}
        onPick={(offset) => focusField({ id: s.id, part, offset })}
        onInput={(v, caret) => typeIn(s.id, part, v, caret)}
        onCursor={(offset) => setCur((c) => (c && c.id === s.id && c.part === part && c.offset === offset ? c : { id: s.id, part, offset }))}
        onBlur={(offset) => {
          setEditing((f) => (f === key ? null : f));
          setCur((c) => (c && c.id === s.id && c.part === part ? { ...c, offset } : c));
        }}
        onKey={fieldKeys(s.id, part)}
      />
    );
  };

  return (
    <div ref={rootRef} className="space-y-3">
      <div ref={stripRef} onClick={tapBlank} className="min-h-10 cursor-text select-none rounded-lg border border-border bg-surface p-2 [-webkit-touch-callout:none]">
        {steps.length ? (
          // Inline, like a line of text (32px lines): long text wraps to the next line's start.
          <ol className="leading-8">
            {steps.map((s, i) => (
              <Fragment key={s.id}>
                {/* Loose text: before the first bar, or (after the closing bar) after the last. */}
                {s.loose === "start" && i === 0 ? (
                  <li className="inline">{field(s, "after")}</li>
                ) : s.loose === "end" && i === steps.length - 1 && i > 0 ? (
                  <>
                    <li className="inline">{slot(i)}</li>
                    <li className="inline">{field(s, "after")}</li>
                  </>
                ) : (
                <li className="inline">
                  {i === 0 && looseZone("start")}
                  {slot(i)}
                  {s.free ? (
                    field(s, "after")
                  ) : (
                    <>
                      {field(s, "before")}
                      {/* The whole column drags: the chip and its linked instruments. */}
                      <div
                        data-step=""
                        {...dragHandlers(s, i)}
                        title="Drag to move"
                        className={`inline-block align-middle ${drag ? "cursor-grabbing" : "cursor-grab"} ${drag?.id === s.id ? "opacity-40" : ""}`}
                      >
                        <StepColumn
                          step={s}
                          active={s.id === activeId}
                          onClick={() => {
                            if (justDragged.current) return;
                            setActiveId(s.id === activeId ? null : s.id);
                            setCaret(i + 1);
                            setCur(null);
                          }}
                        />
                      </div>
                      {field(s, "after")}
                    </>
                  )}
                </li>
                )}
              </Fragment>
            ))}
            {steps.at(-1)?.loose !== "end" || steps.length === 1 ? (
              <li className="inline">
                {slot(steps.length)}
                {looseZone("end")}
              </li>
            ) : null}
          </ol>
        ) : (
          <p className="px-1 py-1 text-sm text-muted">Click elements below to build the sequence.</p>
        )}
      </div>
      {/* What's being dragged, following the pointer. */}
      {drag && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[130%] rounded-full border border-accent bg-surface px-2.5 py-1 text-sm font-medium shadow-lg"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.label}
        </div>
      )}

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
            {/* No move arrows: steps are reordered by dragging. Red border always (not just on hover): it deletes the element. */}
            <button type="button" onClick={remove} className="ml-auto rounded-md border border-danger px-2 py-1 text-xs font-medium hover:bg-danger/5 hover:text-danger">
              Remove
            </button>
          </div>
          {/* Phones: 8px more under the Remove row. The new-tag box and Add sit at the right. */}
          <div className="flex flex-wrap items-center gap-1.5 max-sm:pt-2" role="group" aria-label="Tags">
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
            {/* Enter adds the tag: see useEnterToAdd. */}
            <div className="ml-auto flex items-center gap-1">
              {tagEnter.form}
              <input
                value={ownTag}
                onChange={(e) => setOwnTag(e.target.value)}
                placeholder="New tag"
                aria-label="New tag"
                form={tagEnter.formId}
                enterKeyHint="enter"
                className={`${input} h-7 w-28 text-xs`}
              />
              <button type="button" onClick={addTag} disabled={!ownTag.trim()} className={smallBtn}>
                Add
              </button>
            </div>
          </div>
          {/* A little room (8px more) under the tags. */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <span className="text-xs font-medium text-muted" title="Each linked player is told you want more of their instrument here">
              Link:
            </span>
            <LinkSelect selected={active.parts ?? []} onToggle={togglePart} onClear={() => patch(active.id, { parts: [] })} />
          </div>
        </div>
      )}

      {/* A little room between the element buttons and the own-element row under them. */}
      <div className="space-y-3.5">
        <div className="flex flex-wrap gap-1.5">
          {/* Grouped by kind (Verse, Verse 1, Verse 2 → one "Verse ▾"); a lone element adds straight away. */}
          {groupElements(palette).map((g) => (
            <ElementButton key={g.label + g.members[0]} label={g.label} members={g.members} scanned={scanned} onAdd={add} />
          ))}
        </div>
        {/* Own element and Clear share a row on every screen (Clear on the right). Presets sit just
            before Clear from 640px; on phones they wrap to their own line underneath. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-4 sm:gap-y-2">
          <div className="flex items-center gap-1">
            {elementEnter.form}
            <input
              value={ownElement}
              onChange={(e) => setOwnElement(e.target.value)}
              placeholder="Own element, e.g. Tag"
              aria-label="Add your own element"
              form={elementEnter.formId}
              enterKeyHint="enter"
              className={`${input} w-44`}
            />
            <button type="button" onClick={addOwn} disabled={!ownElement.trim()} className={smallBtn}>
              Add
            </button>
          </div>
          {presets.length > 0 && (
            <span className="flex flex-wrap gap-2 max-sm:order-last max-sm:w-full sm:ml-auto">
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
            </span>
          )}
          {steps.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onChange([]);
                setCaret(0);
                setActiveId(null);
              }}
              className={`${smallBtn} ${presets.length > 0 ? "max-sm:ml-auto" : "ml-auto"} hover:border-danger hover:text-danger`}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
