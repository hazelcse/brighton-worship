"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { generateRoster } from "@/app/(app)/roster/actions";

/**
 * The worker doesn't report progress, so the ring follows its time budget: up to 45 s for the
 * main solve plus 20 s for the team-mixing pass. It stops short of full until the result is back.
 */
const EXPECTED_MS = 65_000;
const HOLD_AT = 95;

/** Generate the roster, then open it on its own page. */
export function GenerateControls({ rosterId, hasResult }: { rosterId: string; hasResult: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (startedAt === null || done) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [startedAt, done]);

  const running = pending || startedAt !== null;
  const pct = done ? 100 : startedAt === null ? 0 : Math.min(HOLD_AT, ((now - startedAt) / EXPECTED_MS) * 100);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={running}
        onClick={() => {
          setError(null);
          setDone(false);
          const t = Date.now();
          setStartedAt(t);
          setNow(t);
          start(async () => {
            const r = await generateRoster(rosterId);
            if (r.ok) {
              setDone(true);
              router.push(`/roster/${rosterId}/generated`);
            } else {
              setStartedAt(null);
              setError(r.message ?? "Couldn't generate the roster.");
            }
          });
        }}
        className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60"
      >
        {running ? "Generating… (up to a minute)" : hasResult ? "Generate again" : "Generate roster"}
      </button>
      {running && <ProgressRing pct={pct} />}
      {hasResult && !running && (
        <Link
          href={`/roster/${rosterId}/generated`}
          className="rounded-lg border border-ink px-5 py-2.5 text-sm font-medium text-ink hover:bg-ink hover:text-ink-foreground"
        >
          View generated roster
        </Link>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const shown = Math.round(pct);
  return (
    <div
      role="progressbar"
      aria-label="Generating the roster (estimated)"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      title="Estimated from the optimiser's time limit"
      className="relative h-10 w-10 shrink-0"
    >
      <svg viewBox="0 0 40 40" className="h-10 w-10 -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-border" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="stroke-accent transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums">{shown}%</span>
    </div>
  );
}
