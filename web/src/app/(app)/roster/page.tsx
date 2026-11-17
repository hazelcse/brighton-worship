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
import { QuarterSwitchButton } from "@/components/roster/quarter-switch-button";
import { BroadcastActionables } from "@/components/broadcasts";
import { loadBroadcastActionables } from "@/lib/broadcasts";
import { loadTeams } from "@/lib/teams";
import type { TeamGroup } from "@/lib/team-config";

/**
 * Root's Schedule: root is on no team, so instead of one team's roster page it gets a button per
 * team for that team's roster this quarter (an observer gets the same, for its group's teams). Each switches root to the team first (root works in one
 * team at a time), then opens the roster; a team with nothing published just says so.
 */
async function RootRosters({ group }: { group?: TeamGroup }) {
  const today = todayYmd();
  // An observer: only its group's teams (e.g. Youth Worship and Youth Media).
  const teams = (await loadTeams()).filter((t) => !group || t.group === group);
  const rosters = await Promise.all(teams.map((t) => publishedRosterFor(today, t.id)));
  const open = (slug: string, next: string) => `/teams/${slug}/open?next=${encodeURIComponent(next)}`;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="font-display text-4xl font-semibold">Rosters</h1>
        <p className="text-sm text-muted">{quarterOf(today).label}: each team&apos;s current roster.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {teams.map((t, i) => {
          const r = rosters[i];
          return (
            <li key={t.id}>
              {/* Plain links (not prefetched): following one switches team. */}
              {r ? (
                <a
                  href={open(t.slug, "/roster/current")}
                  className="group flex h-full items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-ink-foreground transition hover:bg-ink/90"
                >
                  <span>
                    <span className="block text-xs uppercase tracking-wider text-ink-foreground/60">{t.name}</span>
                    <span className="font-medium">{formatRange(r.starts_on, r.ends_on)}</span>
                  </span>
                  <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
                </a>
              ) : (
                // Nothing to open: the same dashed card, but not a link.
                <div className="flex h-full items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3">
                  <span>
                    <span className="block text-xs uppercase tracking-wider text-muted">{t.name}</span>
                    <span className="text-sm text-muted">No roster published this quarter</span>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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
  const user = await requireUser("team");
  if (!user.can("roster.view")) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        You don&apos;t have access to the roster yet. Ask a worship team admin.
      </p>
    );
  }
  if (user.isRoot) return <RootRosters />;
  if (user.observerGroup) return <RootRosters group={user.observerGroup} />;
  const team = user.team;
  if (!team) return <RootRosters />;
  const today = todayYmd();
  const q = quarterOf(today);
  const next = nextQuarter(q);
  // Next quarter's roster shows up here as soon as it's published, for everyone who can see rosters.
  const [roster, upcoming] = await Promise.all([publishedRosterFor(today, team.id), publishedRosterFor(next.start, team.id)]);
  const canEdit = user.can("roster.edit");
  const [services, board, broadcasts] = await Promise.all([
    loadMyServices(user.id, team.id),
    loadRequestsBoard(user.id),
    user.isLead ? loadBroadcastActionables(team.id) : Promise.resolve([]),
  ]);

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* With both rosters out, one button on every screen; hold it to flip to next quarter. */}
        {roster && upcoming && (
          <QuarterSwitchButton
            className="sm:max-w-xl"
            current={{ href: "/roster/current", heading: "This quarter's roster", range: formatRange(roster.starts_on, roster.ends_on) }}
            next={{ href: "/roster/current?quarter=next", heading: "Next quarter's roster", range: formatRange(upcoming.starts_on, upcoming.ends_on) }}
          />
        )}
        <div
          className={`flex-1 flex-col gap-2 sm:flex-row ${
            roster && upcoming ? "hidden" : "flex"
          } ${upcoming ? "sm:max-w-3xl" : "sm:max-w-xl"}`}
        >
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
          // Phones: View past rosters at the left, + at the right (from 640px the pair sits at the right together).
          <div className="flex flex-wrap justify-between gap-2">
            <Link
              href="/roster/past"
              className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50"
            >
              View past rosters
            </Link>
            <NewMenu isLead={user.isLead} teamConfig={team.config} />
          </div>
        )}
      </div>

      {/* Roster updates are in the nav's inbox. */}
      <MyServices services={services} />
      <Panel title={user.isLead ? "Actionables" : "Requests"} id="requests">
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
