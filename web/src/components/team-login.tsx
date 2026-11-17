"use client";

import { useEffect, useRef, useState } from "react";
import { LoginButton } from "@/components/login-dialog";

type TeamOption = { slug: string; name: string };

const HOLD_MS = 450; // same as the roster page's hold-to-switch quarter card
const COOKIE = "bw-login"; // LOGIN_KIND_COOKIE in lib/teams.ts

/**
 * The landing page title and log-in button. Pressing and holding the title switches between the
 * kinds of team ("Brighton Worship" ↔ "Brighton Media"); logging in opens the team of the kind
 * showing that the person is on (e.g. Main Worship or Youth Worship). `slug` here is the kind.
 */
export function TeamLogin({ teams, initial, children }: { teams: TeamOption[]; initial: string; children?: React.ReactNode }) {
  const [index, setIndex] = useState(() => Math.max(0, teams.findIndex((t) => t.slug === initial)));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const team = teams[index] ?? { slug: initial, name: "Brighton Worship" };
  const canSwitch = teams.length > 1;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  function startHold() {
    if (!canSwitch || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const n = (index + 1) % teams.length;
      setIndex(n);
      // Remember it, so the page opens on this team next time.
      document.cookie = `${COOKIE}=${teams[n].slug}; path=/; max-age=31536000; samesite=lax`;
      navigator.vibrate?.(10);
    }, HOLD_MS);
  }

  // "Brighton Worship" → "Brighton" / "Worship" on two lines, as the title always was.
  const space = team.name.indexOf(" ");
  const [first, rest] = space > 0 ? [team.name.slice(0, space), team.name.slice(space + 1)] : [team.name, ""];

  return (
    <>
      <h1
        className="relative text-center font-display text-6xl font-semibold leading-none tracking-tight select-none [-webkit-touch-callout:none] sm:text-8xl lg:text-9xl"
        {...(canSwitch && {
          tabIndex: 0,
          title: "Hold to switch team",
          "aria-describedby": "team-switch-hint",
          onPointerDown: (e: React.PointerEvent) => {
            if (e.button === 0) startHold();
          },
          onPointerUp: clear,
          onPointerLeave: clear,
          onPointerCancel: clear,
          onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
          onKeyDown: (e: React.KeyboardEvent) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
              e.preventDefault();
              startHold();
            }
          },
          onKeyUp: clear,
          onBlur: clear,
        })}
      >
        <span key={team.slug} className="block animate-[quarter-flip_180ms_ease-out]" aria-live="polite">
          {first}
          {rest && (
            <>
              <br />
              {rest}
            </>
          )}
        </span>
      </h1>
      {canSwitch && (
        <span id="team-switch-hint" className="sr-only">
          Press and hold to switch team.
        </span>
      )}
      {children}
      <div className="relative mt-12">
        <LoginButton team={team.slug} teamName={team.name} />
      </div>
    </>
  );
}
