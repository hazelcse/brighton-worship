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
import { openTeam, setTeamLead, updateTeam } from "../actions";
import { teamBySlug } from "@/lib/teams";
import { GROUP_LABEL } from "@/lib/team-config";
import { SESSION_TYPES, scheduleText } from "@/lib/roster";

export const metadata: Metadata = { title: "Team · Brighton Serving" };

type MemberRow = { is_lead: boolean; profiles: { id: string; full_name: string; email: string; is_active: boolean } | null };

async function TeamView({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (!user.isRoot && !(user.isDeveloper && !user.viewingAsPerson)) notFound();
  const { slug } = await params;

  const db = createAdminClient();
  const [{ data: team }, settings] = await Promise.all([
    db.from("teams").select("id, slug, name, kind, permission_ceiling").eq("slug", slug).maybeSingle(),
    teamBySlug(slug),
  ]);
  if (!team || !settings) notFound();
  const { config } = settings;
  const [{ data: members }, { data: permissions }, { data: observer }] = await Promise.all([
    db.from("team_members").select("is_lead, profiles(id, full_name, email, is_active)").eq("team_id", team.id),
    db.from("permissions").select("key, category, description").order("key"),
    // The group's observer (read-only, on no team): shown here, not counted as a member.
    db.from("profiles").select("id, full_name, email").eq("observer_group", settings.group).maybeSingle(),
  ]);
  const rows = ((members ?? []) as unknown as MemberRow[])
    .filter((m) => m.profiles)
    .sort((a, b) => Number(b.is_lead) - Number(a.is_lead) || (a.profiles!.full_name || "").localeCompare(b.profiles!.full_name || ""));
  const lead = rows.find((m) => m.is_lead)?.profiles;
  const isOpen = user.team.id === team.id;
  // This team's page at `path`, switched to this team first.
  const open = (path: string) => `/teams/${team.slug}/open?next=${encodeURIComponent(path)}`;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/teams" className="text-sm text-muted hover:text-foreground">
          ← Teams
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-4xl font-semibold">{team.name}</h1>
            <p className="text-sm text-muted">
              {GROUP_LABEL[settings.group]} · <span className="capitalize">{team.kind}</span> team · {rows.length} {rows.length === 1 ? "member" : "members"}
            </p>
          </div>
          {isOpen ? (
            <p className="text-sm text-muted">Roster, Sessions and Schedule show this team.</p>
          ) : (
            <form action={openTeam.bind(null, team.slug as string)}>
              <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent/50">
                Work in {team.name}
              </button>
            </form>
          )}
        </div>
      </div>

      <section aria-labelledby="settings-title" className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <h2 id="settings-title" className="text-lg font-semibold">
          Settings
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted">Regular sessions</dt>
          <dd>
            {config.sessionKinds.length
              ? config.sessionKinds.map((k) => `${SESSION_TYPES[k].name} (${scheduleText(SESSION_TYPES[k].schedule, true)})`).join(", ")
              : "None: rosters start empty"}
          </dd>
          <dt className="text-muted">EM/CM split</dt>
          <dd>{config.memberFields.ministry ? "Yes: each member has an EM/CM share" : "No"}</dd>
          <dt className="text-muted">Sunday / P&amp;P choice</dt>
          <dd>{config.memberFields.serves ? "Yes: members choose Sunday services and/or P&P" : "No"}</dd>
          <dt className="text-muted">Personal rules</dt>
          <dd>{config.memberFields.rules ? "Yes: parts someone plays but shouldn't be rostered for" : "No"}</dd>
          {config.sessionsFrom && (
            <>
              <dt className="text-muted">Works on the sessions of</dt>
              <dd>{config.sessionsFrom}</dd>
            </>
          )}
        </dl>
        <p className="text-xs text-muted">Set in the team&apos;s config (see web/src/lib/team-config.ts).</p>
      </section>

      <section aria-labelledby="lead-title" className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <h2 id="lead-title" className="text-lg font-semibold">
          Lead
        </h2>
        {lead ? (
          <p className="text-sm">
            <span className="font-medium">{lead.full_name || lead.email}</span> <span className="text-muted">· {lead.email}</span>
          </p>
        ) : (
          <p className="text-sm text-muted">
            This team has no lead yet. The lead runs the team: adds its members, sets up its permission groups and plans its rosters.
          </p>
        )}
        {lead ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Change lead</summary>
            <ActionForm action={setTeamLead.bind(null, team.id as string)} submitLabel="Make lead" className="mt-3 grid gap-4 sm:grid-cols-2">
              <LeadFields required />
            </ActionForm>
          </details>
        ) : (
          <ActionForm action={setTeamLead.bind(null, team.id as string)} submitLabel="Create lead" className="grid gap-4 sm:grid-cols-2">
            <LeadFields required />
          </ActionForm>
        )}
      </section>

      <section aria-labelledby="members-title" className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
        {/* Root does everything the lead can: the heading opens this team's members (its gallery),
            switched to this team. A plain link (not prefetched): following it switches team. */}
        <h2 id="members-title" className="text-lg font-semibold">
          {/* Hover: turns accent, and an underline (same colour) grows out from the centre. */}
          <a
            href={open("/team")}
            className="relative inline-block transition-colors hover:text-accent focus-visible:text-accent after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-center after:scale-x-0 after:bg-current after:transition-transform after:duration-200 hover:after:scale-x-100 focus-visible:after:scale-x-100 motion-reduce:after:transition-none"
          >
            Members
          </a>
        </h2>
        {rows.length ? (
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((m) => (
              <li key={m.profiles!.id} className={m.profiles!.is_active ? "" : "text-muted line-through"}>
                <a href={open(`/team/${m.profiles!.id}`)} className="underline-offset-2 hover:text-accent hover:underline">
                  {m.profiles!.full_name || m.profiles!.email}
                </a>
                {m.is_lead && <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-xs font-semibold text-accent">lead</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nobody yet. The lead (or you, from Members above) adds them.</p>
        )}
        {observer && (
          <p className="text-sm text-muted">
            Observer (not on the team):{" "}
            <a href={open(`/team/${observer.id}`)} className="underline-offset-2 hover:text-accent hover:underline">
              {observer.full_name || observer.email}
            </a>
            <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-800">observer</span>
          </p>
        )}
      </section>

      <details className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <summary className="cursor-pointer font-medium">Name and maximum permissions</summary>
        <ActionForm action={updateTeam.bind(null, team.id as string)} submitLabel="Save team" className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium sm:col-span-2">
            Name
            <input name="name" required defaultValue={team.name as string} className={teamInput} />
          </label>
          <CeilingFields catalogue={(permissions ?? []) as PermissionRow[]} ceiling={(team.permission_ceiling as string[] | null) ?? null} />
        </ActionForm>
      </details>
    </div>
  );
}

export default function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<TeamLoader label="Loading team" className="py-24" />}>
      <TeamView params={params} />
    </Suspense>
  );
}
