"use client";

import { useEffect } from "react";
import { markSessionsSeen } from "@/app/(app)/sessions/actions";
import { BADGE_SEEN_EVENT } from "@/components/app-nav";

/** Records that newly published plans were seen, and clears the Sessions badge. Renders nothing. */
export function MarkSessionsSeen() {
  useEffect(() => {
    void markSessionsSeen().then(() => window.dispatchEvent(new CustomEvent(BADGE_SEEN_EVENT, { detail: "/sessions" })));
  }, []);
  return null;
}
