import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarLoader } from "@/components/calendar-loader";
import { requireTeamUser } from "@/lib/auth";
import { formatRange, nextQuarter, quarterOf, todayYmd } from "@/lib/roster";
import { listRosters, type RosterRow } from "@/lib/roster-data";
import { RosterList, type RosterItem } from "@/components/roster/roster-list";

export const metadata: Metadata = { title: "Rosters · Brighton Worship" };

const stageOf = (r: RosterRow): RosterItem["stage"] => (r.status === "published" ? "published" : r.generated_at ? "draft" : "start");

/** Current rosters (drafts, and published ones that haven't ended). Past ones live on /roster/past. */
async function Rosters() {
  const user = await requireTeamUser("/roster/new", "team");
  if (!user.can("roster.edit")) notFound();
  const today = todayYmd();
  const all = await listRosters(user.team.id);
  const current = all
    .filter((r) => r.status === "draft" || (r.status === "published" && r.ends_on >= today))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.status.localeCompare(b.status));

  const items: RosterItem[] = current.map((r) => {
    const stage = stageOf(r);
    return {
      id: r.id,
      label: quarterOf(r.starts_on).label,
      range: formatRange(r.starts_on, r.ends_on),
      stage,
      href: stage === "published" ? `/roster/${r.id}` : stage === "draft" ? `/roster/${r.id}/generated` : `/roster/${r.id}/plan`,
    };
  });

  // What already exists per quarter (a draft wins over a published one: that's what you'd open).
  const existing: Record<string, RosterItem["stage"]> = {};
  for (const r of current) {
    const q = quarterOf(r.starts_on);
    const key = `${q.start.slice(0, 4)}-${q.label.slice(0, 2)}`;
    if (r.status === "draft" || !existing[key]) existing[key] = stageOf(r);
  }

  // Suggest the quarter after the latest current roster (or this quarter if there are none).
  const latest = current.at(-1);
  const suggest = latest ? nextQuarter(quarterOf(latest.starts_on)) : quarterOf(today);
  const defaultQuarter = { year: Number(suggest.start.slice(0, 4)), q: Number(suggest.label[1]) };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link href="/roster" className="text-sm text-muted hover:text-foreground">
          ← Roster
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="font-display text-4xl font-semibold">Rosters</h1>
          <Link href="/roster/past" className="text-sm text-accent underline-offset-2 hover:underline">
            Past rosters →
          </Link>
        </div>
      </div>
      <RosterList rosters={items} isLead={user.isLead} existing={existing} defaultQuarter={defaultQuarter} teamConfig={user.team.config} />
    </div>
  );
}

export default function RostersPage() {
  return (
    <Suspense fallback={<CalendarLoader label="Loading the rosters" className="py-24" />}>
      <Rosters />
    </Suspense>
  );
}
