"use client";

import { useRef, useState, useTransition } from "react";
import { resetMemberPassword, type MemberFormState } from "@/app/(app)/team/actions";

/** Root only: put a member back on the default password, after a confirmation. */
export function ResetPasswordButton({ id, name }: { id: string; name: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<MemberFormState | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null);
          ref.current?.showModal();
        }}
        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-background"
      >
        Reset password to default
      </button>
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        aria-label={`Reset ${name}'s password`}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">Reset {name}&apos;s password?</h2>
          {result?.ok ? (
            <p role="status" className="text-sm text-emerald-700">
              {result.message}
            </p>
          ) : (
            <p className="text-sm text-muted">
              Their password goes back to the default member password, and they&apos;ll have to choose a new one when they next log in.
            </p>
          )}
          {result && !result.ok && (
            <p role="alert" className="text-sm text-danger">
              {result.message}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => ref.current?.close()} className="text-sm text-muted">
              {result?.ok ? "Close" : "Cancel"}
            </button>
            {!result?.ok && (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => setResult(await resetMemberPassword(id)))}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground disabled:opacity-40"
              >
                {pending ? "Resetting…" : "Reset password"}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
