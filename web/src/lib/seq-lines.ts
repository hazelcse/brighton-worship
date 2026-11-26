import { isLongComment, shortName, type SeqStep } from "@/lib/session-plan";

/* How the simplified view lays a sequence out in lines (the page and the text worship leaders copy). */

const isChorus = (s: SeqStep | undefined) => Boolean(s && !s.free && /^chorus\b/i.test(s.name.trim()));
/** V1, C... for an element; free text (| Transpose to E |) as written, upright like an element. */
export const label = (s: SeqStep) => (s.free ? s.name : shortName(s.name));

/** How much room a step takes on a line, roughly in characters (with its " | "). A long comment has a line of its own. */
const width = (s: SeqStep) =>
  label(s).length +
  (s.before ? s.before.length + 1 : 0) +
  (s.repeat > 1 ? 3 : 0) +
  (s.tags.length ? s.tags.join(", ").length + 3 : 0) +
  (s.comment && !isLongComment(s.comment) ? s.comment.length + 1 : 0) +
  3;

/**
 * The sequence split into lines. A step with a long comment has a line of its own (the comment goes
 * under it); the steps in between are evened out into lines (see balanced).
 */
export function lines(steps: SeqStep[]): SeqStep[][] {
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

