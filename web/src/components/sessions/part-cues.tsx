import { partInfo, partTint, type PartCue } from "@/lib/session-plan";

/**
 * Tells a player where the worship leaders want more of their instrument: "More drums in:
 * Way Maker: Chorus x2 (High), Bridge". Nothing if there are no such parts.
 */
export function PartCues({ role, cues }: { role: string | null; cues: PartCue[] }) {
  const part = role ? partInfo(role) : undefined;
  if (!part || !cues.length) return null;
  return (
    <div role="note" className="rounded-lg border-2 px-3 py-2 text-sm" style={{ borderColor: part.color, background: partTint(part.color) }}>
      <p className="font-semibold" style={{ color: part.color }}>
        The worship leaders want more {part.label.toLowerCase()} in:
      </p>
      <ul className="mt-1 space-y-0.5">
        {cues.map((c, i) => (
          <li key={i}>
            <span className="font-medium">{c.title}</span>
            <span className="text-muted">: {c.steps.join(", ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
