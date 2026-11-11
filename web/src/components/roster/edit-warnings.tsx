"use client";

import { useSyncExternalStore } from "react";
import type { Warning } from "@/lib/roster-check";

const storageKey = (rosterId: string) => `roster-warnings-dismissed:${rosterId}`;

// Dismissed soft warnings live in this browser's localStorage (a per-viewer convenience).
const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function read(rosterId: string): string {
  try {
    return localStorage.getItem(storageKey(rosterId)) ?? "[]";
  } catch {
    return "[]";
  }
}
function parse(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Top of the side panel. Hard problems (empty places, someone who can't do the part, broken hard
 * rules) always show and can't be closed. Soft warnings (score got worse) can be closed with ×;
 * that's remembered in this browser until the warning changes.
 */
export function EditWarnings({ rosterId, hard, soft }: { rosterId: string; hard: Warning[]; soft: Warning[] }) {
  const raw = useSyncExternalStore(subscribe, () => read(rosterId), () => "[]");
  const dismissed: string[] = parse(raw);
  const dismiss = (id: string) => {
    try {
      localStorage.setItem(storageKey(rosterId), JSON.stringify([...dismissed, id]));
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((l) => l());
  };
  const visibleSoft = soft.filter((w) => !dismissed.includes(w.id));
  if (!hard.length && !visibleSoft.length) return null;

  return (
    <div className="space-y-2">
      {hard.length > 0 && (
        <section role="alert" aria-labelledby="hard-problems-title" className="space-y-1.5 rounded-xl border border-red-300 bg-red-50 p-3 text-red-900">
          <h2 id="hard-problems-title" className="flex items-center gap-1.5 text-sm font-semibold">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            {hard.length} {hard.length === 1 ? "problem" : "problems"} to fix
          </h2>
          <ul className="list-inside list-disc space-y-1 text-xs">
            {hard.map((w) => (
              <li key={w.id}>{w.text}</li>
            ))}
          </ul>
          <p className="text-[11px] text-red-800">These stay until the roster is fixed, even after saving or publishing.</p>
        </section>
      )}
      {visibleSoft.map((w) => (
        <div key={w.id} role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="min-w-0 flex-1">{w.text}</p>
          <button type="button" aria-label="Dismiss warning" onClick={() => dismiss(w.id)} className="-mr-1 rounded p-0.5 text-amber-700 hover:bg-amber-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
