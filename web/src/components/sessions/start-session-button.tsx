"use client";

import { useState, useTransition } from "react";
import { startSession } from "@/app/(app)/sessions/actions";

/** Creates the session's plan (first time only) and opens the workbench. */
export function StartSessionButton({ rosterSessionId, className, children }: { rosterSessionId: string; className: string; children: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await startSession(rosterSessionId);
            } catch (e) {
              // redirect() throws to navigate; only real errors land here with a message.
              if (e instanceof Error && !e.message.includes("NEXT_REDIRECT")) setError(e.message);
            }
          })
        }
        className={`${className} disabled:opacity-60`}
      >
        {children}
      </button>
      {error && (
        <p role="alert" className="mt-1 px-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
