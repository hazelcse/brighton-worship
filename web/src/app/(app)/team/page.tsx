import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamLoader } from "@/components/team-loader";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMembers } from "@/lib/team";
import { TeamGallery } from "@/components/team/team-gallery";

export const metadata: Metadata = { title: "Team · Brighton Worship" };

async function TeamView() {
  const user = await requireUser();
  if (!user.can("team.view")) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        You don&apos;t have access to the team directory yet. Ask a worship team admin.
      </p>
    );
  }
  const [members, { data: groups }] = await Promise.all([
    loadMembers({ includeDevelopers: user.isRoot }),
    user.isRoot ? createAdminClient().from("groups").select("name").order("name") : Promise.resolve({ data: [] }),
  ]);
  return (
    <TeamGallery
      // Only root (and developers) see emails, permission groups and gender.
      members={members.map((m) => (user.isRoot ? m : { ...m, email: "", groups: [], gender: null }))}
      isRoot={user.isRoot}
      groups={(groups ?? []).map((g) => g.name).sort((a, b) => (a === "member" ? -1 : b === "member" ? 1 : a.localeCompare(b)))}
    />
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={<TeamLoader label="Loading the team" className="py-24" />}>
      <TeamView />
    </Suspense>
  );
}
