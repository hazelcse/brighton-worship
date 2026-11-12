"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Wraps the roster table with a small triangle in the gutter to its left, like Excel's hidden-row
 * marker. It sits level with the top of the row marked `data-past-boundary` (this week's first
 * row, with its bold top line), whether the past rows above it are shown or hidden.
 */
export function PastRowsFrame({
  hidden,
  count,
  onToggle,
  children,
}: {
  hidden: boolean;
  /** How many past sessions there are (shown or not). */
  count: number;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const row = el.querySelector<HTMLElement>("[data-past-boundary]");
      // Centred on the row's top border (the bold line), not just its top edge.
      const line = row ? parseFloat(getComputedStyle(row).borderTopWidth) || 0 : 0;
      setTop(row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top + line / 2 : null);
    };
    measure();
    // Rows change height as the window (and so the columns) change width.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const table = el.querySelector("table");
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, [hidden, count, children]);

  const label = hidden
    ? `Show ${count} past ${count === 1 ? "session" : "sessions"}`
    : `Hide ${count} past ${count === 1 ? "session" : "sessions"}`;

  return (
    <div ref={frame} className="relative">
      {children}
      {top !== null && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!hidden}
          aria-label={label}
          title={label}
          style={{ top }}
          // In the page's side padding (16px on phones), centred on the row's top line. The
          // ::before widens the tap area without moving the triangle.
          className="absolute right-full grid h-6 w-4 -translate-y-1/2 place-items-center text-muted before:absolute before:-inset-x-1 before:-inset-y-1 before:content-[''] hover:text-foreground focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden
            className={`transition-transform ${hidden ? "" : "rotate-90"}`}
          >
            <path d="M2 0.5 L9 5 L2 9.5 Z" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
  );
}
