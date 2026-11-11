"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/app/(app)/team/permissions/actions";

type Props = {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  className?: string;
  children: React.ReactNode;
};

/** A form wired to a server action that shows the action's success/error message. */
export function ActionForm({ action, submitLabel, className, children }: Props) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: null });

  return (
    <form action={formAction} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground transition hover:bg-ink/90 disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {state.message && (
          <p role="status" className={`text-sm ${state.ok ? "text-emerald-700" : "text-danger"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
