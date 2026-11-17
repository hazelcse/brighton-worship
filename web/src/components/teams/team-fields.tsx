import { byCategory, type PermissionRow } from "@/app/(app)/team/permissions/data";

export const teamInput =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/** A team's maximum permissions: "every permission", or a tick per permission. */
export function CeilingFields({ catalogue, ceiling }: { catalogue: PermissionRow[]; ceiling: string[] | null }) {
  return (
    <fieldset className="space-y-3 sm:col-span-2">
      <legend className="text-sm font-medium">Maximum permissions</legend>
      <p className="text-xs text-muted">
        The most anyone on this team can do, its lead included. The lead hands these out to members through the team&apos;s
        permission groups.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="all_permissions" defaultChecked={ceiling === null} />
        Every permission (ignores the ticks below)
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        {byCategory(catalogue).map(([category, perms]) => (
          <div key={category} className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{category}</p>
            {perms.map((p) => (
              <label key={p.key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="permissions" value={p.key} defaultChecked={ceiling?.includes(p.key) ?? true} className="mt-1" />
                <span>
                  {p.description} <span className="text-xs text-muted">({p.key})</span>
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** The lead's email and (for someone without an account yet) name. */
export function LeadFields({ required = false }: { required?: boolean }) {
  return (
    <>
      <label className="space-y-1 text-sm font-medium">
        Lead&apos;s email
        <input name="lead_email" type="email" required={required} className={teamInput} placeholder={required ? undefined : "Optional"} />
      </label>
      <label className="space-y-1 text-sm font-medium">
        Lead&apos;s name
        <input name="lead_name" className={teamInput} placeholder="Only needed for a new account" />
      </label>
    </>
  );
}
