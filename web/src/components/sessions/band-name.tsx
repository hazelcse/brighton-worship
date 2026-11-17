import { partTint, roleColor } from "@/lib/session-plan";

/** A band or crew member's name; the viewer's own gets a highlight in their part's colour (the text keeps its usual colour) (WL and vox have their own). */
export function BandName({ name, role, you }: { name: string; role: string; you?: boolean }) {
  const color = you ? roleColor(role) : null;
  if (!color) return <>{name}</>;
  return (
    <span className="-mx-1 rounded px-1" style={{ backgroundColor: partTint(color) }} title="You">
      {name}
    </span>
  );
}
