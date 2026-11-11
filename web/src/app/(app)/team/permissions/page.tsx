import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/action-form";
import { createGroup } from "./actions";
import { TransferRoot } from "@/components/team/transfer-root";
import { loadGroups, requireAdminViewer } from "./data";

export const metadata: Metadata = { title: "Manage permissions · Brighton Worship" };

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

async function PermissionsView() {
  const viewer = await requireAdminViewer(); // root (or a developer)
  const db = createAdminClient();

  const [groups, { data: users }, { data: memberships }] = await Promise.all([
    loadGroups(),
    db.from("profiles").select("id, uid, email, full_name, is_root, is_developer, is_active").order("uid", { nullsFirst: false }),
    db.from("user_groups").select("user_id, group_id"),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const groupsOf = (userId: string) =>
    (memberships ?? []).filter((m) => m.user_id === userId).map((m) => groupName.get(m.group_id)!);
  const memberCount = (groupId: string) => (memberships ?? []).filter((m) => m.group_id === groupId).length;
  // Only the real root account (not a developer) can hand over root.
  const isRealRoot = Boolean((users ?? []).find((u) => u.id === viewer.id)?.is_root);

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <Link href="/team" className="text-sm text-muted hover:text-foreground">
          ← Team
        </Link>
        <h1 className="font-display text-4xl font-semibold">Manage permissions</h1>
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
                      {u.is_root && (
                        <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-xs font-semibold text-accent">root</span>
                      )}
                      {u.is_developer && (
                        <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800">developer</span>
                      )}
                      {!u.is_active && <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs text-muted">inactive</span>}
                    </p>
                    <p className="truncate text-sm text-muted">{u.email}</p>
                  </div>
                  <p className="text-sm capitalize text-muted">
                    {u.is_root ? "Everything (root)" : u.is_developer ? "Everything (developer)" : groupsOf(u.id).join(", ") || "No groups"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {isRealRoot && (
        <section aria-labelledby="transfer-root-title" className="space-y-3 rounded-xl border border-red-200 bg-surface p-4 sm:p-5">
          <div>
            <h2 id="transfer-root-title" className="text-lg font-semibold">
              Transfer root
            </h2>
            <p className="text-sm text-muted">
              Hand the root role to another member. There is only ever one root; you&apos;ll become an ordinary member of the group you
              pick.
            </p>
          </div>
          <TransferRoot
            people={(users ?? [])
              .filter((u) => u.is_active && u.id !== viewer.id)
              .map((u) => ({ id: u.id, name: (u.full_name as string) || (u.email as string) }))
              .sort((x, y) => x.name.localeCompare(y.name))}
            groups={groups.map((g) => ({ id: g.id, name: g.name }))}
          />
        </section>
      )}
    </div>
  );
}

export default function PermissionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <PermissionsView />
    </Suspense>
  );
}
