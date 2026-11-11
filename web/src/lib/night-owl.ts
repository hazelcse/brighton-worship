import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sessionTime } from "@/lib/reminder";
import { teamNow } from "@/lib/roster";

/**
 * Between midnight and 5am on the day of a morning Sunday service (on a published roster), the
 * earliest one that day, for the landing page's "go to sleep". Otherwise null.
 */
export async function morningServiceTonight(now: Date = new Date()): Promise<{ name: string; time: string } | null> {
  const { ymd, hour } = teamNow(now);
  if (hour >= 5) return null;
  const db = createAdminClient();
  const { data: rosters } = await db.from("rosters").select("id").eq("status", "published");
  const ids = (rosters ?? []).map((r) => r.id);
  if (!ids.length) return null;
  const { data } = await db
    .from("roster_sessions")
    .select("date, name, kind, rehearsal_date, start_time, rehearsal_time")
    .in("roster_id", ids)
    .eq("date", ymd)
    .eq("cancelled", false)
    .in("kind", ["em_sunday", "cm_sunday"]);
  return (
    (data ?? [])
      .map((s) => ({
        name: s.name as string,
        time: sessionTime({ date: s.date, name: s.name, kind: s.kind, rehearsal: s.rehearsal_date, startTime: s.start_time, rehearsalTime: s.rehearsal_time }),
      }))
      .filter((s): s is { name: string; time: string } => Boolean(s.time && s.time < "12:00"))
      .sort((a, b) => a.time.localeCompare(b.time))[0] ?? null
  );
}
