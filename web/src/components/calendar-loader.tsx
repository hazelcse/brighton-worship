"use client";

import { useEffect, useState } from "react";

/**
 * Roster pages' loading indicator: three little calendar pages (the next three Sundays) that flip
 * over one after another, each turning to the Sunday after, with "Loading" and dots underneath
 * (the same dots as NoteLoader). All CSS (see .calendar-loader in globals.css): it fades in only
 * after 300ms, so quick loads show nothing, and with "reduce motion" on, the pages stay still.
 *
 * Each flip starts and ends edge-on (invisible), so the date moves on a week between flips.
 */

/** The next Sunday on or after today, as a local date at midnight. */
function nextSunday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d;
}

function addWeeks(d: Date, weeks: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + weeks * 7);
  return out;
}

export function CalendarLoader({ label = "Loading", className = "" }: { label?: string; className?: string }) {
  // The server pre-renders this without knowing the viewer's date, so the dates are filled in the browser.
  const [dates, setDates] = useState<(Date | null)[]>([null, null, null]);
  useEffect(() => {
    const first = nextSunday();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- dates only after hydration, see above
    setDates([0, 1, 2].map((i) => addWeeks(first, i)));
  }, []);

  // Each page has flipped over: show the Sunday three weeks on, so the row keeps counting forward.
  const turn = (i: number) => setDates((ds) => ds.map((d, j) => (j === i && d ? addWeeks(d, 3) : d)));

  return (
    <div role="status" className={`calendar-loader flex flex-col items-center justify-center gap-3 text-muted ${className}`}>
      {/* Sized and coloured like NoteLoader's symbols (text-3xl, foreground/70): drawn in currentColor. */}
      <div aria-hidden className="flex items-end gap-3 text-foreground/70 [perspective:200px]">
        {dates.map((d, i) => (
          <div
            key={i}
            className="calendar-loader-page flex h-[30px] w-[26px] flex-col overflow-hidden rounded-[4px] border-[1.5px] border-current text-center"
            style={{ animationDelay: `${i * 0.25}s` }}
            onAnimationIteration={() => turn(i)}
          >
            <span className="h-[7px] shrink-0 bg-current" />
            <span className="flex flex-1 items-center justify-center text-xs leading-none">{d ? d.getDate() : ""}</span>
          </div>
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
