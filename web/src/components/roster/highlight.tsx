"use client";

import { createContext, useContext, useEffect, useState } from "react";

/** Where a rule was missed: these people on these dates (no people = everyone on those dates). */
export type Where = { members: string[]; dates: string[] };
type Highlight = { ruleId: string; where: Where[] } | null;

const Ctx = createContext<{ highlight: Highlight; setHighlight: (h: Highlight) => void } | null>(null);

/** Shares the "show me where this rule was missed" selection between the rules panel and the roster. */
export function HighlightProvider({ children }: { children: React.ReactNode }) {
  const [highlight, setHighlight] = useState<Highlight>(null);
  // Clicking anywhere except the roster or a rule badge clears it.
  useEffect(() => {
    if (!highlight) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-keep-highlight]")) setHighlight(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [highlight]);
  return <Ctx.Provider value={{ highlight, setHighlight }}>{children}</Ctx.Provider>;
}

export function useHighlight() {
  return useContext(Ctx);
}

/** Is this person (or, for whole-day misses, anyone) on this date part of a highlighted miss? */
export function isHighlighted(h: Highlight, memberId: string, date: string): boolean {
  return Boolean(h?.where.some((w) => w.dates.includes(date) && (w.members.length === 0 || w.members.includes(memberId))));
}
