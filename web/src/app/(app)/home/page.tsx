import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { daysBetween, formatDate, formatTime, todayYmd } from "@/lib/roster";
import { countdown, rehearsalTime } from "@/lib/reminder";
import { loadNewlyPublished, loadNextSession, loadPublishDue } from "@/lib/sessions";
import { SessionCard } from "@/components/sessions/session-card";
import { CountdownNumber } from "@/components/countdown-number";
import { BroadcastList } from "@/components/broadcasts";
import { loadMyBroadcasts } from "@/lib/broadcasts";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Home · Brighton Worship" };

async function HomeView() {
  const user = await requireUser();
  const [next, fresh, due, broadcasts] = await Promise.all([
    loadNextSession(user.id),
    loadNewlyPublished(user.id),
    loadPublishDue(user.id),
    loadMyBroadcasts(user),
  ]);
  const first = (user.fullName || "").split(" ")[0];

  // Everything needing their attention, in one box under the countdown.
  const pending = next?.serveStatus === "pending";
  const link = "font-medium underline underline-offset-2";
  const day = (d: string) => formatDate(d, { weekday: "short", day: "numeric", month: "short" });
  const notices: Notice[] = fresh.map((f) => {
    const isNext = pending && f.planId === next?.plan?.id;
    return {
      key: f.planId,
      text: (
        <>
          The plan for <span className="font-semibold">{f.name}</span> on {day(f.date)} has been {f.updated ? "updated" : "published"}
          {f.publishedBy ? ` by ${f.publishedBy}` : ""}.{isNext && " You haven't confirmed this one yet."}
        </>
      ),
      action: f.canOpen ? (
        <Link href={`/sessions/${f.planId}`} className={link}>
          {f.updated ? "See what changed" : "View plan"}
        </Link>
      ) : (
        <Link href="/roster#requests" className={link}>
          {isNext ? "Confirm in your requests" : "Confirm to see it"}
        </Link>
      ),
    };
  });
  // Sessions they lead that are two weeks away or less and still not published: first, as they're on them.
  const inDays = (d: string) => {
    const n = daysBetween(todayYmd(), d);
    return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
  };
  notices.unshift(
    ...due.map((d) => ({
      key: `due-${d.rosterSessionId}`,
      text: (
        <>
          <span className="font-semibold">{d.name}</span> on {day(d.date)} is {inDays(d.date)} and its plan isn&apos;t published yet.
        </>
      ),
      action: (
        <Link href={d.href} className={link}>
          {d.stage === "not_started" ? "Start building" : "Finish and publish"}
        </Link>
      ),
    })),
  );
  // Not confirmed yet (and not already said with its plan above).
  if (pending && !fresh.some((f) => f.planId === next?.plan?.id)) {
    notices.unshift({
      key: "confirm",
      text: <>You haven&apos;t confirmed this one yet.</>,
      action: (
        <Link href="/roster#requests" className={link}>
          Confirm in your requests
        </Link>
      ),
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="font-display text-3xl font-medium">{first ? `Hi ${first},` : "Welcome"}</h1>

      <BroadcastList items={broadcasts} />

      {!next && (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          You&apos;re not on any upcoming sessions yet. Once a roster is published, your next one shows here.{" "}
          <Link href="/roster/schedule" className="font-medium text-foreground underline underline-offset-2">
            See the schedule
          </Link>
        </p>
      )}
      {!next && <Notices items={notices} />}
      {next && (
        <>
          <section aria-label="Countdown" className="rounded-xl bg-ink p-6 text-ink-foreground">
            <p className="text-xs font-medium uppercase tracking-wider opacity-70">Your next session</p>
            {(() => {
              const c = countdown(todayYmd(), next, next.rehearsalTomorrow);
              // A number or "Today" is the big headline; a "See you at …" sentence is smaller.
              const short = c.big.length <= 8;
              return (
                <p className="mt-2 flex flex-wrap items-baseline gap-x-3">
                  {short ? (
                    <CountdownNumber>{c.big}</CountdownNumber>
                  ) : (
                    <span className="font-display text-3xl font-semibold leading-tight sm:text-4xl">{c.big}</span>
                  )}
                  {c.small && <span className="text-sm opacity-80">{c.small}</span>}
                </p>
              );
            })()}
            <p className="mt-3 text-sm opacity-80">
              {formatDate(next.date, { weekday: "long", day: "numeric", month: "long" })} · {next.name}
              {next.rehearsal && next.rehearsal >= todayYmd() && (
                <>
                  {" "}
                  · Rehearsal {formatDate(next.rehearsal, { weekday: "short", day: "numeric", month: "short" })}
                  {rehearsalTime(next) && ` at ${formatTime(rehearsalTime(next)!)}`}
                </>
              )}
            </p>
          </section>

          <Notices items={notices} />

          <SessionCard s={next} />
        </>
      )}
    </div>
  );
}

type Notice = { key: string; text: React.ReactNode; action: React.ReactNode };

/** Notices for the person (plans to publish, plans published, sessions to confirm), together in one box. */
function Notices({ items }: { items: Notice[] }) {
  if (!items.length) return null;
  return (
    <ul aria-label="Notices" className="divide-y divide-accent/20 rounded-xl border border-accent/40 bg-accent/10 text-sm">
      {items.map((n) => (
        <li key={n.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
          <span className="min-w-0 flex-1">{n.text}</span>
          <span className="shrink-0">{n.action}</span>
        </li>
      ))}
    </ul>
  );
}

export default function HomePage() {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <HomeView />
      </Suspense>
    </>
  );
}
