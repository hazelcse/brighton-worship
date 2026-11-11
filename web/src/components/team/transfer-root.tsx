"use client";

import { useActionState, useState } from "react";
import { transferRoot, type ActionResult } from "@/app/(app)/team/permissions/actions";

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/** Root only: hand the root role to someone else. Needs root's password. */
export function TransferRoot({
  people,
  groups,
}: {
  people: { id: string; name: string }[];
  groups: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(transferRoot, { ok: false, message: null });
  const [to, setTo] = useState("");
  const toName = people.find((p) => p.id === to)?.name;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Make ${toName ?? "this person"} root? You'll lose root access straight away. Only the new root can give it back.`)) {
          e.preventDefault();
        }
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <label className="space-y-1 text-sm font-medium">
        New root
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
        You&apos;ll then be in
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
          {pending ? "Checking…" : "Transfer root"}
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
