"use client";

import { useActionState, useState } from "react";
import { transferLead, type ActionResult } from "@/app/(app)/team/permissions/actions";

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/**
 * Hand the team's lead to someone else. Needs your password. The lead hands over their own lead;
 * root or a developer (`currentLead` set) changes it from the current lead and stays root themselves.
 */
export function TransferLead({
  people,
  groups,
  currentLead = null,
}: {
  people: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  /** Root or a developer acting: the current lead's name ("" when the team has none). Null when the lead is acting. */
  currentLead?: string | null;
}) {
  const forLead = currentLead !== null;
  const oldLead = currentLead || "The current lead";
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(transferLead, { ok: false, message: null });
  const [to, setTo] = useState("");
  const toName = people.find((p) => p.id === to)?.name;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const msg = forLead
          ? `Make ${toName ?? "this person"} the lead? ${oldLead} loses lead access straight away.`
          : `Make ${toName ?? "this person"} the lead? You lose lead access straight away.`;
        if (!window.confirm(msg)) {
          e.preventDefault();
        }
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <label className="space-y-1 text-sm font-medium">
        New lead
        <select name="new_root" required value={to} onChange={(e) => setTo(e.target.value)} className={input}>
          <option value="" disabled>
            Choose a member…
          </option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium">
        {forLead ? `${oldLead} will then be in` : "You'll then be in"}
        <select name="my_group" defaultValue={groups.find((g) => g.name === "admin")?.id ?? ""} className={`${input} capitalize`}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="">No group</option>
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2">
        Your password
        <input name="password" type="password" required autoComplete="current-password" className={input} />
        <span className="block text-xs font-normal text-muted">Needed to confirm it&apos;s really you.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending || !to}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {pending ? "Checking…" : "Transfer lead"}
        </button>
        {state.message && (
          <p role="alert" className={`text-sm ${state.ok ? "text-emerald-700" : "text-danger"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
