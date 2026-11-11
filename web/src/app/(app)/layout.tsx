import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppNav, AppNavSkeleton } from "@/components/app-nav";
import { countUnseenSongUpdates, updateKindsFor } from "@/lib/song-updates";
import { countUnseenRosterUpdates } from "@/lib/serving";
import { loadNewlyPublished, loadPublishDue } from "@/lib/sessions";

/** Reads the session, so it sits behind Suspense (required with Cache Components). */
async function SignedInNav() {
  const user = await requireUser();
  // Developers can switch between their own view, root, and each permission group.
  const db = createAdminClient();
  const [groups, people] = user.isDeveloper
    ? await Promise.all([
        db.from("groups").select("name").order("name").then(({ data }) => (data ?? []).map((g) => g.name as string)),
        // Anyone on the team can be viewed as (not other developer accounts).
        db
          .from("profiles")
          .select("id, full_name, email")
          .eq("is_active", true)
          .eq("is_developer", false)
          .order("full_name")
          .then(({ data }) => (data ?? []).map((p) => ({ id: p.id as string, name: (p.full_name as string) || (p.email as string) }))),
      ])
    : [[], []];
  const [songUpdates, rosterUpdates, published, publishDue] = await Promise.all([
    countUnseenSongUpdates(user.id, updateKindsFor(user)),
    countUnseenRosterUpdates(user),
    loadNewlyPublished(user.id),
    loadPublishDue(user.id),
  ]);
  // Plans published for them to see, plus their own plans due to be published within two weeks.
  const sessionBadge = published.length + publishDue.length;
  return (
    <>
      <AppNav
        user={{
          name: user.viewingAsPerson?.realName ?? (user.fullName || user.email),
          email: user.viewingAsPerson ? "" : user.email,
          isRoot: user.isRoot,
          canAdmin: user.isRoot,
          isDeveloper: user.isDeveloper,
          badges: {
            ...(songUpdates ? { "/songs": songUpdates } : {}),
            ...(rosterUpdates ? { "/roster": rosterUpdates } : {}),
            ...(sessionBadge ? { "/sessions": sessionBadge } : {}),
          },
          viewAs: user.viewAs,
          viewAsKey: user.viewAsKey,
          groups,
          people,
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
      {/* A page showing <WidePage /> (the roster editor, Tracking) is wider than the nav: its edges sit
          halfway between the nav's edges and the window's, i.e. max (100vw + 992px) / 2. WidePage drops
          its data-wide-page marker while its page is hidden, so other pages stay 992px. See LAYOUT.md. */}
      <main className="mx-auto w-full max-w-page flex-1 px-4 py-6 sm:px-6 has-[[data-wide-page]]:max-w-[calc(50vw+31rem)]">
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}
