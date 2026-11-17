import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { CalendarLoader } from "@/components/calendar-loader";
import { requireTeamUser } from "@/lib/auth";
import { formatRange, makeSentence, quarterOf } from "@/lib/roster";
import { loadAssignments, loadPeople, loadResult, loadRoster, loadRules } from "@/lib/roster-data";
import { rosterProblems } from "@/lib/roster-check";
import { revisionOf } from "@/lib/roster-revision";
import { EditWarnings } from "@/components/roster/edit-warnings";
import { EditPublishedButton } from "@/components/roster/revision-controls";
import { FilteredRosterTable } from "@/components/roster/roster-filter";
import { AutoRefresh } from "@/components/auto-refresh";
import { splitsMinistry } from "@/lib/team-config";

/** Read-only view of a roster: every session, and (once generated) who's serving. */
async function RosterDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTeamUser(`/roster/${(await params).id}`, "team");
  if (!user.can("roster.view")) notFound();
  const { id } = await params;
  const data = await loadRoster(id, user.team.id);
  if (!data) notFound();
  const { roster, sessions } = data;
  if (roster.status === "draft" && !user.can("roster.edit")) notFound();
  // Root's edit of a published roster is only seen by root, on the editing page.
  if (roster.status === "revision") {
    if (!user.isLead) notFound();
    redirect(`/roster/${id}/generated`);
  }
  const revisionId = roster.status === "published" && user.isLead ? await revisionOf(id) : null;

  // Admins see any problems left in the roster (they stay after publishing until fixed).
  let problems: { id: string; text: string }[] = [];
  if (user.can("roster.edit")) {
    const [{ result, check }, rules, people] = await Promise.all([loadResult(id), loadRules(id, user.team.id), loadPeople(user.team)]);
    problems = rosterProblems(check, result, sessions, people, makeSentence(rules, people));
  }

  return (
    <div className="space-y-6">
      <Link href="/roster" className="text-sm text-muted hover:text-foreground">
        ← Roster
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{quarterOf(roster.starts_on).label}</p>
          <h1 className="font-display text-4xl font-semibold">{formatRange(roster.starts_on, roster.ends_on)}</h1>
        </div>
        {roster.status === "draft" && user.can("roster.edit") && (
          <Link href={`/roster/${roster.id}/plan`} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90">
            Continue planning
          </Link>
        )}
        {roster.status === "published" && user.isLead && <EditPublishedButton rosterId={roster.id} revisionId={revisionId} />}
      </div>

      {revisionId && (
        <p className="max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          You&apos;re editing a copy of this roster. Everyone sees it as below until you republish.
        </p>
      )}

      {problems.length > 0 && (
        <div className="max-w-2xl">
          <EditWarnings rosterId={roster.id} hard={problems} soft={[]} />
        </div>
      )}

      <FilteredRosterTable splitsMinistry={splitsMinistry(user.team.config)} sessions={sessions} assignments={await loadAssignments(sessions.map((s) => s.id))} peopleFilter={user.isLead} meId={user.id} />
    </div>
  );
}

export default function RosterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<CalendarLoader label="Loading the roster" className="py-24" />}>
        <RosterDetail params={params} />
      </Suspense>
    </>
  );
}
