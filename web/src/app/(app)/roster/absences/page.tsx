import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarLoader } from "@/components/calendar-loader";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayYmd } from "@/lib/roster";
import { ScheduleView, type Absence, type Area, type ServiceEvent } from "@/components/schedule/schedule-view";
import { loadCoverDetail, loadMySessions } from "@/lib/serving";
import { AutoRefresh } from "@/components/auto-refresh";
import { groupTeams, loadTeams, teamMemberIds, type Team } from "@/lib/teams";

export const metadata: Metadata = { title: "Absences · Brighton Worship" };

async function Schedule({ searchParams }: { searchParams: Promise<{ cover?: string }> }) {
  const user = await requireUser();
  // No permission needed: absences are personal, so everyone sees and manages their own. Seeing
  // other people's (and every service) is for leads, root and observers, below. Observers are on no
  // team and can't add absences.

  // Members only ever receive their own absences; the lead (and root) gets those of everyone on this
  // team (and can filter to their own). Absences are personal and count for every team someone is on,
  // so someone on two teams shows in both, but a lead never sees people who aren't on their team.
  // Root is on no team and oversees them all: everyone's absences, on every team.
  // A team is small, so all of them are loaded and the calendar pages through them in the browser.
  let query = createAdminClient()
    .from("absences")
    .select("id, member_id, starts_on, ends_on, reason, profiles(full_name, email)")
    .order("starts_on")
    .order("ends_on");
  // An observer (on no team) sees everyone on its group's teams, e.g. Youth Worship and Youth Media,
  // filtered by team; one root hasn't allowed to see absences gets none at all (services only).
  const observed = user.observerGroup ? await groupTeams(user.observerGroup) : null;
  const teamsOf = observed && user.observerSeesAbsences ? await personTeams(observed.map((t) => t.id)) : null;
  if (teamsOf) query = query.in("member_id", [...teamsOf.keys()]);
  else if (!user.isRoot) query = user.isLead ? query.in("member_id", [...new Set([...(await teamMemberIds(user.team.id)), user.id])]) : query.eq("member_id", user.id);
  const [{ data }, personAreas] = await Promise.all([
    observed && !teamsOf ? Promise.resolve({ data: [] as never[] }) : query,
    user.isRoot ? loadPersonAreas() : Promise.resolve(teamsOf),
  ]);

  const absences: Absence[] = (data ?? []).map((a) => {
    const p = a.profiles as unknown as { full_name: string; email: string } | null;
    return {
      id: a.id,
      memberId: a.member_id,
      memberName: p?.full_name || p?.email || "Someone",
      startsOn: a.starts_on,
      endsOn: a.ends_on,
      reason: a.reason,
      ...(personAreas ? { areas: personAreas.get(a.member_id) ?? [] } : {}),
    };
  });

  const { cover: coverId } = await searchParams;
  const [services, mySessions, cover] = await Promise.all([
    // Root: every team's services and rehearsals; a lead: their own team's.
    user.isRoot
      ? loadTeams().then((ts) => loadServices(ts.map((t) => t.id), new Map(ts.map((t) => [t.id, t]))))
      : observed
        ? loadServices(observed.map((t) => t.id), undefined, { byTeam: Boolean(teamsOf) })
        : user.isLead
          ? loadServices([user.team.id])
          : Promise.resolve([]),
    observed ? Promise.resolve([]) : loadMySessions(user.id),
    coverId ? loadCoverDetail(coverId, user.id) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-3">
      {coverId && !cover && (
        <p role="status" className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          That request has already been covered or withdrawn.
        </p>
      )}
      <ScheduleView
        key={cover?.id ?? "schedule"}
        absences={absences}
        services={services}
        today={todayYmd()}
        userId={user.id}
        // An observer oversees like a lead (everyone's absences, every service) but adds none. Its
        // filter is by team (not person); without absences it gets a list of upcoming services instead.
        isLead={user.isLead || user.isObserver}
        readOnly={user.isObserver}
        {...(teamsOf && observed ? { teamFilter: observed.map((t) => ({ value: t.id, label: t.name })) } : {})}
        servicesOnly={Boolean(observed && !teamsOf)}
        mySessions={mySessions}
        cover={cover}
      />
    </div>
  );
}

/**
 * Leads and root: every planned (not cancelled) session of these teams. Each team's quarter uses
 * one roster: the published one if there is one, else the previous published (archived) one, else
 * the draft being planned.
 */
async function loadServices(teamIds: string[], teamOf?: Map<string, Team>, { byTeam = false } = {}): Promise<ServiceEvent[]> {
  const db = createAdminClient();
  const { data: rosters } = await db.from("rosters").select("id, team_id, starts_on, status").in("team_id", teamIds);
  const rank = (s: string) => (s === "published" ? 0 : s === "archived" ? 1 : s === "draft" ? 2 : 3);
  const best = new Map<string, { id: string; status: string }>();
  const teamOfRoster = new Map((rosters ?? []).map((r) => [r.id as string, r.team_id as string]));
  for (const r of rosters ?? []) {
    const key = `${r.team_id}|${r.starts_on}`;
    const cur = best.get(key);
    if (!cur || rank(r.status) < rank(cur.status)) best.set(key, { id: r.id, status: r.status });
  }
  const ids = [...best.values()].map((r) => r.id);
  if (!ids.length) return [];
  const { data } = await db
    .from("roster_sessions")
    .select("id, date, name, kind, ministry, rehearsal_date, roster_id")
    .in("roster_id", ids)
    .eq("cancelled", false)
    .order("date")
    .order("name");
  // Root's area filter: a Youth team's sessions are Youth; Main Media's are EM Media (it only crews
  // the EM service); Main Worship's are EM Worship, CM or both (the session's ministry).
  const areasOf = (s: { roster_id: string; ministry: string | null }): { areas?: Area[] } => {
    // An observer's team filter: each session is tagged with its team.
    if (byTeam) return { areas: [teamOfRoster.get(s.roster_id)!] };
    if (!teamOf) return {};
    const team = teamOf.get(teamOfRoster.get(s.roster_id)!);
    if (team?.group === "youth") return { areas: ["youth"] };
    if (team?.kind === "media") return { areas: ["em_media"] };
    return { areas: s.ministry === "em" ? ["em_worship"] : s.ministry === "cm" ? ["cm"] : ["em_worship", "cm"] };
  };
  return (data ?? [])
    .flatMap((s): ServiceEvent[] => [
      { id: s.id, date: s.date, name: s.name, kind: s.kind ?? "custom", ...areasOf(s) },
      ...(s.rehearsal_date
        ? [
            {
              id: `${s.id}:rehearsal`,
              date: s.rehearsal_date as string,
              name: `Rehearsal: ${s.name}`,
              kind: "rehearsal",
              forSession: { date: s.date, name: s.name, kind: s.kind ?? "custom" },
              ...areasOf(s),
            },
          ]
        : []),
    ])
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** An observer's team filter: the teams (of these) each person is on, by person. */
async function personTeams(teamIds: string[]): Promise<Map<string, Area[]>> {
  const { data } = await createAdminClient().from("team_members").select("user_id, team_id").in("team_id", teamIds);
  const out = new Map<string, Area[]>();
  for (const m of data ?? []) out.set(m.user_id as string, [...(out.get(m.user_id as string) ?? []), m.team_id as string]);
  return out;
}

/**
 * Root's area filter: each person's areas from the teams they're on. Youth teams make them Youth;
 * Main Media makes them EM Media (it only crews the EM Sunday service); on Main Worship their EM/CM
 * share makes them EM Worship, CM or both.
 */
async function loadPersonAreas(): Promise<Map<string, Area[]>> {
  const teams = new Map((await loadTeams()).map((t) => [t.id, t]));
  const { data } = await createAdminClient().from("team_members").select("user_id, team_id, em_percent");
  const out = new Map<string, Set<Area>>();
  for (const m of data ?? []) {
    const team = teams.get(m.team_id as string);
    if (!team) continue;
    const set = out.get(m.user_id as string) ?? new Set<Area>();
    const em = m.em_percent as number | null;
    if (team.group === "youth") set.add("youth");
    else if (team.kind === "media") set.add("em_media");
    else if (!team.config.memberFields.ministry || em === null) set.add("em_worship").add("cm");
    else {
      if (em > 0) set.add("em_worship");
      if (em < 100) set.add("cm");
    }
    out.set(m.user_id as string, set);
  }
  return new Map([...out].map(([id, s]) => [id, [...s]]));
}

export default function SchedulePage({ searchParams }: { searchParams: Promise<{ cover?: string }> }) {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<CalendarLoader label="Loading absences" className="py-24" />}>
        <Schedule searchParams={searchParams} />
      </Suspense>
    </>
  );
}
