import "server-only";
import { notFound } from "next/navigation";
import { requireTeamUser, type TeamUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type PermissionRow = { key: string; category: string; description: string };
export type GroupRow = { id: string; name: string; description: string };

/** Gate for the permissions area: the team's lead (or root, a developer, or the group's observer if it manages permissions) only. */
export async function requireAdminViewer(next = "/team/permissions"): Promise<TeamUser> {
  const user = await requireTeamUser(next, "team");
  if (!user.isLead && !user.observerManagesPermissions) notFound();
  return user;
}

/** Every permission this team may use (its ceiling), so leads only hand out what the team has. */
export async function loadPermissionCatalogue(teamId: string): Promise<PermissionRow[]> {
  const db = createAdminClient();
  const [{ data, error }, { data: team }] = await Promise.all([
    db.from("permissions").select("key, category, description").order("key"),
    db.from("teams").select("permission_ceiling").eq("id", teamId).maybeSingle(),
  ]);
  if (error) throw error;
  const ceiling = (team?.permission_ceiling as string[] | null) ?? null;
  return ceiling ? data.filter((p) => ceiling.includes(p.key)) : data;
}

export function byCategory(perms: PermissionRow[]): [string, PermissionRow[]][] {
  const map = new Map<string, PermissionRow[]>();
  for (const p of perms) map.set(p.category, [...(map.get(p.category) ?? []), p]);
  return [...map.entries()];
}

/** One team's permission groups. */
export async function loadGroups(teamId: string): Promise<GroupRow[]> {
  const { data, error } = await createAdminClient()
    .from("groups")
    .select("id, name, description")
    .eq("team_id", teamId)
    .order("name");
  if (error) throw error;
  return data;
}
