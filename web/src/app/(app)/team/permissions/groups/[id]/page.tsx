import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/action-form";
import { updateGroup } from "../../actions";
import { byCategory, loadPermissionCatalogue, requireAdminViewer } from "../../data";

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

async function GroupView({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminViewer(); // root only
  const { id } = await params;
  const db = createAdminClient();

  const [{ data: group }, catalogue, { data: granted }, { data: members }, { data: people }] = await Promise.all([
    db.from("groups").select("id, name, description").eq("id", id).maybeSingle(),
    loadPermissionCatalogue(),
    db.from("group_permissions").select("permission_key").eq("group_id", id),
    db.from("user_groups").select("user_id").eq("group_id", id),
    db.from("profiles").select("id, uid, full_name, email, is_root").eq("is_root", false).eq("is_developer", false).order("uid", { nullsFirst: false }),
  ]);
  if (!group) notFound();

  const has = new Set((granted ?? []).map((g) => g.permission_key));
  const inGroup = new Set((members ?? []).map((m) => m.user_id));

  return (
    <div className="space-y-6">
      <Link href="/team/permissions" className="text-sm text-muted hover:text-foreground">
        ← Manage permissions
      </Link>
      <h1 className="font-display text-4xl font-semibold capitalize">{group.name}</h1>

      <ActionForm action={updateGroup.bind(null, group.id)} submitLabel="Save group" className="space-y-6">
        <section className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            Name
            <input name="name" defaultValue={group.name} required className={input} />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Description
            <input name="description" defaultValue={group.description} className={input} />
          </label>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="p-4">
              <h2 className="font-semibold">What this group can do</h2>
              <p className="text-sm text-muted">Everyone in the group gets these, unless denied on their own account.</p>
            </div>
            {byCategory(catalogue).map(([category, perms]) => (
              <div key={category} className="border-t border-border">
                <h3 className="bg-background px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">{category}</h3>
                <ul className="divide-y divide-border">
                  {perms.map((p) => (
                    <li key={p.key}>
                      <label className="flex items-start gap-3 px-4 py-3">
                        <input type="checkbox" name="permissions" value={p.key} defaultChecked={has.has(p.key)} className="mt-0.5 accent-accent" />
                        <span className="text-sm font-medium">{p.description}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="p-4">
              <h2 className="font-semibold">People in this group</h2>
              <p className="text-sm text-muted">Tick everyone who should be in it. Root always has every permission.</p>
            </div>
            <input type="hidden" name="set_members" value="1" />
            <ul className="divide-y divide-border border-t border-border">
              {(people ?? []).map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <input type="checkbox" name="member_ids" value={p.id} defaultChecked={inGroup.has(p.id)} className="accent-accent" />
                    <span className="w-8 text-xs text-muted">{p.uid != null ? `#${p.uid}` : ""}</span>
                    <span className="font-medium">{p.full_name || p.email}</span>
                    <Link href={`/team/permissions/users/${p.id}`} className="ml-auto text-xs text-accent hover:underline">
                      Permissions
                    </Link>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </ActionForm>
    </div>
  );
}

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <GroupView params={params} />
    </Suspense>
  );
}
