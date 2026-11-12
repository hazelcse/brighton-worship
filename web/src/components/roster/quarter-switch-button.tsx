"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Quarter = { href: string; heading: string; range: string };

const HOLD_MS = 450;
const MOVE_TOLERANCE = 10;

/**
 * One card for this quarter's roster (phones for everyone; every screen for root and developers).
 * Holding it (touch or mouse) flips it to next quarter's roster and back; a tap or click opens
 * whichever one it's showing.
 */
export function QuarterSwitchButton({ current, next, className = "" }: { current: Quarter; next: Quarter; className?: string }) {
  const [showNext, setShowNext] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => clear, []);

  const shown = showNext ? next : current;

  return (
    <Link
      href={shown.href}
      aria-label={`${shown.heading}, ${shown.range}. Press and hold to switch to ${showNext ? "this" : "next"} quarter.`}
      className={`group flex flex-1 select-none items-center justify-between gap-3 rounded-xl px-4 py-3 transition [-webkit-touch-callout:none] active:scale-[0.99] ${
        showNext ? "border border-border bg-surface hover:border-accent/50" : "bg-ink text-ink-foreground hover:bg-ink/90"
      } ${className}`}
      draggable={false}
      title={`Hold to switch to ${showNext ? "this" : "next"} quarter`}
      onPointerDown={(e) => {
        held.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          held.current = true;
          timer.current = null;
          setShowNext((v) => !v);
          navigator.vibrate?.(10);
        }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > MOVE_TOLERANCE) clear();
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        // The release that ends a hold isn't a tap.
        if (held.current) {
          e.preventDefault();
          held.current = false;
        }
      }}
    >
      <span key={showNext ? "next" : "current"} className="min-w-0 animate-[quarter-flip_180ms_ease-out]">
        <span className={`block text-xs uppercase tracking-wider ${showNext ? "text-muted" : "text-ink-foreground/60"}`}>
          {shown.heading}
        </span>
        <span className="font-medium">{shown.range}</span>
      </span>
      <span className="flex items-center gap-3">
        <span aria-hidden className="flex gap-1">
          <span className={`size-1.5 rounded-full ${showNext ? "bg-muted/40" : "bg-ink-foreground"}`} />
          <span className={`size-1.5 rounded-full ${showNext ? "bg-foreground" : "bg-ink-foreground/30"}`} />
        </span>
        <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
      </span>
    </Link>
  );
}
