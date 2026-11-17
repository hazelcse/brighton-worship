"use client";

import { useRef } from "react";
import { switchTeam } from "@/app/actions/auth";

/**
 * In the profile menu, for someone on more than one team: a dropdown of their teams. Picking one
 * switches to it straight away (its home page; the media app for a media team).
 */
export function TeamSwitcher({
  teams,
  current,
  className = "",
  compact = false,
}: {
  teams: { slug: string; name: string }[];
  current: string;
  className?: string;
  /** No visible "Team" label (e.g. in the media app's dark header). */
  compact?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={switchTeam} className={className}>
      <label className="block text-xs text-muted">
        <span className={compact ? "sr-only" : ""}>Team</span>
        <select
          name="team"
          defaultValue={current}
          onChange={() => form.current?.requestSubmit()}
          className={`${compact ? "" : "mt-1 w-full"} block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20`}
        >
          {teams.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
