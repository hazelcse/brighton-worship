import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTeams } from "@/lib/teams";
import type { TeamGroup, TeamKind } from "@/lib/team-config";

/**
 * Developers' "View as" people: anyone on any team (not other developer accounts), listed under
 * each team they're on. Picking one switches to that team first.
 */
export async function devViewPeople(): Promise<{ id: string; name: string; team: string; teamName: string }[]> {
  const { data } = await createAdminClient()
    .from("team_members")
    .select("user_id, teams!inner(slug, name, position), profiles!inner(full_name, email, is_active, is_developer)")
    .eq("profiles.is_active", true)
    .eq("profiles.is_developer", false);
  return (data ?? [])
    .map((r) => {
      const t = r.teams as unknown as { slug: string; name: string; position: number };
      const p = r.profiles as unknown as { full_name: string; email: string };
      return { id: r.user_id as string, name: p.full_name || p.email, team: t.slug, teamName: t.name, position: t.position };
    })
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, team: p.team, teamName: p.teamName }));
}

/** Each group's real observer account settings: where a developer's observer view starts. */
export async function devObserverSettings(): Promise<Record<"main" | "youth", { managesPermissions: boolean; seesAbsences: boolean }>> {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("observer_group, observer_manages_permissions, observer_sees_absences")
    .not("observer_group", "is", null);
  const out = { main: { managesPermissions: false, seesAbsences: false }, youth: { managesPermissions: false, seesAbsences: false } };
  for (const r of data ?? []) {
    const g = r.observer_group === "youth" ? "youth" : "main";
    out[g] = { managesPermissions: Boolean(r.observer_manages_permissions), seesAbsences: Boolean(r.observer_sees_absences) };
  }
  return out;
}

/** Every team for "View as": the Team dropdown lists the chosen group's, in Teams-page order. */
export async function devViewTeams(): Promise<{ slug: string; name: string; group: TeamGroup; kind: TeamKind }[]> {
  return (await loadTeams()).map((t) => ({ slug: t.slug, name: t.name, group: t.group, kind: t.kind }));
}
