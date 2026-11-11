"use client";

import { useTransition } from "react";
import { markReviewed } from "@/app/(app)/songs/actions";

export function ReviewButton({ songId }: { songId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await markReviewed(songId)))}
      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent/50 disabled:opacity-60"
      title="Resolve the raised issues and hide the scanner flags until the songsheet is scanned again"
    >
      {pending ? "Saving…" : "Mark as reviewed"}
    </button>
  );
}
