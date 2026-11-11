import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/permissions";

/**
 * Developers can view the app as root, as one permission group, or as one person (cookie value
 * "person:<id>"), to test what others see. Viewing as a person assumes their account: changes are
 * made as them (their id, their permissions).
 */
export const VIEW_AS_COOKIE = "bw-view-as";
export const VIEW_AS_PERSON = "person:";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  /** Root powers right now: true for root, and for a developer unless they're viewing as a group. */
  isRoot: boolean;
  /** The real account type, unaffected by "view as". */
  isDeveloper: boolean;
  /** For developers: "root", a group name, a person's name, or null (their own full access). */
  viewAs: string | null;
  /** The view-as cookie value in use ("root", a group name or "person:<id>"), or null. */
  viewAsKey: string | null;
  /**
   * Set while a developer acts as a person: id, name, email and permissions above are that
   * person's, and changes are made as them. realId is the developer's own account.
   */
  viewingAsPerson: { realId: string; realName: string } | null;
  /** Still on the default password: every page sends them to /change-password. */
  mustChangePassword: boolean;
  permissions: ReadonlySet<string>;
  can: (permission: Permission) => boolean;
};

/**
 * The signed-in, active user, or null. Unlike getCurrentUser this includes members still on
 * the default password; only the sign-in and change-password flow should use it.
 */
export const getSessionUser = cache(async (): Promise<CurrentUser | null> => {
  // Session checks compare token expiry with the current time, so they must run per request.
  await connection();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const [{ data: profile }, { data: perms }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, is_root, is_developer, is_active, must_change_password")
      .eq("id", userId)
      .single(),
    supabase.rpc("my_permissions"),
  ]);
  if (!profile || !profile.is_active) return null;

  let permissions = new Set<string>((perms as string[] | null) ?? []);
  let isRoot: boolean = profile.is_root || profile.is_developer;
  let viewAs: string | null = null;
  let viewAsKey: string | null = null;

  if (profile.is_developer) {
    const wanted = (await cookies()).get(VIEW_AS_COOKIE)?.value ?? null;
    if (wanted?.startsWith(VIEW_AS_PERSON)) {
      // See the app exactly as this person does: their identity and their permissions.
      const personId = wanted.slice(VIEW_AS_PERSON.length);
      const admin = createAdminClient();
      const [{ data: person }, { data: theirPerms }] = await Promise.all([
        admin.from("profiles").select("id, email, full_name, is_root, is_developer, is_active").eq("id", personId).maybeSingle(),
        admin.rpc("effective_permissions", { p_user_id: personId }),
      ]);
      if (person && person.is_active && !person.is_developer) {
        const perms = new Set<string>((theirPerms as string[] | null) ?? []);
        const asRoot = Boolean(person.is_root);
        return {
          id: person.id,
          email: person.email,
          fullName: person.full_name,
          isRoot: asRoot,
          isDeveloper: true,
          viewAs: person.full_name || person.email,
          viewAsKey: wanted,
          viewingAsPerson: { realId: profile.id, realName: profile.full_name || profile.email },
          mustChangePassword: false,
          permissions: perms,
          can: (p) => asRoot || perms.has(p),
        };
      }
    } else if (wanted === "root") {
      viewAs = "root";
      viewAsKey = "root";
    } else if (wanted) {
      // View as one permission group: exactly that group's permissions, no root powers.
      const { data: group } = await createAdminClient()
        .from("groups")
        .select("name, group_permissions(permission_key)")
        .eq("name", wanted)
        .maybeSingle();
      if (group) {
        viewAs = group.name as string;
        viewAsKey = viewAs;
        isRoot = false;
        permissions = new Set(((group.group_permissions as { permission_key: string }[]) ?? []).map((g) => g.permission_key));
      }
    }
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    isRoot,
    isDeveloper: Boolean(profile.is_developer),
    viewAs,
    viewAsKey,
    viewingAsPerson: null,
    mustChangePassword: Boolean(profile.must_change_password),
    permissions,
    can: (p) => isRoot || permissions.has(p),
  };
});

/**
 * The signed-in, active user with their effective permissions, or null. Members who still
 * have to change the default password count as signed out everywhere (pages, actions, APIs).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await getSessionUser();
  return user && !user.mustChangePassword ? user : null;
}

/** Use at the top of protected pages. Sends signed-out users to the landing page. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}

const CHANGE_PASSWORD_FIRST = "Choose a new password before doing anything else.";

export class PermissionError extends Error {
  constructor(permission: Permission) {
    super(`You don't have permission to do this (${permission}).`);
  }
}

/** Use in server actions before any write. Throws if the user lacks the permission. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (user.mustChangePassword) throw new Error(CHANGE_PASSWORD_FIRST);
  if (!user.can(permission)) throw new PermissionError(permission);
  return user;
}

/** For root-only actions (managing members and permissions). */
export async function requireRoot(): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You are signed out. Please log in again.");
  if (user.mustChangePassword) throw new Error(CHANGE_PASSWORD_FIRST);
  if (!user.isRoot) throw new Error("Only the root user can do this.");
  return user;
}
