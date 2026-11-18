import { Suspense } from "react";
import { TEAM_HOME, hasDeveloperAccess, requireUser, usesTeamPages } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppNav, AppNavSkeleton } from "@/components/app-nav";
import { KIND_TITLE, ROOT_TITLE } from "@/lib/teams";
import { devObserverSettings, devViewPeople, devViewTeams } from "@/lib/dev-view";
import { countUnseenSongUpdates, updateKindsFor } from "@/lib/song-updates";
import { loadUpdates } from "@/lib/serving";
import { loadNewlyPublished, loadPublishDue } from "@/lib/sessions";
import { loadNewlyPublishedForCrew } from "@/lib/projection";

/** Reads the session, so it sits behind Suspense (required with Cache Components). */
async function SignedInNav() {
  const user = await requireUser("any");
  // Developers switch between teams (group and kind) and account types, or act as a person.
  const db = createAdminClient();
  const [people, realObserverPerms, viewTeams] = user.isDeveloper
    ? await Promise.all([devViewPeople(), devObserverSettings(), devViewTeams()])
    : [[], undefined, undefined];
  const mediaTeam = user.team?.kind === "media" && !user.isRoot && !user.isObserver ? user.team : null;
  const [songUpdates, inbox, published, publishDue, memberOf, projection] = await Promise.all([
    countUnseenSongUpdates(user.id, updateKindsFor(user)),
    // Roster updates live in the nav's inbox (with its own unread count), not on the Roster page.
    // An observer is on no roster, so has none.
    user.can("roster.view") && !user.isObserver ? loadUpdates(user) : Promise.resolve(undefined),
    // Brighton Serving (no team) has no plans of its own to be told about.
    user.team ? loadNewlyPublished(user.id, user.team.id) : Promise.resolve([]),
    user.team ? loadPublishDue(user.id, user.team.id) : Promise.resolve([]),
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
    // A media team: plans the worship team published (or changed) for services they're linked to.
    mediaTeam ? loadNewlyPublishedForCrew({ id: user.id, isLead: user.isLead }, mediaTeam) : Promise.resolve([]),
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
          canManageTeams: !user.isRoot && hasDeveloperAccess(user),
          // Root and observers see "Brighton Serving" (an observer's limited to its group, e.g. YF).
          brand: user.isRoot || user.isObserver || !user.team ? ROOT_TITLE : KIND_TITLE[user.team.kind],
          // Youth Worship and Youth Media: "Brighton Worship" / "Brighton Media" with a small orange YF.
          brandTag: !user.isRoot && user.team?.group === "youth" ? "YF" : undefined,
          isDeveloper: user.isDeveloper,
          // A media team member: the bar leads to /media, and holds only the team pages their team uses.
          media:
            user.team?.kind === "media" && !user.isRoot && !user.isObserver
              ? { home: TEAM_HOME.media, teamPages: usesTeamPages(user.team) }
              : undefined,
          memberOf,
          currentTeam: user.team?.slug,
          // Root or an observer in a team they opened: which one (the bar leads back to Brighton Serving).
          openTeam: user.team && (user.isRoot || (user.observerGroup && !user.isDeveloper)) ? user.team.name : undefined,
          badges: {
            ...(songUpdates ? { "/songs": songUpdates } : {}),
            ...(sessionBadge ? { "/sessions": sessionBadge } : {}),
            ...(projection.length ? { "/projection": projection.length } : {}),
          },
          inbox,
          viewAs: user.viewAs,
          viewAsKey: user.viewAsKey,
          people,
          realObserverPerms,
          viewTeams,
          observerPerms: user.isDeveloper && user.isObserver ? { managesPermissions: user.observerManagesPermissions, seesAbsences: user.observerSeesAbsences } : undefined,
          viewTeam: user.team ? { slug: user.team.slug, group: user.team.group, kind: user.team.kind } : undefined,
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
