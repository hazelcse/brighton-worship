import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarLoader } from "@/components/calendar-loader";
import { requireUser } from "@/lib/auth";
import { formatRange, nextQuarter, quarterOf, todayYmd } from "@/lib/roster";
import { publishedRosterFor } from "@/lib/roster-data";
import { loadRequestsBoard } from "@/lib/serving";
import { loadMyServices } from "@/lib/sessions";
import { RequestsBoard } from "@/components/roster/requests-board";
import { MyServices } from "@/components/roster/my-services";
import { AutoRefresh } from "@/components/auto-refresh";
import { NewMenu } from "@/components/roster/new-menu";
import { BroadcastActionables } from "@/components/broadcasts";
import { loadBroadcastActionables } from "@/lib/broadcasts";

export const metadata: Metadata = { title: "Roster · Brighton Worship" };

function Panel({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={title} className="flex min-h-0 flex-[1_1_0px] scroll-mt-4 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

async function RosterView() {
  const user = await requireUser();
  if (!user.can("roster.view")) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        You don&apos;t have access to the roster yet. Ask a worship team admin.
      </p>
    );
  }
  const today = todayYmd();
  const q = quarterOf(today);
  const next = nextQuarter(q);
  // Next quarter's roster shows up here as soon as it's published, for everyone who can see rosters.
  const [roster, upcoming] = await Promise.all([publishedRosterFor(today), publishedRosterFor(next.start)]);
  const canEdit = user.can("roster.edit");
  const [services, board, broadcasts] = await Promise.all([
    loadMyServices(user.id),
    loadRequestsBoard(user.id),
    user.isRoot ? loadBroadcastActionables() : Promise.resolve([]),
  ]);

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className={`flex flex-1 flex-col gap-2 sm:flex-row ${upcoming ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
          {roster ? (
            <Link
              href="/roster/current"
              className="group flex flex-1 items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-ink-foreground transition hover:bg-ink/90 sm:max-w-xl"
            >
              <span>
                <span className="block text-xs uppercase tracking-wider text-ink-foreground/60">This quarter&apos;s roster</span>
                <span className="font-medium">{formatRange(roster.starts_on, roster.ends_on)}</span>
              </span>
              <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
            </Link>
          ) : (
            <div className="flex-1 rounded-xl border border-dashed border-border px-4 py-3 sm:max-w-xl">
              <span className="block text-xs uppercase tracking-wider text-muted">This quarter&apos;s roster</span>
              <span className="font-medium">{formatRange(q.start, q.end)}</span>
              <span className="block text-sm text-muted">Not published yet.</span>
            </div>
          )}
          {upcoming && (
            <Link
              href="/roster/current?quarter=next"
              className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-accent/50 sm:w-56 sm:flex-none"
            >
              <span className="min-w-0">
                <span className="block text-xs uppercase tracking-wider text-muted">Next quarter</span>
                <span className="font-medium">{quarterOf(upcoming.starts_on).label}</span>
              </span>
              <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
            </Link>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/roster/past"
              className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50"
            >
              View past rosters
            </Link>
            <NewMenu isRoot={user.isRoot} />
          </div>
        )}
      </div>

      {/* Roster updates are in the nav's inbox. */}
      <MyServices services={services} />
      <Panel title={user.isRoot ? "Actionables" : "Requests"} id="requests">
        <RequestsBoard board={board} before={broadcasts.length > 0 && <BroadcastActionables items={broadcasts} />} />
      </Panel>
    </div>
  );
}

export default function RosterPage() {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<CalendarLoader label="Loading the roster" className="py-24" />}>
        <RosterView />
      </Suspense>
    </>
  );
}
