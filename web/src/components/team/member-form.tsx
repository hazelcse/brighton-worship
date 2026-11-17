"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import type { MemberFormState } from "@/app/(app)/team/actions";
import { rolesNoun, teamRoles, type TeamConfig } from "@/lib/team-config";

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export type MemberDefaults = {
  name: string;
  email: string;
  instruments: string[];
  emPercent: number | null;
  gender: "male" | "female" | null;
  serves: "both" | "sunday" | "pnp";
};

const SERVES = [
  ["both", "Sunday services and P&P"],
  ["sunday", "Sunday services only"],
  ["pnp", "P&P only"],
] as const;

/** Create or edit a member (root only). */
export function MemberForm({
  action,
  defaults,
  mode,
  groups = [],
  teamConfig,
}: {
  action: (prev: MemberFormState, formData: FormData) => Promise<MemberFormState>;
  defaults?: MemberDefaults;
  mode: "create" | "edit";
  groups?: string[];
  /** The signed-in team: each team's form asks only for what its rosters use (Youth: no EM/CM, no Sunday/P&P). */
  teamConfig?: TeamConfig;
}) {
  const fields = teamConfig?.memberFields ?? { ministry: true, serves: true, rules: true };
  const roles = teamRoles(teamConfig);
  // What was last sent, so "Yes, link" can send it again (the form clears itself after each send).
  const sent = useRef<FormData | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: MemberFormState, formData: FormData) => {
    sent.current = formData;
    return action(prev, formData);
  }, { ok: false, message: null });
  // "No, cancel" hides this answer's question (a new send brings a new one).
  const [dismissed, setDismissed] = useState<MemberFormState | null>(null);
  const link = () => {
    if (!sent.current) return;
    const again = new FormData();
    for (const [k, v] of sent.current.entries()) again.append(k, v);
    again.set("link", "yes");
    startTransition(() => formAction(again));
  };
  // The slider runs from EM (left) to CM (right); its value is the CM share.
  const [cm, setCm] = useState(defaults?.emPercent == null ? 0 : 100 - defaults.emPercent);
  const em = 100 - cm;
  const summary = em === 100 ? "EM only" : em === 0 ? "CM only" : `EM ${em}% · CM ${cm}%`;

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium">
          Name
          <input name="name" required defaultValue={defaults?.name} className={input} />
        </label>
        <label className="space-y-1 text-sm font-medium">
          Email
          <input name="email" type="email" required defaultValue={defaults?.email} className={input} />
        </label>
        {mode === "create" && (
          <>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Password</p>
              <p className="text-xs text-muted">
                They start on the team&apos;s default password and must choose their own the first time they log in.
              </p>
            </div>
            <label className="space-y-1 text-sm font-medium">
              Permission group
              <select name="group" defaultValue="member" className={`${input} capitalize`}>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Gender</legend>
        <div className="flex gap-2">
          {(["male", "female"] as const).map((g) => (
            <label
              key={g}
              className="cursor-pointer rounded-full border border-border px-4 py-1.5 text-sm capitalize transition has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:text-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
            >
              <input type="radio" name="gender" value={g} defaultChecked={defaults?.gender === g} className="sr-only" />
              {g}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{rolesNoun(teamConfig)}</legend>
        <div className="flex flex-wrap gap-2">
          {roles.map(({ value, label }) => (
            <label
              key={value}
              className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-sm transition has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:text-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
            >
              <input type="checkbox" name="instruments" value={value} defaultChecked={defaults?.instruments.includes(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {fields.ministry && (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Ministry</legend>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">EM</span>
          <input
            type="range"
            name="cm_percent"
            min={0}
            max={100}
            step={5}
            value={cm}
            onChange={(e) => setCm(Number(e.target.value))}
            aria-label="How much they serve EM or CM"
            aria-valuetext={summary}
            className="flex-1 accent-accent"
          />
          <span className="text-sm font-semibold">CM</span>
        </div>
        <p className="text-sm text-muted">{summary}</p>
      </fieldset>
      )}

      {fields.serves && (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Serves at</legend>
        <div className="flex flex-wrap gap-2">
          {SERVES.map(([value, label]) => (
            <label
              key={value}
              className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-sm transition has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:text-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
            >
              <input type="radio" name="serves" value={value} defaultChecked={(defaults?.serves ?? "both") === value} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Everyone serves at both by default. The roster only puts them on the sessions picked here.</p>
      </fieldset>
      )}

      {state.link && dismissed !== state && (
        <div role="alertdialog" aria-labelledby="link-title" className="space-y-3 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm">
          <p id="link-title" className="font-medium">
            {state.link.name} already has an account{state.link.teams.length ? ` on ${state.link.teams.join(" and ")}` : ""}. Link it to this team?
          </p>
          <p className="text-muted">
            Linking makes them one person with one login: they keep their name, email and gender. The{" "}
            {rolesNoun(teamConfig).toLowerCase()} and settings picked here become a separate profile for this team, with
            its own rules and permissions; their other teams&apos; profiles don&apos;t change.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={link}
              disabled={pending}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60"
            >
              {pending ? "Linking…" : "Yes, link"}
            </button>
            <button type="button" onClick={() => setDismissed(state)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background">
              No, cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60"
        >
          {pending ? "Saving…" : mode === "create" ? "Create user" : "Save changes"}
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
