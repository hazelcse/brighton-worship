"use client";

import { useActionState, useEffect, useRef } from "react";
import { signIn, type LoginState } from "@/app/actions/auth";

const initialState: LoginState = { error: null, email: "" };

export function LoginButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.error) emailRef.current?.focus();
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-full border border-ink-foreground/30 px-10 py-3 text-sm font-medium uppercase tracking-[0.2em] transition hover:bg-ink-foreground hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-foreground"
      >
        Log in
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="login-title"
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
        onClick={(e) => {
          // Close when clicking the backdrop.
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between">
            <h2 id="login-title" className="font-display text-3xl font-semibold">
              Log in
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => dialogRef.current?.close()}
              className="-mr-2 -mt-1 rounded-full p-2 text-muted hover:bg-background"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email
            <input
              ref={emailRef}
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.email}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-base font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-base font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>

          {state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-lg bg-ink px-4 py-2.5 font-medium text-ink-foreground transition hover:bg-ink/90 disabled:opacity-60"
          >
            {pending ? "Logging in…" : "Log in"}
          </button>
        </form>
      </dialog>
    </>
  );
}
