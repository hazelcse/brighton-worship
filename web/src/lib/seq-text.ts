import { insertElement, step, type SeqStep } from "@/lib/session-plan";

/**
 * Typing in the sequence builder. A sequence reads like | before (Element) after | Free text | ...:
 * everything between two bars belongs to that bar's step. An element step has two text fields
 * ("before" and "after", stored as `before` and `comment`); a free step (no element) has one, its
 * own text, which counts as "after".
 */
export type Part = "before" | "after";
export type Cursor = { id: string; part: Part; offset: number };

export const fieldText = (s: SeqStep, part: Part): string => (s.free ? s.name : part === "before" ? (s.before ?? "") : (s.comment ?? ""));

export function withText(s: SeqStep, part: Part, v: string): SeqStep {
  if (s.free) return { ...s, name: v.slice(0, 160) };
  const t = v.slice(0, 160) || undefined;
  return part === "before" ? { ...s, before: t } : { ...s, comment: t };
}

const freeStep = (text: string): SeqStep => ({ ...step(text), name: text, free: true });
const looseStep = (text: string, loose: "start" | "end"): SeqStep => ({ ...freeStep(text), loose });
/** The same step, enclosed by bars now (no longer loose). */
const enclosed = (s: SeqStep): SeqStep => {
  const rest = { ...s };
  delete rest.loose;
  return rest;
};

/**
 * The loose text spot before the first bar (or after the last), made (empty) if there's none, so
 * the cursor can go there. Empty loose text goes again once the cursor leaves it.
 */
export function withLoose(steps: SeqStep[], where: "start" | "end"): { steps: SeqStep[]; cursor: Cursor } {
  const have = where === "start" ? steps[0] : steps.at(-1);
  if (have?.loose === where) return { steps, cursor: { id: have.id, part: "after", offset: where === "start" ? have.name.length : 0 } };
  const s = looseStep("", where);
  return { steps: where === "start" ? [s, ...steps] : [...steps, s], cursor: { id: s.id, part: "after", offset: 0 } };
}
const join = (a: string, b: string) => (a && b ? `${a} ${b}` : a || b);
const replaceAt = (steps: SeqStep[], i: number, ...with_: SeqStep[]) => [...steps.slice(0, i), ...with_, ...steps.slice(i + 1)];

/** The text fields in reading order: before and after each element, the one text of a free step. */
export function fields(steps: SeqStep[]): { id: string; part: Part }[] {
  return steps.flatMap((s) => (s.free ? [{ id: s.id, part: "after" as Part }] : [{ id: s.id, part: "before" as Part }, { id: s.id, part: "after" as Part }]));
}

/** The field next to this one (dir -1 / 1), with the cursor at its near end; null at either end. */
export function neighbour(steps: SeqStep[], c: { id: string; part: Part }, dir: -1 | 1): Cursor | null {
  const all = fields(steps);
  const k = all.findIndex((f) => f.id === c.id && f.part === c.part);
  const f = all[k + dir];
  if (k < 0 || !f) return null;
  const s = steps.find((x) => x.id === f.id)!;
  return { ...f, offset: dir > 0 ? 0 : fieldText(s, f.part).length };
}

/**
 * Typing "|" in a field starts a new step there: the text after it becomes a free step (or, typed
 * in a "before" field, the text before it does). A "|" right after an existing bar is ignored.
 */
export function splitAtBar(steps: SeqStep[], id: string, part: Part, value: string): { steps: SeqStep[]; cursor: Cursor } {
  const k = value.indexOf("|");
  const i = steps.findIndex((s) => s.id === id);
  const s = steps[i];
  if (k < 0 || !s) return { steps: s ? replaceAt(steps, i, withText(s, part, value)) : steps, cursor: { id, part, offset: value.length } };
  const left = value.slice(0, k).trimEnd();
  const right = value.slice(k + 1).trimStart();
  let out: { steps: SeqStep[]; cursor: Cursor };
  if (s.loose === "start") {
    // Before the first bar: the words before the new bar stay outside; those after are enclosed now.
    const next = freeStep(right);
    out = { steps: replaceAt(steps, i, ...(left.trim() ? [withText(s, "after", left)] : []), next), cursor: { id: next.id, part: "after", offset: 0 } };
  } else if (s.loose === "end") {
    // After the last bar: the words before the new bar are enclosed now; those after stay outside.
    const next = looseStep(right, "end");
    out = { steps: replaceAt(steps, i, ...(left.trim() ? [enclosed(withText(s, "after", left))] : []), next), cursor: { id: next.id, part: "after", offset: 0 } };
  } else if (part === "before" && !s.free) {
    if (!left.trim()) out = { steps: replaceAt(steps, i, withText(s, "before", right)), cursor: { id, part, offset: 0 } };
    else out = { steps: replaceAt(steps, i, freeStep(left), withText(s, "before", right)), cursor: { id, part: "before", offset: 0 } };
  } else if (s.free && !left.trim()) {
    out = { steps: replaceAt(steps, i, withText(s, "after", right)), cursor: { id, part: "after", offset: 0 } };
  } else {
    const next = freeStep(right);
    out = { steps: replaceAt(steps, i, withText(s, "after", left), next), cursor: { id: next.id, part: "after", offset: 0 } };
  }
  // More bars (pasted text): split again in the new field.
  const c = out.cursor;
  const t = fieldText(out.steps.find((x) => x.id === c.id)!, c.part);
  return t.includes("|") ? splitAtBar(out.steps, c.id, c.part, t) : out;
}

/**
 * An element button pressed with the text cursor at `c`: the element goes in right there. Text
 * before the cursor stays in front of it and text after it follows it, in the same step when that
 * step has no element yet (free text), otherwise in a step of its own. The cursor ends up just
 * after the new element.
 */
export function insertAtCursor(steps: SeqStep[], c: Cursor, name: string): { steps: SeqStep[]; cursor: Cursor } | null {
  const i = steps.findIndex((s) => s.id === c.id);
  const s = steps[i];
  if (!s) return null;
  const text = fieldText(s, c.part);
  const l = text.slice(0, c.offset).trimEnd();
  const r = text.slice(c.offset).trimStart();
  if (s.loose === "start") {
    // l | (Element) r |: the element needs bars, so the words after the cursor go in with it.
    const el: SeqStep = { ...step(name), ...(r ? { comment: r } : {}) };
    return { steps: replaceAt(steps, i, ...(l ? [withText(s, "after", l)] : []), el), cursor: { id: el.id, part: "after", offset: 0 } };
  }
  if (s.loose === "end") {
    // | l (Element) | r: the words before the cursor go in with it; the rest stays outside.
    const el: SeqStep = { ...step(name), ...(l ? { before: l } : {}) };
    return { steps: replaceAt(steps, i, el, ...(r ? [withText(s, "after", r)] : [])), cursor: { id: el.id, part: "after", offset: 0 } };
  }
  if (s.free) {
    const el: SeqStep = { id: s.id, name, repeat: 1, tags: [], ...(l ? { before: l } : {}), ...(r ? { comment: r } : {}) };
    return { steps: replaceAt(steps, i, el), cursor: { id: s.id, part: "after", offset: 0 } };
  }
  if (c.part === "before") {
    if (!l) {
      const res = insertElement(steps, i, name);
      return { steps: res.steps, cursor: { id: res.steps[res.at - 1].id, part: "after", offset: 0 } };
    }
    const el: SeqStep = { ...step(name), before: l };
    return { steps: replaceAt(steps, i, el, withText(s, "before", r)), cursor: { id: el.id, part: "after", offset: 0 } };
  }
  if (!r) {
    const res = insertElement(steps, i + 1, name);
    const placed = res.steps[res.at - 1];
    return { steps: res.steps, cursor: { id: placed.id, part: "after", offset: fieldText(placed, "after").length } };
  }
  const el: SeqStep = { ...step(name), comment: r };
  return { steps: replaceAt(steps, i, withText(s, "after", l), el), cursor: { id: el.id, part: "after", offset: 0 } };
}

/**
 * Backspace at the very start of a field. Right after an element it deletes the element (its text
 * stays, as free text). Right after a bar it deletes the bar, joining the two steps, unless both
 * have an element (a step holds one): then the cursor just moves back.
 */
export function backspaceAtStart(steps: SeqStep[], c: { id: string; part: Part }): { steps: SeqStep[]; cursor: Cursor | null } | null {
  const i = steps.findIndex((s) => s.id === c.id);
  const s = steps[i];
  if (!s) return null;
  if (!s.free && c.part === "after") {
    const before = s.before ?? "";
    const text = join(before, s.comment ?? "");
    if (!text) {
      const prev = steps[i - 1];
      return { steps: replaceAt(steps, i), cursor: prev ? { id: prev.id, part: "after", offset: fieldText(prev, "after").length } : null };
    }
    return { steps: replaceAt(steps, i, { ...freeStep(text), id: s.id }), cursor: { id: s.id, part: "after", offset: before.length + (before && s.comment ? 1 : 0) } };
  }
  const prev = steps[i - 1];
  if (!prev) return null;
  if (!prev.free && !s.free) return { steps, cursor: { id: prev.id, part: "after", offset: fieldText(prev, "after").length } };
  const a = fieldText(prev, "after");
  if (prev.free && !s.free) {
    const b = s.before ?? "";
    return { steps: [...steps.slice(0, i - 1), withText(s, "before", join(a, b)), ...steps.slice(i + 1)], cursor: { id: s.id, part: "before", offset: a.length + (a && b ? 1 : 0) } };
  }
  const b = s.name;
  // Deleting the last bar: the loose text after it joins the step before it (enclosed already).
  return { steps: [...steps.slice(0, i - 1), withText(prev, "after", join(a, b)), ...steps.slice(i + 1)], cursor: { id: prev.id, part: "after", offset: a.length + (a && b ? 1 : 0) } };
}
