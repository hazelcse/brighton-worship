import { Suspense } from "react";
import { TeamLoader } from "@/components/team-loader";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/action-form";
import { updateUserAccess } from "../../actions";
import { byCategory, loadGroups, loadPermissionCatalogue, requireAdminViewer } from "../../data";
import { membership } from "@/lib/teams";
import { overseesLeads } from "@/lib/auth";

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

async function UserView({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdminViewer();
  if (!me.can("users.view") && !me.observerManagesPermissions) notFound();
  const { id } = await params;
  const admin = createAdminClient();

  const [{ data: user }, groups, catalogue, { data: memberships }, { data: overrides }, { data: effective }, { data: groupPerms }] =
    await Promise.all([
      admin.from("profiles").select("id, email, full_name, is_developer, is_active, created_at").eq("id", id).maybeSingle(),
      loadGroups(me.team.id),
      loadPermissionCatalogue(me.team.id),
      admin.from("user_groups").select("group_id").eq("user_id", id),
      admin.from("user_permission_overrides").select("permission_key, effect").eq("user_id", id).eq("team_id", me.team.id),
      admin.rpc("team_permissions", { p_user_id: id, p_team_id: me.team.id }),
      admin.from("group_permissions").select("group_id, permission_key"),
    ]);
  if (!user) notFound();
  const place = await membership(me.team.id, id);
  if (!place) notFound(); // not on this team
  const isLead = place.isLead;

  const memberOf = new Set((memberships ?? []).map((m) => m.group_id));
  const overrideOf = new Map((overrides ?? []).map((o) => [o.permission_key, o.effect as "allow" | "deny"]));
  const effectiveSet = new Set((effective as string[] | null) ?? []);
  const fromGroups = (perm: string) =>
    groups
      .filter((g) => memberOf.has(g.id) && (groupPerms ?? []).some((gp) => gp.group_id === g.id && gp.permission_key === perm))
      .map((g) => g.name);

  const editable = (me.can("users.manage") || me.observerManagesPermissions) && !isLead && !user.is_developer && (me.isLead || me.observerManagesPermissions || me.id !== user.id);
  // The observer (and root) can deny the lead permissions; the lead keeps everything else the team has.
  const leadEditable = isLead && overseesLeads(me);

  return (
    <div className="space-y-6">
      <Link href="/team/permissions" className="text-sm text-muted hover:text-foreground">
        ← Manage permissions
      </Link>
      <div>
        <h1 className="font-display text-4xl font-semibold">{user.full_name || user.email}</h1>
        <p className="text-sm text-muted">
          {user.email}
          {isLead && " · team lead (has every permission the team has)"}
          {user.is_developer && " · developer (has every permission)"}
        </p>
      </div>

      {leadEditable ? (
        <ActionForm action={updateUserAccess.bind(null, user.id)} submitLabel="Save changes" className="space-y-6">
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="p-4">
              <h2 className="font-semibold">Permissions</h2>
              <p className="text-sm text-muted">
                The lead has every permission the team has. Use <b>Deny</b> to take one away. Running the team (members,
                permission groups, handing over the lead) stays with the lead.
              </p>
            </div>
            {byCategory(catalogue).map(([category, perms]) => (
              <div key={category} className="border-t border-border">
                <h3 className="bg-background px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">{category}</h3>
                <ul className="divide-y divide-border">
                  {perms.map((p) => (
                    <li key={p.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {p.description}{" "}
                          <span
                            className={`ml-1 rounded px-1.5 py-0.5 text-xs ${
                              effectiveSet.has(p.key) ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-muted"
                            }`}
                          >
                            {effectiveSet.has(p.key) ? "has access" : "no access"}
                          </span>
                        </p>
                        <p className="text-xs text-muted">
                          <code>{p.key}</code>
                        </p>
                      </div>
                      <select
                        name={`override:${p.key}`}
                        defaultValue={overrideOf.get(p.key) === "deny" ? "deny" : "inherit"}
                        aria-label={`Override for ${p.key}`}
                        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      >
                        <option value="inherit">Lead: allowed</option>
                        <option value="deny">Deny</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </ActionForm>
      ) : isLead || user.is_developer ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm">
          {isLead ? "The team's lead" : "A developer"} always has full access. Its permissions can&apos;t be changed.
        </p>
      ) : (
        <ActionForm action={updateUserAccess.bind(null, user.id)} submitLabel="Save changes" className="space-y-6">
          <fieldset disabled={!editable} className="space-y-6">
            <section className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                Full name
                <input name="full_name" defaultValue={user.full_name} className={input} />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
                <input type="checkbox" name="is_active" defaultChecked={user.is_active} className="accent-accent" />
                Account active (can log in)
              </label>
            </section>

            <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
              <h2 className="font-semibold">Security groups</h2>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="group_ids" value={g.id} defaultChecked={memberOf.has(g.id)} className="accent-accent" />
                    {g.name}
                  </label>
                ))}
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="p-4">
                <h2 className="font-semibold">Permissions</h2>
                <p className="text-sm text-muted">
                  Group permissions apply automatically. Use <b>Allow</b> to add one for this person only, or{" "}
                  <b>Deny</b> to block it even if a group grants it.
                </p>
              </div>
              {byCategory(catalogue).map(([category, perms]) => (
                <div key={category} className="border-t border-border">
                  <h3 className="bg-background px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">{category}</h3>
                  <ul className="divide-y divide-border">
                    {perms.map((p) => {
                      const groupsGranting = fromGroups(p.key);
                      return (
                        <li key={p.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              {p.description}{" "}
                              <span
                                className={`ml-1 rounded px-1.5 py-0.5 text-xs ${
                                  effectiveSet.has(p.key) ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-muted"
                                }`}
                              >
                                {effectiveSet.has(p.key) ? "has access" : "no access"}
                              </span>
                            </p>
                            <p className="text-xs text-muted">
                              <code>{p.key}</code>
                              {groupsGranting.length > 0 && ` · from ${groupsGranting.join(", ")}`}
                            </p>
                          </div>
                          <select
                            name={`override:${p.key}`}
                            defaultValue={overrideOf.get(p.key) ?? "inherit"}
                            aria-label={`Override for ${p.key}`}
                            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                          >
                            <option value="inherit">From groups</option>
                            <option value="allow">Allow</option>
                            <option value="deny">Deny</option>
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          </fieldset>
        </ActionForm>
      )}
    </div>
  );
}

export default function UserPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<TeamLoader label="Loading permissions" className="py-24" />}>
      <UserView params={params} />
    </Suspense>
  );
}
