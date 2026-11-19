import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionCard } from "@/components/sessions/session-card";
import { SequenceView } from "@/components/sessions/sequence-builder";
import { ServiceLinkButton } from "@/components/roster/service-link";
import { WidePage } from "@/components/wide-page";
import { formatDate } from "@/lib/roster";
import { keyLabel, type PlanSection } from "@/lib/session-plan";
import { loadServiceDetail } from "@/lib/sessions";
import type { Team } from "@/lib/teams";

const heading =
  "mb-1.5 text-xs font-medium uppercase tracking-wider text-muted";

/** The session itself, read-only: each section's songs with key, lead and sequence. */
function SessionPlan({
  plan,
  leads,
}: {
  plan: PlanSection[];
  leads: Map<string, string>;
}) {
  const sections = plan
    .map((sec) => ({ ...sec, items: sec.items.filter((i) => i.title) }))
    .filter((sec) => sec.items.length);
  if (!sections.length)
    return <p className="text-sm text-muted">No songs yet.</p>;
  return (
    <div className="space-y-5">
      {sections.map((sec) => (
        <div key={sec.id}>
          <p className={heading}>{sec.name}</p>
          <ol className="divide-y divide-border rounded-lg border border-border">
            {sec.items.map((item, i) => {
              const key = keyLabel(item.key, item.transpose_to);
              const lead = item.lead_id ? leads.get(item.lead_id) : null;
              return (
                <li key={item.id} className="space-y-1.5 px-3 py-2.5">
                  <p className="flex items-baseline gap-2 text-sm">
                    <span className="w-4 shrink-0 text-right text-xs text-muted">
                      {i + 1}.
                    </span>
                    <span className="min-w-0 flex-1 font-medium">
                      {item.title}
                      {key && (
                        <span className="font-normal text-muted"> — {key}</span>
                      )}
                      {item.kind === "transition" && (
                        <span className="font-normal text-muted">
                          {" "}
                          (transition)
                        </span>
                      )}
                    </span>
                    {lead && (
                      <span className="shrink-0 text-xs text-muted">
                        Led by {lead}
                      </span>
                    )}
                  </p>
                  {item.kind === "song" && (
                    <div className="pl-6">
                      <SequenceView steps={item.sequence ?? []} />
                    </div>
                  )}
                  {item.notes && (
                    <p className="pl-6 text-xs whitespace-pre-line text-muted">
                      {item.notes}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

/**
 * A service, as one of its teams' leads sees it (from their Services page): every team serving at
 * it, each as a card with its band or crew, and the session (songs and sequence) on the right on
 * the wide page. With no worship team serving (no session), just the teams, in the usual column.
 * An ad hoc service has the lead's linking controls, which change only their own team's session.
 */
export async function ServiceDetail({
  userId,
  team,
  sessionId,
  back,
  observer = false,
}: {
  userId: string;
  team: Team;
  sessionId: string;
  back: string;
  /**
   * An observer's view: `team` is just the team the service was opened from (it's on none), so no
   * "(your team)" and no linking; the plan opens in its worship team.
   */
  observer?: boolean;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) notFound();
  const service = await loadServiceDetail(userId, team, sessionId);
  if (!service) notFound();
  const custom = service.kind === "custom";
  const worshipTeam = service.teams.find((t) => t.team.kind === "worship")?.team;
  const planHref = !service.session?.planId
    ? null
    : observer
      ? worshipTeam && `/teams/${worshipTeam.slug}/open?next=${encodeURIComponent(`/sessions/${service.session.planId}`)}`
      : service.session.canOpen
        ? `/sessions/${service.session.planId}`
        : null;

  const header = (
    <div className="space-y-3">
      <Link href={back} className="text-sm text-muted hover:text-foreground">
        ← Services
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted">
            {formatDate(service.date, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
          <h1 className="font-display text-3xl font-semibold">
            {service.name}
          </h1>
          <p className="text-sm text-muted">
            {service.teams.map((t) => t.team.name).join(", ")}
            {custom
              ? " · ad hoc service"
              : " · linked automatically (a standard service)"}
          </p>
        </div>
        {custom && !observer && (
          <ServiceLinkButton
            sessionId={service.ownSessionId}
            date={service.date}
          />
        )}
      </div>
    </div>
  );

  const teams = (
    <div className="space-y-4">
      {service.teams.map((t) => (
        <SessionCard
          key={t.session.rosterSessionId}
          s={{ ...t.session, plan: null, role: null }}
          songs={false}
          dated={false}
          kicker={`${t.team.name}${!observer && t.team.id === team.id ? " (your team)" : ""}${t.rosterStatus === "draft" ? " · draft roster" : ""}`}
        />
      ))}
    </div>
  );

  if (!service.session) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {header}
        {teams}
      </div>
    );
  }

  const worship = service.teams.find((t) => t.team.kind === "worship");
  const leads = new Map(
    (worship?.session.band ?? []).map((m) => [m.id, m.name]),
  );
  return (
    <>
      {/* The teams and the session side by side need the room (the owner asked for the wide page here). */}
      <WidePage />
      <div className="space-y-6">
        {header}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
          {teams}
          <section
            aria-label="Session"
            className="overflow-hidden rounded-xl border border-border bg-surface"
          >
            <header
              className={`bg-background/60 flex flex-wrap items-center justify-between gap-2 px-4 py-3`}
            >
              <div>
                <p className="text-sm font-semibold">Session</p>
                <p className="text-xs text-muted">
                  Songs and sequence, by {service.session.team}
                </p>
              </div>
              {planHref && (
                <Link
                  href={planHref}
                  prefetch={observer ? false : undefined}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent/50"
                >
                  Open plan
                </Link>
              )}
            </header>
            <div className="p-4">
              {service.session.plan ? (
                <SessionPlan plan={service.session.plan} leads={leads} />
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted">
                  The worship leaders haven&apos;t published the plan yet.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
