import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/action-form";
import { TeamLoader } from "@/components/team-loader";
import { CeilingFields, LeadFields, teamInput } from "@/components/teams/team-fields";
import type { PermissionRow } from "@/app/(app)/team/permissions/data";
import { createObserver, createTeam, removeObserver } from "./actions";
import { GROUP_LABEL, TEAM_GROUPS, type TeamGroup } from "@/lib/team-config";

export const metadata: Metadata = { title: "Teams · Brighton Serving" };

type MemberRow = { team_id: string; is_lead: boolean; profiles: { full_name: string; email: string } | null };

async function TeamsView() {
  const user = await requireUser();
  if (!user.isRoot && !(user.isDeveloper && !user.viewingAsPerson)) notFound();

  const db = createAdminClient();
  const [{ data: teams }, { data: members }, { data: permissions }, { data: observerRows }] = await Promise.all([
    db.from("teams").select("id, slug, name, kind, team_group").order("position"),
    db.from("team_members").select("team_id, is_lead, profiles(full_name, email)"),
    db.from("permissions").select("key, category, description").order("key"),
    // The observer accounts (on no team): at most one per group.
    db.from("profiles").select("id, full_name, email, observer_group, observer_manages_permissions, observer_sees_absences").not("observer_group", "is", null),
  ]);
  const observers = (observerRows ?? []) as {
    id: string;
    full_name: string;
    email: string;
    observer_group: TeamGroup;
    observer_manages_permissions: boolean;
    observer_sees_absences: boolean;
  }[];
  const rows = (members ?? []) as unknown as MemberRow[];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-4xl font-semibold">Teams</h1>
        <p className="text-sm text-muted">
          Teams come in two groups, Main and Youth, each with a worship team and a media team. Each team has its own lead,
          members, permission groups, rosters and settings. People log in from &ldquo;Brighton Worship&rdquo; or &ldquo;Brighton
          Media&rdquo; and land in their team of that kind.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {(teams ?? []).map((t) => {
          const onTeam = rows.filter((m) => m.team_id === t.id);
          const lead = onTeam.find((m) => m.is_lead)?.profiles;
          return (
            <li key={t.id}>
              <Link href={`/teams/${t.slug}`} className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-accent/50">
                <p className="font-medium">{t.name}</p>
                <p className="mt-1 text-sm text-muted">
                  {GROUP_LABEL[(t.team_group as TeamGroup) ?? "main"]} · <span className="capitalize">{t.kind}</span> · {onTeam.length} {onTeam.length === 1 ? "member" : "members"}
                </p>
                <p className={`mt-3 text-xs ${lead ? "text-muted" : "font-medium text-accent"}`}>
                  {lead ? `Lead: ${lead.full_name || lead.email}` : "No lead yet: open to create one"}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="observer-title" className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="space-y-1">
          <h2 id="observer-title" className="text-lg font-semibold">
            Observers
          </h2>
          <p className="text-sm text-muted">
            One read-only account per group, on no team, that oversees the group&apos;s teams: it sees their published sessions,
            team directories, rosters and absences. It isn&apos;t counted, rostered or shown in the directory (except to you), and
            can&apos;t add absences or edit the directory. If allowed, it also manages everyone&apos;s permissions (the leads&apos;
            too) and can transfer each team&apos;s lead.
          </p>
        </div>
        {TEAM_GROUPS.map((g) => {
          const o = observers.find((x) => x.observer_group === g);
          return (
            <div key={g} className="space-y-2 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">{GROUP_LABEL[g]} observer</h3>
              {o ? (
                <>
                  <p className="text-sm">
                    <span className="font-medium">{o.full_name || o.email}</span>
                    <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-800">observer</span>{" "}
                    <span className="text-muted">
                      · {o.email} · {o.observer_sees_absences ? "sees absences" : "no absences"} ·{" "}
                      {o.observer_manages_permissions ? "manages permissions" : "can't change permissions"}
                    </span>
                  </p>
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-danger">Remove observer</summary>
                    <ActionForm action={removeObserver.bind(null, g)} submitLabel="Remove observer" className="mt-3 space-y-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="confirm" required />
                        Delete this account and its login. This can&apos;t be undone.
                      </label>
                    </ActionForm>
                  </details>
                </>
              ) : (
                <ActionForm action={createObserver.bind(null, g)} submitLabel="Create observer" className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1 text-sm font-medium">
                    Name
                    <input name="name" required className={teamInput} />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Email
                    <input name="email" type="email" required className={teamInput} />
                  </label>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input type="checkbox" name="sees_absences" defaultChecked={g === "youth"} />
                    Can see absences (everyone&apos;s on these teams, filtered by team; otherwise only the services)
                  </label>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input type="checkbox" name="manages_permissions" defaultChecked={g === "youth"} />
                    Can manage permissions (groups, everyone&apos;s access, the leads&apos; too, and transferring the lead)
                  </label>
                </ActionForm>
              )}
            </div>
          );
        })}
      </section>

      <details id="new" className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <summary className="cursor-pointer font-medium">+ New team</summary>
        <ActionForm action={createTeam} submitLabel="Create team" className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            Name
            <input name="name" required placeholder="e.g. Kids Worship" className={teamInput} />
          </label>
          <label className="space-y-1 text-sm font-medium">
            Group
            <select name="group" required defaultValue="main" className={teamInput}>
              {TEAM_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Kind
            <select name="kind" required defaultValue="worship" className={teamInput}>
              <option value="worship">Worship (logs in from Brighton Worship)</option>
              <option value="media">Media (logs in from Brighton Media)</option>
            </select>
          </label>
          <LeadFields />
          <CeilingFields catalogue={(permissions ?? []) as PermissionRow[]} ceiling={null} />
        </ActionForm>
      </details>
    </div>
  );
}

export default function TeamsPage() {
  return (
    <Suspense fallback={<TeamLoader label="Loading teams" className="py-24" />}>
      <TeamsView />
    </Suspense>
  );
}
