import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppNav, AppNavSkeleton } from "@/components/app-nav";
import { KIND_TITLE, ROOT_TITLE } from "@/lib/teams";
import { countUnseenSongUpdates, updateKindsFor } from "@/lib/song-updates";
import { loadUpdates } from "@/lib/serving";
import { loadNewlyPublished, loadPublishDue } from "@/lib/sessions";

/** Reads the session, so it sits behind Suspense (required with Cache Components). */
async function SignedInNav() {
  const user = await requireUser();
  // Developers can switch between their own view, the lead's, and each of this team's permission groups.
  const db = createAdminClient();
  const [groups, people] = user.isDeveloper
    ? await Promise.all([
        db.from("groups").select("name").eq("team_id", user.team.id).order("name").then(({ data }) => (data ?? []).map((g) => g.name as string)),
        // Anyone on any team can be viewed as (not other developer accounts), listed under each team
        // they're on: picking one switches to that team first.
        db
          .from("team_members")
          .select("user_id, teams!inner(slug, name, position), profiles!inner(full_name, email, is_active, is_developer)")
          .eq("profiles.is_active", true)
          .eq("profiles.is_developer", false)
          .then(({ data }) =>
            (data ?? [])
              .map((r) => {
                const t = r.teams as unknown as { slug: string; name: string; position: number };
                const p = r.profiles as unknown as { full_name: string; email: string };
                return { id: r.user_id as string, name: p.full_name || p.email, team: t.slug, teamName: t.name, position: t.position };
              })
              .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
              .map((p) => ({ id: p.id, name: p.name, team: p.team, teamName: p.teamName })),
          ),
      ])
    : [[], []];
  const [songUpdates, inbox, published, publishDue, memberOf] = await Promise.all([
    countUnseenSongUpdates(user.id, updateKindsFor(user)),
    // Roster updates live in the nav's inbox (with its own unread count), not on the Roster page.
    // An observer is on no roster, so has none.
    user.can("roster.view") && !user.isObserver ? loadUpdates(user) : Promise.resolve(undefined),
    loadNewlyPublished(user.id, user.team.id),
    loadPublishDue(user.id, user.team.id),
    // The teams they're on, for the profile menu (root, observers and developers aren't on any).
    user.isRoot || user.isObserver || user.isDeveloper || user.viewingAsPerson
      ? Promise.resolve([] as { slug: string; name: string }[])
      : db
          .from("team_members")
          .select("teams!inner(slug, name, position)")
          .eq("user_id", user.id)
          .then(({ data }) =>
            (data ?? [])
              .map((r) => r.teams as unknown as { slug: string; name: string; position: number })
              .sort((a, b) => a.position - b.position)
              .map((t) => ({ slug: t.slug, name: t.name })),
          ),
  ]);
  // Plans published for them to see, plus their own plans due to be published within two weeks.
  const sessionBadge = published.length + publishDue.length;
  return (
    <>
      <AppNav
        user={{
          name: user.viewingAsPerson?.realName ?? (user.fullName || user.email),
          email: user.viewingAsPerson ? "" : user.email,
          isLead: user.isLead,
          canAdmin: user.isLead,
          isRoot: user.isRoot,
          isObserver: user.isObserver,
          observerSeesAbsences: user.observerSeesAbsences,
          // Root has Teams in the bar; developers reach it from the profile menu.
          canManageTeams: !user.isRoot && user.isDeveloper && !user.viewingAsPerson,
          // Root and observers see "Brighton Serving" (an observer's limited to its group, e.g. YF).
          brand: user.isRoot || user.isObserver ? ROOT_TITLE : KIND_TITLE[user.team.kind],
          // Youth Worship and Youth Media: "Brighton Worship" / "Brighton Media" with a small orange YF.
          brandTag: !user.isRoot && user.team.group === "youth" ? "YF" : undefined,
          isDeveloper: user.isDeveloper,
          memberOf,
          currentTeam: user.team.slug,
          badges: {
            ...(songUpdates ? { "/songs": songUpdates } : {}),
            ...(sessionBadge ? { "/sessions": sessionBadge } : {}),
          },
          inbox,
          viewAs: user.viewAs,
          viewAsKey: user.viewAsKey,
          groups,
          people,
          viewTeam: user.team.slug,
          // Developers aren't on the team list, so they reach their own profile from the menu.
          profileId: user.isDeveloper ? (user.viewingAsPerson?.realId ?? user.id) : null,
        }}
      />
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Suspense fallback={<AppNavSkeleton />}>
        <SignedInNav />
      </Suspense>
      {/* A page showing <WidePage /> (the roster editor, Tracking, the session workbench) is wider than the nav: its edges sit
          halfway between the nav's edges and the window's, i.e. max (100vw + 992px) / 2. WidePage drops
          its data-wide-page marker while its page is hidden, so other pages stay 992px. See LAYOUT.md. */}
      <main className="mx-auto w-full max-w-page flex-1 px-4 py-6 sm:px-6 has-[[data-wide-page]]:max-w-[calc(50vw+31rem)]">
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}
