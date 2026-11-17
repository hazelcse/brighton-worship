import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { CalendarLoader } from "@/components/calendar-loader";
import { requireTeamUser } from "@/lib/auth";
import { addDays, formatRange, makeSentence, quarterOf, usesMinistry } from "@/lib/roster";
import { loadAbsences, loadAssignments, loadPeople, loadResult, loadRoster, loadRules } from "@/lib/roster-data";
import { describeCheck, problemCells, rosterProblems } from "@/lib/roster-check";
import { EditWarnings } from "@/components/roster/edit-warnings";
import { GeneratedActions, LoadsButton } from "@/components/roster/generated-actions";
import { RevisionActions, RevisionBadges, RevisionEditing, RevisionRosterTable } from "@/components/roster/revision-controls";
import { FilteredRosterTable, MobileRosterFilter, RosterFilterProvider } from "@/components/roster/roster-filter";
import { HighlightProvider } from "@/components/roster/highlight";
import { WidePage } from "@/components/wide-page";
import { LoadsTable, ResultStatus, RulesPanel, WeightsPanel } from "@/components/roster/roster-results";
import { splitsMinistry } from "@/lib/team-config";

export const metadata: Metadata = { title: "Generated roster · Brighton Worship" };

/** "2026 Q4", for the title of a published roster being edited. */
function quarterTitle(startsOn: string): string {
  const [q, y] = quarterOf(startsOn).label.split(" ");
  return `${y} ${q}`;
}

/** The roster the optimiser just produced: table in the main area, weights and rule outcomes at the side. */
async function GeneratedView({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTeamUser(`/roster/${(await params).id}/generated`, "team");
  if (!user.can("roster.edit")) notFound();
  const { id } = await params;
  const [data, rules, people] = await Promise.all([loadRoster(id, user.team.id), loadRules(id, user.team.id), loadPeople(user.team)]);
  if (!data) notFound();
  const { roster, sessions } = data;
  const [{ result: generated, generatedAt, check, hasSnapshot, generatedKeys }, assignments, absences] = await Promise.all([
    loadResult(id),
    loadAssignments(sessions.map((s) => s.id)),
    loadAbsences(addDays(roster.starts_on, -14), roster.ends_on) // from before the quarter: early rehearsals,
  ]);
  if (!generated) redirect(`/roster/${id}/plan`);
  // Root's edit of a published roster uses this page too.
  const revision = roster.status === "revision";
  if (revision && !user.isLead) notFound();
  if (roster.status !== "draft" && !revision) redirect(`/roster/${id}`);

  const sentence = makeSentence(rules, people);
  // Permanent rules are summarised elsewhere, except singer balance and BL/TB backup: they're listed
  // with the soft rules so their misses (unbalanced bands, a BL/TB nobody can stand in for) can be
  // highlighted on the roster.
  const banded = ["singer_balance", "bl_backup"];
  const builtInIds = new Set(rules.filter((r) => r.permanent && !banded.includes(r.params.template)).map((r) => r.id));
  // After hand edits, show the scores of the edited roster rather than the generated one.
  const result = check?.result ?? generated;
  const hard = rosterProblems(check, generated, sessions, people, sentence);
  const soft = check ? describeCheck(check, sessions, people, sentence).soft : [];
  const editedCells = check?.edited_cells ?? [];

  // Editing a published roster: the published version, for the edited / published toggle.
  const publishedData = revision ? await loadRoster(roster.revision_of!, user.team.id) : null;
  const publishedAssignments = publishedData ? await loadAssignments(publishedData.sessions.map((s) => s.id)) : [];
  // Whether the edit differs from the published roster yet (the "Unpublished changes" badge):
  // the same people in the same places, matched through each copied session's source.
  const unpublished = (() => {
    if (!publishedData) return false;
    const source = new Map(sessions.map((s) => [s.id, (s as { source_session_id?: string | null }).source_session_id ?? s.id]));
    const line = (sessionId: string, a: (typeof assignments)[number]) => `${sessionId}|${a.member_id}|${a.role}|${[...a.also_roles].sort()}`;
    const mine = assignments.map((a) => line(source.get(a.session_id) ?? a.session_id, a)).sort();
    const theirs = publishedAssignments.map((a) => line(a.session_id, a)).sort();
    // Each session's settings (date, band, who can serve, times…), so changing only those counts too,
    // as do sessions added or removed in the edit.
    const settings = (list: typeof sessions, id: (s: (typeof sessions)[number]) => string) =>
      list
        .map((s) =>
          JSON.stringify([
            id(s), s.date, s.name, s.ministry, Number(s.weight), s.cancelled, s.note ?? "", s.rehearsal_date, s.start_time, s.rehearsal_time,
            Object.entries(s.composition ?? {}).filter(([, n]) => Number(n) > 0).sort(),
          ]),
        )
        .sort()
        .join("\n");
    return (
      mine.join("\n") !== theirs.join("\n") ||
      settings(sessions, (s) => source.get(s.id)!) !== settings(publishedData.sessions, (s) => s.id)
    );
  })();

  const tableEdit = user.isLead
    ? {
        rosterId: roster.id,
        people: people.map((p) => ({
          ...p,
          serves: p.serves ?? "both",
          away: absences.filter((a) => a.memberId === p.id),
        })),
        editedCells,
        generatedKeys,
        problemCells: problemCells(check, generated, sessions, people, sentence),
        quarter: { start: roster.starts_on, end: roster.ends_on },
        // "Serve less" shares from the fairness rule (everyone else is 1)
        shares: (() => {
          const f = rules.find((r) => r.params.template === "fairness")?.params;
          return f && f.template === "fairness" ? (f.reduced ?? {}) : {};
        })(),
      }
    : undefined;

  // EM/CM filter, column and loads: only for a team that splits EM and CM (not media) with EM/CM sessions.
  const showMinistry = splitsMinistry(user.team.config) && usesMinistry(sessions);

  return (
    <RevisionEditing rosterId={roster.id} assignments={assignments} sessions={sessions}>
    {/* Shares the table's filters with the phone-only filter dropdown in the header's button row. */}
    <RosterFilterProvider showMinistry={showMinistry} sessions={sessions}>
    <div className="space-y-5">
      {/* Wider than the nav, so every roster column fits (see LAYOUT.md). */}
      <WidePage />
      {/* Stacked (below 1024px): 16px between the date range and the filter / buttons row. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-3">
        <div>
          {revision ? (
            // Badges sit to the right of the title at every width (each one wraps on its own if it doesn't fit).
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <h1 className="mr-1 font-display text-4xl font-semibold">{quarterTitle(roster.starts_on)} Roster</h1>
              <RevisionBadges unpublished={unpublished} />
            </div>
          ) : (
            <>
              <p className="text-sm text-muted">{quarterOf(roster.starts_on).label} · Draft</p>
              <h1 className="font-display text-4xl font-semibold">Generated roster</h1>
            </>
          )}
          <p className="text-sm text-muted">{formatRange(roster.starts_on, roster.ends_on)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MobileRosterFilter />
          <LoadsButton>
            <LoadsTable result={result} people={people} ministry={showMinistry} pnp={sessions.some((s) => s.kind.endsWith("_pnp"))} />
          </LoadsButton>
          {revision ? (
            <RevisionActions revisionId={roster.id} problems={hard.length} unpublished={unpublished} />
          ) : (
            <GeneratedActions
              rosterId={roster.id}
              isLead={user.isLead}
              edited={editedCells.length > 0 && hasSnapshot}
              problems={hard.length}
            />
          )}
        </div>
      </div>

      <HighlightProvider>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          {publishedData ? (
            // Editing a published roster: the pencil turns cell editing on, like the session editor.
            <RevisionRosterTable
              sessions={sessions}
              assignments={assignments}
              edit={tableEdit}
              published={{ sessions: publishedData.sessions, assignments: publishedAssignments }}
              {...(user.isLead ? { peopleFilter: true } : { meId: user.id })}
            />
          ) : (
            <FilteredRosterTable splitsMinistry={showMinistry} teamConfig={user.team.config} sessions={sessions} assignments={assignments} edit={tableEdit} {...(user.isLead ? { peopleFilter: true } : { meId: user.id })} />
          )}
        </div>
        <aside className="space-y-3 text-sm">
          <EditWarnings rosterId={roster.id} hard={hard} soft={soft} />
          <ResultStatus
            result={result}
            generatedAt={generatedAt}
            edited={check ? { cells: editedCells.length, changePoints: check.score.change_points ?? 0, problems: hard.length } : undefined}
          />
          <RulesPanel result={result} sentence={sentence} isBuiltIn={(rid) => builtInIds.has(rid)} />
          <WeightsPanel result={result} sessions={sessions} sentence={sentence} />
        </aside>
      </div>
      </HighlightProvider>
    </div>
    </RosterFilterProvider>
    </RevisionEditing>
  );
}

export default function GeneratedPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<CalendarLoader label="Loading the roster" className="py-24" />}>
      <GeneratedView params={params} />
    </Suspense>
  );
}
