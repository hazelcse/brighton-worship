"use client";

import { useRef, useState, useTransition } from "react";
import { deleteMember } from "@/app/(app)/team/actions";

/**
 * Delete with a confirmation step: type the member's name and press Enter. Someone also on other
 * teams is only removed from this one (their login and other profiles stay).
 */
export function DeleteMemberButton({ id, name, team, otherTeams = [] }: { id: string; name: string; team: string; otherTeams?: string[] }) {
  const linked = otherTeams.length > 0;
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTyped("");
          setError(null);
          ref.current?.showModal();
        }}
        className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-danger hover:bg-red-50"
      >
        {linked ? `Remove from ${team}` : "Delete member"}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="delete-title"
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!matches || pending) return;
            start(async () => {
              const r = await deleteMember(id);
              if (r && !r.ok) setError(r.message);
            });
          }}
        >
          <h2 id="delete-title" className="text-lg font-semibold">
            {linked ? `Remove ${name} from ${team}?` : `Delete ${name}?`}
          </h2>
          <p className="text-sm text-muted">
            {linked
              ? `Their ${team} profile, permission groups and allows/denies are removed. Their login and their ${otherTeams.join(" and ")} profile stay as they are.`
              : "Their login, card and permission groups are removed permanently."}{" "}
            Type <b className="text-foreground">{name}</b> and press Enter to confirm.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Type the member's name to confirm"
            autoFocus
            autoComplete="off"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-danger"
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => ref.current?.close()} className="text-sm text-muted">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!matches || pending}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {pending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
