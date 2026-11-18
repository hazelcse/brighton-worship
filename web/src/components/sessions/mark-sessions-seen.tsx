"use client";

import { useEffect } from "react";
import { markSessionsSeen } from "@/app/(app)/sessions/actions";
import { BADGE_SEEN_EVENT } from "@/components/app-nav";

/**
 * Records that newly published plans were seen, and clears the nav badge for `href` (Sessions, or a
 * media team's Projection). Renders nothing.
 */
export function MarkSessionsSeen({ href = "/sessions" }: { href?: string }) {
  useEffect(() => {
    void markSessionsSeen().then(() => window.dispatchEvent(new CustomEvent(BADGE_SEEN_EVENT, { detail: href })));
  }, [href]);
  return null;
}
