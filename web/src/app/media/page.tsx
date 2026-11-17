import { Suspense } from "react";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/app/actions/auth";
import { KIND_TITLE } from "@/lib/teams";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeamSwitcher } from "@/components/team-switcher";
import { BrandTag } from "@/components/app-nav";
import { backToDeveloper } from "@/app/actions/dev";

export const metadata: Metadata = { title: "Brighton Media" };

/**
 * The media team's own interface. A placeholder for now: the team, sign-in and permissions work,
 * and the media pages (this week's sessions and band, the worship roster, media rostering) come next.
 */
async function MediaHome() {
  const user = await requireUser("media");
  // Someone on more than one team (e.g. Main Media and Main Worship) switches between them here.
  const { data: mine } = await createAdminClient().from("team_members").select("teams!inner(slug, name, position)").eq("user_id", user.id);
  const teams = (mine ?? [])
    .map((r) => r.teams as unknown as { slug: string; name: string; position: number })
    .sort((a, b) => a.position - b.position);
  return (
    <>
      <header className="sticky top-0 z-30 bg-ink text-ink-foreground">
        <div className="mx-auto flex h-14 max-w-page items-center px-4 sm:px-6">
          <span className="font-display text-xl font-medium tracking-tight">
            {KIND_TITLE[user.team.kind]}
            {user.team.group === "youth" && <BrandTag tag="YF" />}
          </span>
          {/* Developers (often viewing as a media member here): back to the worship app and its developer menu. */}
          {user.isDeveloper ? (
            <form action={backToDeveloper} className="ml-auto">
              <button type="submit" className="rounded-md px-3 py-1.5 text-sm hover:bg-white/10">
                {user.viewingAsPerson ? `Stop viewing as ${user.fullName.split(" ")[0] || "them"}` : "Back to developer"}
              </button>
            </form>
          ) : (
            teams.length > 1 && <TeamSwitcher teams={teams} current={user.team.slug} compact className="ml-auto" />
          )}
          <form action={signOut} className={user.isDeveloper || teams.length > 1 ? "ml-2" : "ml-auto"}>
            <button type="submit" className="rounded-md px-3 py-1.5 text-sm hover:bg-white/10">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-page flex-1 px-4 py-6 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">Hi {user.fullName.split(" ")[0] || "there"},</h1>
        <p className="mt-2 text-muted">The media team&apos;s pages are on their way.</p>
      </main>
    </>
  );
}

export default function MediaPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Suspense fallback={<p className="p-6 text-sm text-muted">Loading…</p>}>
        <MediaHome />
      </Suspense>
    </div>
  );
}
