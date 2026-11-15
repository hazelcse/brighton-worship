import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { SessionLoader } from "@/components/session-loader";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { purgeExpiredUploads } from "@/lib/session-uploads";
import { formatDate } from "@/lib/roster";
import { buildsAnySession, loadBuildableSessions, loadNewlyPublished, loadUpcomingPlans } from "@/lib/sessions";
import { MarkSessionsSeen } from "@/components/sessions/mark-sessions-seen";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Sessions · Brighton Worship" };

/** A small status pill after the date: 14px tall, just under the date's line. */
function Pill({ className, children }: { className: string; children: ReactNode }) {
  // Nudged up so its middle lines up with the middle of the date's capitals, not the line box.
  return (
    <span className={`-translate-y-[0.5px] rounded-full px-1.5 text-[9px] leading-[14px] font-semibold normal-case tracking-normal ring-1 ${className}`}>
      {children}
    </span>
  );
}

/** Two arrows pointing opposite ways: switches between the viewer's sessions and everyone's. */
function SwitchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 5h10M10 2.5 12.5 5 10 7.5" />
      <path d="M13.5 11h-10M6 8.5 3.5 11 6 13.5" />
    </svg>
  );
}

type View = { view?: string };

async function SessionsView({ searchParams }: { searchParams: Promise<View> }) {
  const [user, { view }] = await Promise.all([requireUser(), searchParams]);
  // Worship leaders' own songsheets go 30 days after their session (at most hourly, after the response).
  after(() => purgeExpiredUploads());
  const all = buildsAnySession(user);
  // Root (and the developer) can switch to every upcoming published session.
  const everyone = user.isRoot && view === "all";
  const [plans, buildable, fresh] = await Promise.all([
    loadUpcomingPlans(user.id, { all, everyone }),
    loadBuildableSessions(user.id),
    loadNewlyPublished(user.id),
  ]);
  const isNew = new Set(fresh.map((f) => f.planId));
  const isUpdated = new Set(fresh.filter((f) => f.updated).map((f) => f.planId));
  const leads = all || buildable.sessions.length > 0 || buildable.unconfirmed > 0;
  const hasDrafts = plans.some((p) => p.draft || p.revised);

  return (
    <div className="space-y-5">
      <MarkSessionsSeen />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Sessions</h1>
          <p className="text-sm text-muted">
            {everyone ? "Every upcoming session, once its plan is published." : "Upcoming sessions you're serving at, once their plan is published."}
            {hasDrafts && " Drafts are only visible to their worship leaders."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {user.isRoot && (
            <Link
              href={everyone ? "/sessions" : "/sessions?view=all"}
              aria-label={everyone ? "Show my sessions" : "Show all sessions"}
              title={everyone ? "Showing all sessions: switch to mine" : "Showing my sessions: switch to all"}
              className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-1 text-sm font-medium ${
                everyone ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <span>{everyone ? "Team" : "Me"}</span>
              <SwitchIcon />
            </Link>
          )}
          {/* From 640px; phones get a "+" under the cards instead. */}
          {leads && (
            <Link
              href="/sessions/build"
              className="hidden h-10 items-center rounded-lg bg-ink px-4 text-sm font-medium text-ink-foreground hover:bg-ink/90 sm:inline-flex"
            >
              + Build session
            </Link>
          )}
        </div>
      </div>

      {plans.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          No published sessions coming up yet.
          {leads && (
            <>
              <span className="hidden sm:inline"> Use Build session to plan the ones you&apos;re leading.</span>
              <span className="sm:hidden"> Use the + below to plan the ones you&apos;re leading.</span>
            </>
          )}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <li key={p.id}>
              <Link
                href={`/sessions/${p.id}`}
                className={`flex h-full flex-col gap-3 rounded-xl border bg-surface p-4 transition ${
                  p.draft
                    ? "border-dashed border-amber-400 hover:border-amber-500"
                    : `hover:border-accent/50 ${isNew.has(p.id) ? "border-accent/60" : "border-border"}`
                }`}
              >
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
                    <span className="mr-0.5">{formatDate(p.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                    {p.revised && <Pill className="bg-emerald-50 text-emerald-800 ring-emerald-300">Published</Pill>}
                    {(p.draft || p.revised) && <Pill className="bg-amber-50 text-amber-800 ring-amber-300">Draft</Pill>}
                    {!p.draft && !p.revised && isNew.has(p.id) && (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-foreground">{isUpdated.has(p.id) ? "Updated" : "Just published"}</span>
                    )}
                  </p>
                  <p className="font-semibold">{p.name}</p>
                  {p.role && <p className="text-xs text-muted">You: {p.role}</p>}
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

      {/* Phones: build a session from a "+" centred under the cards, like the roster's New button. */}
      {leads && (
        <div className="flex justify-center sm:hidden">
          <Link
            href="/sessions/build"
            aria-label="Build session"
            title="Build session"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-xl font-medium leading-none text-ink-foreground hover:bg-ink/90"
          >
            +
          </Link>
        </div>
      )}
    </div>
  );
}

export default function SessionsPage({ searchParams }: { searchParams: Promise<View> }) {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<SessionLoader label="Loading sessions" className="py-24" />}>
        <SessionsView searchParams={searchParams} />
      </Suspense>
    </>
  );
}
