import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarLoader } from "@/components/calendar-loader";
import { requireTeamUser } from "@/lib/auth";
import { formatRange, hhmm, quarterOf } from "@/lib/roster";
import { loadPeople, loadResult, loadRoster, loadRules } from "@/lib/roster-data";
import { GenerateControls } from "@/components/roster/generate-controls";
import { SessionPlanner } from "@/components/roster/session-planner";
import { RulesEditor } from "@/components/roster/rules-editor";
import { DeleteDraftButton } from "@/components/roster/delete-draft-button";
import { linkedTeamsFor } from "@/lib/service-links";

export const metadata: Metadata = { title: "Plan roster · Brighton Worship" };

async function PlanView({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTeamUser(`/roster/${(await params).id}/plan`, "team");
  if (!user.can("roster.edit")) notFound();
  const { id } = await params;
  const [data, rules, people] = await Promise.all([loadRoster(id, user.team.id), loadRules(id, user.team.id), loadPeople(user.team)]);
  if (!data) notFound();
  const { roster, sessions } = data;
  const [{ result }, linked] = await Promise.all([loadResult(roster.id), linkedTeamsFor(sessions.map((s) => s.id))]);
  // Root's edit of a published roster: its sessions can be changed, but it isn't generated again.
  const revision = roster.status === "revision";
  if (revision && !user.isLead) notFound();
  const editable = roster.status === "draft" || revision;
  const q = quarterOf(roster.starts_on);
  const active = sessions.filter((s) => !s.cancelled);
  const weightTotals = active.reduce<Record<string, { n: number; w: number }>>((acc, s) => {
    const k = s.name;
    acc[k] = { n: (acc[k]?.n ?? 0) + 1, w: s.weight };
    return acc;
  }, {});

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <Link href="/roster" className="text-sm text-muted hover:text-foreground">
          ← Roster
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">
              {q.label} · {revision ? "Editing the published roster" : editable ? "Draft" : roster.status}
            </p>
            <h1 className="font-display text-4xl font-semibold">{revision ? "Edit sessions" : "Plan the roster"}</h1>
            <p className="text-sm text-muted">{formatRange(roster.starts_on, roster.ends_on)}</p>
          </div>
          {revision ? (
            <Link
              href={`/roster/${roster.id}/generated`}
              className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50"
            >
              ← Back to the roster
            </Link>
          ) : (
            editable && <DeleteDraftButton rosterId={roster.id} />
          )}
        </div>
      </div>

      <SessionPlanner
        rosterId={roster.id}
        teamConfig={user.team.config}
        editable={editable}
        quarter={{ start: roster.starts_on, end: roster.ends_on }}
        sessions={sessions.map((s) => ({
          id: s.id,
          date: s.date,
          kind: s.kind,
          name: s.name,
          ministry: s.ministry,
          weight: s.weight,
          composition: s.composition,
          cancelled: s.cancelled,
          cancel_reason: s.cancel_reason ?? "",
          note: s.note,
          rehearsal_date: s.rehearsal_date,
          linkedTeams: linked.get(s.id),
          start_time: hhmm(s.start_time),
          rehearsal_time: hhmm(s.rehearsal_time),
        }))}
      />

      <RulesEditor
        rosterId={roster.id}
        rules={rules}
        people={people}
        isLead={user.isLead}
        editable={user.can("roster.edit") && !revision}
        sessions={sessions.map((s) => ({ date: s.date, kind: s.kind, name: s.name, ministry: s.ministry, cancelled: s.cancelled, composition: s.composition }))}
      />

      {!revision && (
      <section aria-labelledby="generate-title" className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <h2 id="generate-title" className="text-lg font-semibold">
          3. Generate
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Session weights</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-muted">
              {Object.entries(weightTotals).map(([name, { n, w }]) => (
                <li key={name}>
                  {name}: <span className="text-foreground">{w}</span> × {n}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium">Rules</h3>
            <p className="mt-1 text-sm text-muted">
              {rules.filter((r) => r.enabled && r.hard).length} hard · {rules.filter((r) => r.enabled && !r.hard).length} soft (
              {rules.filter((r) => !r.enabled).length} switched off)
            </p>
          </div>
        </div>
        {editable ? (
          <GenerateControls rosterId={roster.id} hasResult={Boolean(result)} />
        ) : (
          <p className="text-sm text-muted">This roster has been published.</p>
        )}
        <p className="text-xs text-muted">
          The optimiser (an integer linear programme) fills every place while following the hard rules, then balances the soft
          rules by weight, shares the load fairly and splits EM/CM by each person&apos;s percentage. Generating again replaces the
          draft&apos;s assignments.
        </p>
      </section>
      )}

    </div>
  );
}

export default function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<CalendarLoader label="Loading the plan" className="py-24" />}>
      <PlanView params={params} />
    </Suspense>
  );
}
