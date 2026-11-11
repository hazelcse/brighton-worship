"use client";

import { useState, useTransition } from "react";
import { createRoster } from "@/app/(app)/roster/actions";

type Option = { start: string; label: string; range: string; hasDraft: boolean; hasPublished: boolean };

export function QuarterPicker({ options }: { options: Option[] }) {
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {options.map((o) => (
          <li key={o.start}>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setChosen(o.start);
                setError(null);
                start(async () => {
                  const r = await createRoster(o.start);
                  if (r && !r.ok) setError(r.message);
                });
              }}
              className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-accent/50 disabled:opacity-60"
            >
              <span className="font-medium">{o.label}</span>
              <span className="text-sm text-muted">{o.range}</span>
              <span className="ml-auto text-sm">
                {pending && chosen === o.start ? (
                  "Setting up…"
                ) : o.hasDraft ? (
                  <span className="text-amber-700">Continue draft →</span>
                ) : o.hasPublished ? (
                  <span className="text-muted">Published · plan a new version →</span>
                ) : (
                  <span className="text-accent">Plan →</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
