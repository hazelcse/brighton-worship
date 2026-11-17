import { Suspense } from "react";
import { TeamLoader } from "@/components/team-loader";
import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/action-form";
import { createGroup } from "./actions";
import { TransferLead } from "@/components/team/transfer-lead";
import { loadGroups, requireAdminViewer } from "./data";
import { teamLeadId, teamMemberIds } from "@/lib/teams";
import { overseesLeads } from "@/lib/auth";

export const metadata: Metadata = { title: "Manage permissions · Brighton Worship" };

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

async function PermissionsView() {
  const viewer = await requireAdminViewer(); // the lead (or root, or a developer)
  const db = createAdminClient();

  const memberIds = await teamMemberIds(viewer.team.id);
  const [groups, { data: users }, { data: memberships }, leadId] = await Promise.all([
    loadGroups(viewer.team.id),
    // This team's members only.
    db
      .from("profiles")
      .select("id, uid, email, full_name, is_developer, is_active")
      .in("id", memberIds)
      .order("uid", { nullsFirst: false }),
    db.from("user_groups").select("user_id, group_id"),
    teamLeadId(viewer.team.id),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const groupsOf = (userId: string) =>
    (memberships ?? []).filter((m) => m.user_id === userId && groupName.has(m.group_id)).map((m) => groupName.get(m.group_id)!);
  const memberCount = (groupId: string) => (memberships ?? []).filter((m) => m.group_id === groupId).length;
  // The lead hands over the lead; root and developers can also choose a team's lead.
  const isRealLead = leadId === viewer.id || overseesLeads(viewer);
  // Root or a developer changing someone else's lead: they stay root, so the card speaks of the current lead.
  const actingForLead = leadId !== viewer.id;
  const leadName = (() => {
    const u = (users ?? []).find((x) => x.id === leadId);
    return u ? ((u.full_name as string) || (u.email as string)) : null;
  })();

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <Link href="/team" className="text-sm text-muted hover:text-foreground">
          ← Team
        </Link>
        <h1 className="font-display text-4xl font-semibold">Manage permissions</h1>
        {(viewer.isRoot || viewer.isObserver) && <p className="text-sm font-medium">{viewer.team.name}</p>}
        <p className="text-sm text-muted">
          Permission groups give their members a set of permissions. Open a person to see everything they can do, or to
          allow or deny something for them alone.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Permission groups</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/team/permissions/groups/${g.id}`}
                className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-accent/50"
              >
                <p className="font-medium capitalize">{g.name}</p>
                <p className="mt-1 text-sm text-muted">{g.description || "No description"}</p>
                <p className="mt-3 text-xs text-muted">
                  {memberCount(g.id)} {memberCount(g.id) === 1 ? "person" : "people"}
                </p>
              </Link>
            </li>
          ))}
        </ul>

        <details className="rounded-xl border border-border bg-surface p-4">
          <summary className="cursor-pointer font-medium">+ New permission group</summary>
          <ActionForm action={createGroup} submitLabel="Create group" className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Name
              <input name="name" required className={input} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Description
              <input name="description" className={input} />
            </label>
          </ActionForm>
        </details>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">People</h2>
          <span className="text-sm text-muted">{users?.length ?? 0} accounts</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <ul className="divide-y divide-border">
            {(users ?? []).map((u) => (
              <li key={u.id}>
                <Link
                  href={`/team/permissions/users/${u.id}`}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-background sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {u.uid != null && <span className="mr-2 text-xs font-normal text-muted">#{u.uid}</span>}
                      {u.full_name || u.email}
                      {u.id === leadId && (
                        <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-xs font-semibold text-accent">lead</span>
                      )}
                      {u.is_developer && (
                        <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800">developer</span>
                      )}
                      {!u.is_active && <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs text-muted">inactive</span>}
                    </p>
                    <p className="truncate text-sm text-muted">{u.email}</p>
                  </div>
                  <p className="text-sm capitalize text-muted">
                    {u.id === leadId ? "Everything (lead)" : u.is_developer ? "Everything (developer)" : groupsOf(u.id).join(", ") || "No groups"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {isRealLead && (
        <section aria-labelledby="transfer-lead-title" className="space-y-3 rounded-xl border border-red-200 bg-surface p-4 sm:p-5">
          <div>
            <h2 id="transfer-lead-title" className="text-lg font-semibold">
              Transfer lead
            </h2>
            <p className="text-sm text-muted">
              {actingForLead
                ? `Change ${viewer.team.name}'s lead${leadName ? ` from ${leadName}` : ""} to another member of the team. Each team has one lead; ${leadName ?? "the current lead"} becomes an ordinary member of the group you pick. You stay ${viewer.isDeveloper ? "a developer" : "root"}.`
                : "Hand the lead to another member. Each team has one lead; you become an ordinary member of the group you pick."}
            </p>
          </div>
          <TransferLead
            people={(users ?? [])
              .filter((u) => u.is_active && u.id !== leadId)
              .map((u) => ({ id: u.id, name: (u.full_name as string) || (u.email as string) }))
              .sort((x, y) => x.name.localeCompare(y.name))}
            groups={groups.map((g) => ({ id: g.id, name: g.name }))}
            currentLead={actingForLead ? (leadName ?? "") : null}
          />
        </section>
      )}
    </div>
  );
}

export default function PermissionsPage() {
  return (
    <Suspense fallback={<TeamLoader label="Loading permissions" className="py-24" />}>
      <PermissionsView />
    </Suspense>
  );
}
