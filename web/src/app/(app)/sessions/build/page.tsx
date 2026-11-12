import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { requireUser } from "@/lib/auth";
import { formatDate, quarterOf } from "@/lib/roster";
import { buildsAnySession, loadBuildableSessions, type BuildableSession } from "@/lib/sessions";
import { StageBadge } from "@/components/sessions/stage-badge";
import { StartSessionButton } from "@/components/sessions/start-session-button";

export const metadata: Metadata = { title: "Build session · Brighton Worship" };

function Row({ s }: { s: BuildableSession }) {
  const body = (
    <>
      <div className="w-14 shrink-0 text-center">
        <p className="text-xs uppercase text-muted">{formatDate(s.date, { weekday: "short" })}</p>
        <p className="font-display text-2xl font-semibold leading-none">{formatDate(s.date, { day: "numeric" })}</p>
        <p className="text-xs text-muted">{formatDate(s.date, { month: "short" })}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{s.name}</p>
        <p className="truncate text-sm text-muted">
          {s.involved
            ? s.coLeaders.length
              ? `With ${s.coLeaders.join(", ")}`
              : "You're the only worship leader"
            : s.coLeaders.length
              ? `Led by ${s.coLeaders.join(", ")}`
              : "No worship leader rostered"}
          {s.lockedBy && ` · ${s.lockedBy} is editing`}
        </p>
      </div>
      <StageBadge stage={s.stage} />
    </>
  );
  const cls = "flex w-full items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-accent/50";
  return s.planId ? (
    <Link href={`/sessions/${s.planId}`} className={cls}>
      {body}
    </Link>
  ) : (
    <StartSessionButton rosterSessionId={s.id} className={cls}>
      {body}
    </StartSessionButton>
  );
}

async function BuildView() {
  const user = await requireUser();
  const all = buildsAnySession(user);
  const { sessions, unconfirmed } = await loadBuildableSessions(user.id, { all });

  const quarters = new Map<string, BuildableSession[]>();
  for (const s of sessions) {
    const label = quarterOf(s.date).label;
    quarters.set(label, [...(quarters.get(label) ?? []), s]);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/sessions" className="text-sm text-muted hover:text-foreground">
        ← Sessions
      </Link>
      <div>
        <h1 className="font-display text-3xl font-semibold">Build session</h1>
        <p className="text-sm text-muted">
          {all ? "Every upcoming session (developer access). Pick one to plan it." : "The sessions you're leading worship at. Pick one to plan it."}
        </p>
      </div>

      {unconfirmed > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
          You&apos;re leading {unconfirmed === 1 ? "1 more session" : `${unconfirmed} more sessions`} that you haven&apos;t confirmed yet.{" "}
          <Link href="/roster" className="font-medium text-accent underline underline-offset-2">
            Confirm on the roster
          </Link>{" "}
          to build {unconfirmed === 1 ? "it" : "them"}.
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          {all ? "No upcoming sessions on a published roster." : "You don't have any confirmed sessions to lead coming up."}
        </p>
      ) : (
        [...quarters].map(([label, list]) => (
          <section key={label} aria-label={label} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{label}</h2>
            <ul className="space-y-2">
              {list.map((s) => (
                // The "not published yet" reminder links here (#session-<id>) for a plan not started yet.
                <li key={s.id} id={`session-${s.id}`} className="scroll-mt-20 rounded-xl target:ring-2 target:ring-accent">
                  <Row s={s} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

export default function BuildSessionPage() {
  return (
    <Suspense fallback={<SessionLoader label="Loading your sessions" className="py-24" />}>
      <BuildView />
    </Suspense>
  );
}
