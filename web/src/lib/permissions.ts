// Mirror of the rows seeded into public.permissions. Keep the two in sync.
export const PERMISSIONS = [
  "users.view",
  "users.manage",
  "groups.manage",
  "songs.view",
  "songs.create",
  "songs.edit",
  "songs.edit_links",
  "songs.delete",
  "songs.transpose",
  "songs.library_updates",
  "songs.issue_reports",
  "roster.view",
  "roster.edit",
  "team.view",
  "sessions.view",
  "sessions.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
