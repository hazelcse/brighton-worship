"use client";

import { useTransition } from "react";
import { deleteDraft } from "@/app/(app)/roster/actions";

export function DeleteDraftButton({ rosterId }: { rosterId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Delete this draft roster and its session list? Rules are kept.")) {
          start(async () => void (await deleteDraft(rosterId)));
        }
      }}
      aria-label={pending ? "Deleting draft…" : "Delete draft"}
      title="Delete draft"
      className="grid h-10 w-10 place-items-center rounded-lg border border-red-300 text-danger hover:bg-red-50 disabled:opacity-50"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}
