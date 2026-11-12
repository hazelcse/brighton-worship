import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/roster";
import { buildsAnySession, loadBuildableSessions, loadNewlyPublished, loadUpcomingPlans } from "@/lib/sessions";
import { MarkSessionsSeen } from "@/components/sessions/mark-sessions-seen";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Sessions · Brighton Worship" };

async function SessionsView() {
  const user = await requireUser();
  const [plans, buildable, fresh] = await Promise.all([loadUpcomingPlans(user.id), loadBuildableSessions(user.id), loadNewlyPublished(user.id)]);
  const isNew = new Set(fresh.map((f) => f.planId));
  const isUpdated = new Set(fresh.filter((f) => f.updated).map((f) => f.planId));
  const leads = buildsAnySession(user) || buildable.sessions.length > 0 || buildable.unconfirmed > 0;

  return (
    <div className="space-y-5">
      <MarkSessionsSeen />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Sessions</h1>
          <p className="text-sm text-muted">Upcoming sessions you&apos;re serving at, once their plan is published.</p>
        </div>
        {leads && (
          <Link
            href="/sessions/build"
            className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-medium text-ink-foreground hover:bg-ink/90"
          >
            + Build session
          </Link>
        )}
      </div>

      {plans.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          No published sessions coming up yet.
          {leads && " Use Build session to plan the ones you're leading."}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <li key={p.id}>
              <Link
                href={`/sessions/${p.id}`}
                className={`flex h-full flex-col gap-3 rounded-xl border bg-surface p-4 transition hover:border-accent/50 ${isNew.has(p.id) ? "border-accent/60" : "border-border"}`}
              >
                <div>
                  <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
                    {formatDate(p.date, { weekday: "short", day: "numeric", month: "short" })}
                    {isNew.has(p.id) && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-foreground">{isUpdated.has(p.id) ? "Updated" : "Just published"}</span>}
                  </p>
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted">You: {p.role}</p>
                </div>
                {p.songs.length > 0 ? (
                  <ol className="space-y-1 text-sm">
                    {p.songs.map((s, i) => (
                      <li key={i} className="flex items-baseline gap-2">
                        <span className="w-4 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        {s.key && <span className="shrink-0 rounded bg-background px-1.5 text-xs font-medium">{s.key}</span>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted">No songs yet.</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SessionsPage() {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<p className="text-sm text-muted">Loading sessions…</p>}>
        <SessionsView />
      </Suspense>
    </>
  );
}
