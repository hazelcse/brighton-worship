import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarLoader } from "@/components/calendar-loader";
import { requireUser } from "@/lib/auth";
import { formatRange, nextQuarter, quarterOf, todayYmd } from "@/lib/roster";
import { loadAssignments, loadRoster, publishedRosterFor } from "@/lib/roster-data";
import { loadServeStatuses } from "@/lib/serving";
import { revisionOf } from "@/lib/roster-revision";
import { EditPublishedButton } from "@/components/roster/revision-controls";
import { FilteredRosterTable } from "@/components/roster/roster-filter";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "This quarter's roster · Brighton Worship" };

type Search = Promise<{ quarter?: string }>;

/**
 * The published roster for today's quarter, with who has and hasn't confirmed.
 * `?quarter=next` shows next quarter's instead, once it's been published.
 */
async function CurrentRoster({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (!user.can("roster.view")) notFound();
  const { quarter } = await searchParams;
  const today = todayYmd();
  const published = await publishedRosterFor(quarter === "next" ? nextQuarter(quarterOf(today)).start : today);
  if (!published) notFound();
  const data = await loadRoster(published.id);
  if (!data) notFound();
  const { roster, sessions } = data;
  const [assignments, statuses, revisionId] = await Promise.all([
    loadAssignments(sessions.map((s) => s.id)),
    loadServeStatuses(roster.id),
    user.isRoot ? revisionOf(roster.id) : Promise.resolve(null),
  ]);

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
        {user.isRoot && <EditPublishedButton rosterId={roster.id} revisionId={revisionId} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-3 rounded bg-orange-100 ring-1 ring-orange-200" /> Not confirmed yet
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-3 rounded bg-red-100 ring-1 ring-red-200" /> Can&apos;t serve, looking for cover
        </span>
      </div>
      <FilteredRosterTable sessions={sessions} assignments={assignments} serveStatus={statuses} thisWeekOf={todayYmd()} />
    </div>
  );
}

export default function CurrentRosterPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<CalendarLoader label="Loading the roster" className="py-24" />}>
        <CurrentRoster searchParams={searchParams} />
      </Suspense>
    </>
  );
}
