import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TeamLoader } from "@/components/team-loader";
import { requireTeamUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMembers } from "@/lib/team";
import { TeamGallery } from "@/components/team/team-gallery";
import { teamPerson } from "@/lib/team-config";
import { groupTeams } from "@/lib/teams";

export const metadata: Metadata = { title: "Team · Brighton Worship" };

async function TeamView() {
  const user = await requireTeamUser("/team", "team");
  if (!user.can("team.view")) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        You don&apos;t have access to the team directory yet. Ask a worship team admin.
      </p>
    );
  }
  const [members, { data: groups }, observed] = await Promise.all([
    loadMembers(user.team.id, { includeDevelopers: user.isRoot, observerOf: user.team.group }), // developer and observer accounts: root only
    // This team's own permission groups only: each team sets up its own.
    user.isLead ? createAdminClient().from("groups").select("name").eq("team_id", user.team.id).order("name") : Promise.resolve({ data: [] }),
    // An observer looks at each of its group's teams in turn (e.g. Youth Worship and Youth Media).
    user.observerGroup ? groupTeams(user.observerGroup) : Promise.resolve([]),
  ]);
  return (
    <>
      {/* Root isn't on any team: say which team's members these are. */}
      {user.isRoot && (
        <p className="mb-4 text-sm text-muted">
          <span className="font-medium text-foreground">{user.team.name}</span> ·{" "}
          <Link href="/teams" className="text-accent underline-offset-2 hover:underline">
            Other teams
          </Link>
        </p>
      )}
      {/* An observer isn't on any team either: which team this is, and a switch to the others in its group. */}
      {user.isObserver && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Teams" className="flex flex-wrap gap-2">
          {observed.map((t) =>
            t.id === user.team.id ? (
              <span key={t.id} aria-current="page" className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-ink-foreground">
                {t.name}
              </span>
            ) : (
              // A plain link (not prefetched): following it switches team.
              <a
                key={t.id}
                href={`/teams/${t.slug}/open?next=/team`}
                className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50"
              >
                {t.name}
              </a>
            ),
          )}
        </nav>
          {user.observerManagesPermissions && (
          <Link
            href="/team/permissions"
            className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50"
          >
            Manage permissions
          </Link>
          )}
        </div>
      )}
      <TeamGallery
        // Only root (and developers) see emails, permission groups and gender.
        members={members.map((m) => teamPerson(user.isLead ? m : { ...m, email: "", groups: [], gender: null }, user.team.config))}
        teamConfig={user.team.config}
        isLead={user.isLead}
        groups={(groups ?? []).map((g) => g.name).sort((a, b) => (a === "member" ? -1 : b === "member" ? 1 : a.localeCompare(b)))}
      />
    </>
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={<TeamLoader label="Loading the team" className="py-24" />}>
      <TeamView />
    </Suspense>
  );
}
