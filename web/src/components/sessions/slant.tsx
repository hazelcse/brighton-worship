import { Fragment } from "react";
import { noteParts, unbracket } from "@/lib/seq-text";

/**
 * Notes in a sequence, slanted gently (7°, the `slant` class) rather than in the browser's italic:
 * Geist has no italic of its own and the browser's made-up one leans about twice as far. A skew
 * only works on a box, so each word is its own little box, and the text still wraps between words.
 * Notes typed in <angle brackets> lose the brackets here; `raw` keeps them (the builder, where the
 * text is being written and the cursor has to land on the letter tapped).
 */
export function SlantWords({ text, raw = false }: { text: string; raw?: boolean }) {
  const shown = raw ? text : noteParts(text).map((p) => (p.note ? unbracket(p.text) : p.text)).join("");
  return (
    <>
      {shown.split(/(\s+)/).map((w, i) =>
        /^\s*$/.test(w) ? <Fragment key={i}>{w}</Fragment> : (
          <span key={i} className="slant inline-block">
            {w}
          </span>
        ),
      )}
    </>
  );
}

/**
 * Free text (| Transpose to E |), upright, with any <notes> in it muted and slanted like the
 * sequence's other notes: | <here!> Transpose to E <play | C> | reads "here! Transpose to E play | C".
 * `noteClass`: the notes' size and colour. `raw`: keep the brackets (see SlantWords).
 */
export function FreeText({ text, noteClass = "text-xs text-muted", raw = false }: { text: string; noteClass?: string; raw?: boolean }) {
  return (
    <>
      {noteParts(text).map((p) =>
        p.note ? (
          <span key={p.from} className={noteClass}>
            <SlantWords text={raw ? p.text : unbracket(p.text)} raw />
          </span>
        ) : (
          <Fragment key={p.from}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
