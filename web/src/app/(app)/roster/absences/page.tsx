import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarLoader } from "@/components/calendar-loader";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayYmd } from "@/lib/roster";
import { ScheduleView, type Absence, type ServiceEvent } from "@/components/schedule/schedule-view";
import { loadCoverDetail, loadMySessions } from "@/lib/serving";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Absences · Brighton Worship" };

async function Schedule({ searchParams }: { searchParams: Promise<{ cover?: string }> }) {
  const user = await requireUser();
  if (!user.can("roster.view")) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        You don&apos;t have access to absences yet. Ask a worship team admin.
      </p>
    );
  }

  // Members only ever receive their own absences; root gets everyone's (and can filter to their own).
  // A team is small, so all of them are loaded and the calendar pages through them in the browser.
  let query = createAdminClient()
    .from("absences")
    .select("id, member_id, starts_on, ends_on, reason, profiles(full_name, email)")
    .order("starts_on")
    .order("ends_on");
  if (!user.isRoot) query = query.eq("member_id", user.id);
  const { data } = await query;

  const absences: Absence[] = (data ?? []).map((a) => {
    const p = a.profiles as unknown as { full_name: string; email: string } | null;
    return {
      id: a.id,
      memberId: a.member_id,
      memberName: p?.full_name || p?.email || "Someone",
      startsOn: a.starts_on,
      endsOn: a.ends_on,
      reason: a.reason,
    };
  });

  const { cover: coverId } = await searchParams;
  const [services, mySessions, cover] = await Promise.all([
    user.isRoot ? loadServices() : Promise.resolve([]),
    loadMySessions(user.id),
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
        isRoot={user.isRoot}
        mySessions={mySessions}
        cover={cover}
      />
    </div>
  );
}

/**
 * Root only: every planned (not cancelled) session. Each quarter uses one roster: the published
 * one if there is one, else the previous published (archived) one, else the draft being planned.
 */
async function loadServices(): Promise<ServiceEvent[]> {
  const db = createAdminClient();
  const { data: rosters } = await db.from("rosters").select("id, starts_on, status");
  const rank = (s: string) => (s === "published" ? 0 : s === "archived" ? 1 : s === "draft" ? 2 : 3);
  const best = new Map<string, { id: string; status: string }>();
  for (const r of rosters ?? []) {
    const cur = best.get(r.starts_on);
    if (!cur || rank(r.status) < rank(cur.status)) best.set(r.starts_on, { id: r.id, status: r.status });
  }
  const ids = [...best.values()].map((r) => r.id);
  if (!ids.length) return [];
  const { data } = await db
    .from("roster_sessions")
    .select("id, date, name, kind, rehearsal_date")
    .in("roster_id", ids)
    .eq("cancelled", false)
    .order("date")
    .order("name");
  return (data ?? [])
    .flatMap((s): ServiceEvent[] => [
      { id: s.id, date: s.date, name: s.name, kind: s.kind ?? "custom" },
      ...(s.rehearsal_date
        ? [
            {
              id: `${s.id}:rehearsal`,
              date: s.rehearsal_date as string,
              name: `Rehearsal: ${s.name}`,
              kind: "rehearsal",
              forSession: { date: s.date, name: s.name, kind: s.kind ?? "custom" },
            },
          ]
        : []),
    ])
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
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
