import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { AutoRefresh } from "@/components/auto-refresh";
import { MarkSessionsSeen } from "@/components/sessions/mark-sessions-seen";
import { requireTeamUser } from "@/lib/auth";
import { formatDate } from "@/lib/roster";
import { loadProjection } from "@/lib/projection";

export const metadata: Metadata = { title: "Projection · Brighton Media" };

/**
 * A media team's Projection page: the worship team's upcoming published session plans, so the
 * crew can get the songs ready. Members: the services they're rostered on. The lead: every one.
 */
async function ProjectionView() {
  const user = await requireTeamUser("/projection", "media");
  const plans = await loadProjection({ id: user.id, isLead: user.isLead }, user.team);
  return (
    <div className="space-y-5">
      <MarkSessionsSeen href="/projection" />
      <div>
        <h1 className="font-display text-3xl font-semibold">Projection</h1>
        <p className="text-sm text-muted">
          {user.isLead
            ? "Every upcoming session, once the worship team publishes its plan."
            : "Upcoming sessions you're serving at, once the worship team publishes the plan."}
        </p>
      </div>

      {plans.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">No published sessions coming up yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projection/${p.id}`}
                className={`flex h-full flex-col gap-3 rounded-xl border bg-surface p-4 transition hover:border-accent/50 ${
                  p.fresh && p.crewed ? "border-accent/60" : "border-border"
                }`}
              >
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
                    <span className="mr-0.5">{formatDate(p.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                    {p.fresh && p.crewed && (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-foreground">
                        {p.updated ? "Updated" : "Just published"}
                      </span>
                    )}
                  </p>
                  <p className="font-semibold">{p.name}</p>
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

export default function ProjectionPage() {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<SessionLoader label="Loading sessions" className="py-24" />}>
        <ProjectionView />
      </Suspense>
    </>
  );
}
