import "server-only";
import { notFound } from "next/navigation";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type PermissionRow = { key: string; category: string; description: string };
export type GroupRow = { id: string; name: string; description: string };

/** Gate for the permissions area: root only. */
export async function requireAdminViewer(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isRoot) notFound();
  return user;
}

export async function loadPermissionCatalogue(): Promise<PermissionRow[]> {
  const { data, error } = await createAdminClient()
    .from("permissions")
    .select("key, category, description")
    .order("key");
  if (error) throw error;
  return data;
}

export function byCategory(perms: PermissionRow[]): [string, PermissionRow[]][] {
  const map = new Map<string, PermissionRow[]>();
  for (const p of perms) map.set(p.category, [...(map.get(p.category) ?? []), p]);
  return [...map.entries()];
}

export async function loadGroups(): Promise<GroupRow[]> {
  const { data, error } = await createAdminClient()
    .from("groups")
    .select("id, name, description")
    .order("name");
  if (error) throw error;
  return data;
}
