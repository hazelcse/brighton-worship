"use client";

import { useHighlight, type Where } from "./highlight";

/** "Met" / "Missed 3×" badge. When missed, clicking it highlights where on the roster (light yellow). */
export function MissBadge({ ruleId, ok, text, where }: { ruleId: string; ok: boolean; text: string; where?: Where[] }) {
  const ctx = useHighlight();
  const base = `shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`;
  if (ok || !ctx || !where?.length) return <span className={base}>{text}</span>;
  const on = ctx.highlight?.ruleId === ruleId;
  return (
    <button
      type="button"
      data-keep-highlight
      aria-pressed={on}
      title={on ? "Hide on the roster" : "Show where on the roster"}
      onClick={() => ctx.setHighlight(on ? null : { ruleId, where })}
      className={`${base} cursor-pointer ring-amber-400 hover:ring-1 ${on ? "ring-2" : ""}`}
    >
      {text}
    </button>
  );
}
