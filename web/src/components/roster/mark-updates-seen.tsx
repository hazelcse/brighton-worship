"use client";

import { useEffect } from "react";
import { markUpdatesSeen } from "@/app/(app)/roster/serving-actions";
import { BADGE_SEEN_EVENT } from "@/components/app-nav";

/** Records that the updates were viewed, so today's "new" tint is gone next time. Renders nothing. */
export function MarkUpdatesSeen() {
  useEffect(() => {
    // The Roster badge in the nav goes once they've been seen.
    void markUpdatesSeen().then(() => window.dispatchEvent(new CustomEvent(BADGE_SEEN_EVENT, { detail: "/roster" })));
  }, []);
  return null;
}
