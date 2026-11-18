import { SessionCard } from "@/components/sessions/session-card";
import { ROLE_LABEL } from "@/lib/team-config";
import type { CrewMember, Service } from "@/lib/sessions";

const heading = "mb-1.5 text-xs font-medium uppercase tracking-wider text-muted";

/** A media crew: one line per role (lined up with the band), under "team · session" when there's more than one. */
export function Crew({ crew }: { crew: CrewMember[] }) {
  const groups = new Map<string, CrewMember[]>();
  for (const c of crew) {
    const key = `${c.team} · ${c.session}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return (
    <section aria-label="Media crew">
      <p className={heading}>Media crew</p>
      {groups.size ? (
        <div className="space-y-3">
          {[...groups].map(([key, members]) => {
            const roles = new Map<string, string[]>();
            for (const c of members) roles.set(c.role, [...(roles.get(c.role) ?? []), c.name]);
            return (
              <div key={key}>
                {groups.size > 1 && <p className="mb-1 text-xs text-muted">{key}</p>}
                {/* Two columns (filled top to bottom) once the card is wide enough, like the band. */}
                <dl className="gap-x-6 text-sm @md:columns-2">
                  {[...roles].map(([role, people]) => (
                    <div key={role} className="flex break-inside-avoid gap-3 py-0.5">
                      <dt className="w-24 shrink-0 text-xs leading-5 text-muted">{ROLE_LABEL[role] ?? role}</dt>
                      <dd className="min-w-0 flex-1">{people.join(", ")}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted">No media crew on a published roster yet.</p>
      )}
    </section>
  );
}

/**
 * Each service's header tint: soft, low-saturation colours that sit with the warm off-white
 * background. EM is warm (sage, clay), CM cool (slate blue, lavender), ad hoc a dusty rose,
 * YF Saturday a soft straw yellow.
 */
export const SERVICE_TINT: Record<string, string> = {
  em_sunday: "bg-[#e9ede3]",
  cm_sunday: "bg-[#e4e9ef]",
  em_pnp: "bg-[#f1e7dc]",
  cm_pnp: "bg-[#ebe6ef]",
  custom: "bg-[#f0e3e3]",
  saturday: "bg-[#f2ecd6]",
};

/**
 * A service as root sees it: its session (plan and band) and, for services that have one (EM Sunday,
 * EM PnP, YF Saturday), its media crew at the bottom. Opening it switches root to the worship team
 * first (root works in one team at a time), then opens the plan.
 */
export function ServiceCard({
  service,
  ownTeam,
}: {
  service: Service;
  /** A team's own Services page; `detailBase` (its lead's): each card opens the service at `${detailBase}/<its session>`. */
  ownTeam?: { id: string; slug: string; opensPlans: boolean; detailBase?: string };
}) {
  const plan = service.session.plan;
  // A team's own Services page: only its own plans open (straight, no team switch); another team's
  // session shows its songs and people without a link.
  if (ownTeam) {
    const opens = Boolean(plan) && ownTeam.opensPlans && service.teamSlug === ownTeam.slug;
    const own = service.sessionIdByTeam[ownTeam.id];
    return (
      <SessionCard
        // The lead's cards: no "You: (role)" line.
        s={{ ...service.session, role: ownTeam.detailBase ? null : service.session.role, plan: plan && { ...plan, canOpen: opens } }}
        href={ownTeam.detailBase && own ? `${ownTeam.detailBase}/${own}` : undefined}
        headerTint={SERVICE_TINT[service.session.kind]}
        extra={service.crew ? <Crew crew={service.crew} /> : undefined}
      />
    );
  }
  return (
    <SessionCard
      s={service.session}
      headerTint={SERVICE_TINT[service.session.kind]}
      href={plan ? `/teams/${service.teamSlug}/open?next=/sessions/${plan.id}` : undefined}
      extra={service.crew ? <Crew crew={service.crew} /> : undefined}
    />
  );
}
