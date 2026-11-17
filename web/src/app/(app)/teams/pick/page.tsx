import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { TeamLoader } from "@/components/team-loader";
import { groupTeams, loadTeams } from "@/lib/teams";
import { GROUP_LABEL, KIND_LABEL } from "@/lib/team-config";

export const metadata: Metadata = { title: "Pick a team · Brighton Serving" };

/** Only paths inside the app (as /teams/[slug]/open checks). */
const safeNext = (v: string | undefined) => (v && /^\/[a-z]/.test(v) && !v.startsWith("//") ? v : "/team");

/**
 * Brighton Serving is outside every team. A page about one team (its members, permissions, a
 * roster, ...) sends root or an observer here first, to say which team, then on to that page in it.
 */
async function PickView({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await requireUser();
  const next = safeNext((await searchParams).next);
  // Already in a team (everyone but root and observers on Brighton Serving): straight on.
  if (user.team) redirect(next);
  const teams = user.observerGroup ? await groupTeams(user.observerGroup) : await loadTeams();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-semibold">Which team?</h1>
        <p className="text-sm text-muted">This page belongs to one team. Pick the team to open it in.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {teams.map((t) => (
          <li key={t.id}>
            {/* A plain link (not prefetched): following it switches team. */}
            <a
              href={`/teams/${t.slug}/open?next=${encodeURIComponent(next)}`}
              className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-accent/50"
            >
              <p className="font-medium">{t.name}</p>
              <p className="mt-1 text-sm text-muted">
                {GROUP_LABEL[t.group]} · {KIND_LABEL[t.kind]}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PickTeamPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <Suspense fallback={<TeamLoader />}>
      <PickView searchParams={searchParams} />
    </Suspense>
  );
}
