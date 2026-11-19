import { Fragment } from "react";

/**
 * Notes in a sequence, slanted gently (7°, the `slant` class) rather than in the browser's italic:
 * Geist has no italic of its own and the browser's made-up one leans about twice as far. A skew
 * only works on a box, so each word is its own little box, and the text still wraps between words.
 */
export function SlantWords({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((w, i) =>
        /^\s*$/.test(w) ? <Fragment key={i}>{w}</Fragment> : (
          <span key={i} className="slant inline-block">
            {w}
          </span>
        ),
      )}
    </>
  );
}
