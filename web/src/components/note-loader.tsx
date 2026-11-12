"use client";

import { useEffect, useState } from "react";

/**
 * Song pages' loading indicator: three music symbols bouncing on the spot, with "Loading" and dots
 * that go . → .. → ... and round again. All CSS (see .note-loader in globals.css): it fades in only
 * after 300ms, so quick loads show nothing, and with "reduce motion" on, the notes stay still.
 *
 * Plain text symbols, so they're drawn by the device's own symbol font (no font is loaded here).
 */

// Crotchet, minim, beamed quavers, beamed semiquavers, then crotchet, quaver and semiquaver rests.
const SYMBOLS = ["♩", "\u{1D15E}", "♫", "♬", "\u{1D13D}", "\u{1D13E}", "\u{1D13F}"];

/** Three different symbols. Picked in the browser: the server pre-renders this, always crotchets. */
function pickThree(): string[] {
  const pool = [...SYMBOLS];
  return Array.from({ length: 3 }, () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
}

export function NoteLoader({ label = "Loading", className = "" }: { label?: string; className?: string }) {
  const [notes, setNotes] = useState<string[]>([SYMBOLS[0], SYMBOLS[0], SYMBOLS[0]]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- random only after hydration, see pickThree
    setNotes(pickThree());
  }, []);
  return (
    <div role="status" className={`note-loader flex flex-col items-center justify-center gap-3 text-muted ${className}`}>
      <div aria-hidden className="flex items-end gap-3 text-3xl leading-none text-foreground/70">
        {notes.map((n, i) => (
          <span key={i} className="note-loader-note" style={{ animationDelay: `${i * 0.15}s` }}>
            {n}
          </span>
        ))}
      </div>
      <p className="text-sm">
        {label}
        <span aria-hidden className="note-loader-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  );
}
