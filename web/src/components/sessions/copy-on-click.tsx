"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { PlanCopy } from "@/components/sessions/plan-text";

/** Copy formatted (bold, underline, indents, links, red) where the paste takes it, plain text elsewhere. */
export async function copyPlan({ text, html }: PlanCopy): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
  } else await navigator.clipboard.writeText(text);
}

/**
 * A run sheet box that copies itself when clicked or tapped (worship leaders, once published): the
 * simplified view copies the run sheet, Show changes the run sheet with what's new in red. Clicks on
 * a link, or that end a text selection, don't copy. `copy`: what to copy (none: the box is just text).
 * Gives the box's props, a "Copied" badge to put inside it, and a one-line hint to put under it.
 */
export function useCopyOnClick(copy: (() => PlanCopy) | undefined, what: string) {
  const [state, setState] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);
  if (!copy) return { props: {}, className: "", badge: null, hint: null };

  async function run() {
    try {
      await copyPlan(copy!());
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(null), 2000);
  }
  const props = {
    tabIndex: 0,
    "aria-description": `Click to copy ${what}`,
    title: `Click to copy ${what}`,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if ((e.target as Element).closest("a, button, input, textarea, select")) return;
      // Selecting some words (to copy just those) isn't a tap on the box.
      if (window.getSelection()?.toString()) return;
      void run();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      void run();
    },
  };
  // In the app's own font, not the run sheet's Arial.
  const badge: ReactNode = state && (
    <span
      role="status"
      style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
      className={`pointer-events-none absolute right-3 top-3 rounded-full px-2.5 py-0.5 text-xs font-medium shadow-sm ${state === "copied" ? "bg-ink text-ink-foreground" : "bg-red-50 text-danger"}`}
    >
      {state === "copied" ? "Copied" : "Couldn't copy"}
    </span>
  );
  const hint: ReactNode = <p className="-mt-2 text-xs text-muted">Tap or click the box to copy {what}.</p>;
  return { props, className: "relative cursor-pointer transition-colors hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30", badge, hint };
}
