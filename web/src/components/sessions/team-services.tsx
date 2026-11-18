import { ServiceCard } from "@/components/sessions/service-card";
import { addDays, formatDate, weekday } from "@/lib/roster";
import { loadTeamServices } from "@/lib/sessions";
import type { Team } from "@/lib/teams";

/** How far ahead a team's Services page looks (as root's). */
const SERVICE_DAYS = 28;

/**
 * A team's Services page (worship leads under Sessions; everyone on a media team): the services it
 * serves at in the next four weeks, by date, each as root sees it (coloured header, session, band,
 * media crew). Its standard services with whoever else serves at them, and its own ad hoc services
 * (linked or not); other teams' ad hoc services only once they're linked to one of its own.
 */
export async function TeamServices({
  userId,
  team,
  opensPlans,
  detailBase,
}: {
  userId: string;
  team: Team;
  opensPlans: boolean;
  /** The lead's: cards open the service (its teams, the session and linking) under this path. */
  detailBase?: string;
}) {
  const services = await loadTeamServices(userId, team, SERVICE_DAYS);
  // Media teams: one section per week (Monday to Sunday), two cards per row, so a week's PnP and
  // Sunday service sit side by side and the next week starts a new row. Worship: one per date.
  const byWeek = team.kind === "media";
  const keyOf = (d: string) => (byWeek ? addDays(d, -((weekday(d) + 6) % 7)) : d);
  const groups = new Map<string, typeof services>();
  for (const s of services) groups.set(keyOf(s.date), [...(groups.get(keyOf(s.date)) ?? []), s]);
  const day = (d: string) => formatDate(d, { weekday: "long", day: "numeric", month: "long" });
  // "Week 3 of November": the week's Monday is that month's 3rd Monday.
  const heading = (d: string) =>
    byWeek ? `Week ${Math.ceil(Number(d.slice(8, 10)) / 7)} of ${formatDate(d, { month: "long" })}` : day(d);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Services</h1>
        <p className="text-sm text-muted">
          {team.name}&apos;s services in the next four weeks: the session, the band and, where it has one, the media crew. Ad hoc services
          show the other teams once they&apos;re linked.
        </p>
      </div>
      {groups.size ? (
        [...groups].map(([date, onDay]) => (
          <section key={date} aria-label={heading(date)} className="space-y-3">
            <h2 className="text-sm font-medium text-muted">{heading(date)}</h2>
            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              {onDay.map((s) => (
                <ServiceCard key={s.session.rosterSessionId} service={s} ownTeam={{ id: team.id, slug: team.slug, opensPlans, detailBase }} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          No services on a published roster in the next four weeks.
        </p>
      )}
    </div>
  );
}
