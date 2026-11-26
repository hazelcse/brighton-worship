/*
 * A song's notes in a session plan can hold a bulleted list: a line typed as "- " becomes "• ", and
 * the views show such lines as a dot list. Other lines stay as written.
 */

export const BULLET = "• ";

/** A line that's a bullet point: "• Keys first" (or "- Keys first", typed elsewhere or imported). */
const bulletText = (line: string): string | null => {
  const m = /^\s*(?:•|-)\s+(.*)$/.exec(line);
  return m ? m[1] : null;
};

export type NoteBlock = { kind: "list"; items: string[] } | { kind: "text"; text: string };

/** The notes as runs of bullet points and plain lines (blank lines at either end left out). */
export function noteBlocks(notes: string): NoteBlock[] {
  const out: NoteBlock[] = [];
  for (const line of notes.trim().split("\n")) {
    const b = bulletText(line);
    const last = out.at(-1);
    if (b !== null) {
      if (last?.kind === "list") last.items.push(b);
      else out.push({ kind: "list", items: [b] });
    } else if (last?.kind === "text") last.text += `\n${line}`;
    else out.push({ kind: "text", text: line });
  }
  return out;
}

/** Typing in the notes box: "- " at the start of a line becomes "• " (the cursor stays after it). */
export function bulletOnType(el: HTMLTextAreaElement): void {
  const at = el.selectionStart;
  if (at !== el.selectionEnd || at < 2) return;
  const start = el.value.lastIndexOf("\n", at - 1) + 1;
  if (at - start === 2 && el.value.slice(start, at) === "- ") el.setRangeText(BULLET, start, at, "end");
}

/**
 * Enter on a bullet point starts the next one; Enter on an empty one ends the list (the bullet
 * goes). Returns true when it handled the key.
 */
export function bulletOnEnter(el: HTMLTextAreaElement): boolean {
  const at = el.selectionStart;
  if (at !== el.selectionEnd) return false;
  const start = el.value.lastIndexOf("\n", at - 1) + 1;
  const line = el.value.slice(start, at);
  if (!line.startsWith(BULLET)) return false;
  if (line === BULLET && el.value.slice(at).split("\n")[0] === "") el.setRangeText("", start, at, "end");
  else el.setRangeText(`\n${BULLET}`, at, at, "end");
  return true;
}
