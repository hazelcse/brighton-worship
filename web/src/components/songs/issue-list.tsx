type Issue = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  /** Who it's from, shown in bold before the message, e.g. "Scanner". */
  source?: string;
  /** Shown muted after the message, e.g. the date. */
  note?: string;
};

const STYLE = {
  error: { box: "border-red-200 bg-red-50 text-red-900", icon: "✕", label: "Problem" },
  // Rose, not amber: amber is the app's accent colour, so it read as branding rather than a problem.
  warning: { box: "border-rose-100 bg-rose-50/70 text-rose-900", icon: "!", label: "Check" },
  info: { box: "border-stone-200 bg-stone-50 text-stone-700", icon: "i", label: "Note" },
} as const;

/** Scanner messages, most serious first. */
export function IssueList({ issues, compact = false }: { issues: Issue[]; compact?: boolean }) {
  if (!issues.length) return null;
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <ul className={compact ? "mt-2 space-y-1" : "space-y-2"}>
      {sorted.map((i, n) => {
        const s = STYLE[i.severity];
        return (
          <li key={`${i.code}-${n}`} className={`flex gap-2 rounded-lg border px-3 ${compact ? "py-1.5 text-xs" : "py-2 text-sm"} ${s.box}`}>
            <span aria-hidden className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-current/10 text-[10px] font-bold">
              {s.icon}
            </span>
            <span className="whitespace-pre-line">
              <span className="sr-only">{s.label}: </span>
              {i.source && <span className="font-semibold">{i.source}: </span>}
              {i.message}
              {i.note && <span className="opacity-70"> ({i.note})</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
