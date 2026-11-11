"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/app/actions/auth";

const input =
  "rounded-lg border border-border bg-surface px-3 py-2.5 text-base font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(changePassword, { error: null });

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        New password
        <input name="password" type="password" autoComplete="new-password" required minLength={8} className={input} />
        <span className="text-xs font-normal text-muted">At least 8 characters.</span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Confirm new password
        <input name="confirm" type="password" autoComplete="new-password" required minLength={8} className={input} />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-ink-foreground transition hover:bg-ink/90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
