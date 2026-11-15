import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HomeLoader } from "@/components/home-loader";
import { requireUser } from "@/lib/auth";
import { daysBetween, formatDate, formatTime, todayYmd } from "@/lib/roster";
import { countdown, rehearsalTime } from "@/lib/reminder";
import { loadNewlyPublished, loadNextSession, loadPublishDue } from "@/lib/sessions";
import { SessionCard } from "@/components/sessions/session-card";
import { CountdownNumber } from "@/components/countdown-number";
import { BroadcastList } from "@/components/broadcasts";
import { loadMyBroadcasts } from "@/lib/broadcasts";
import { AutoRefresh } from "@/components/auto-refresh";
import { OpenInboxButton } from "@/components/inbox";
import { HomeNotices, type HomeNotice } from "@/components/home-notices";
import { updateText } from "@/components/roster/updates-board";
import { loadUpdates, type UpdateItem } from "@/lib/serving";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Home · Brighton Worship" };

/** Roster updates that change who's in a session's band (shown once on the landing page). */
const BAND_CHANGES = new Set<UpdateItem["kind"]>([
  "roster_band_changed",
  "roster_added",
  "roster_removed",
  "roster_part_changed",
  "taken",
  "swapped",
  "band_role_taken",
]);

/** Up to when band changes have been shown to them here (null: not known, so none are shown). */
async function homeBandSeenAt(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("profiles").select("home_band_seen_at").eq("id", userId).maybeSingle();
  return (data?.home_band_seen_at as string | null | undefined) ?? null;
}

async function HomeView() {
  const user = await requireUser();
  const [next, fresh, due, broadcasts, updates, bandSeenAt] = await Promise.all([
    loadNextSession(user.id),
    loadNewlyPublished(user.id),
    loadPublishDue(user.id),
    loadMyBroadcasts(user),
    loadUpdates(user), // the nav's inbox loads these too: fetched once
    homeBandSeenAt(user.id),
  ]);
  const name = (user.fullName || "").trim();

  // Everything needing their attention, in one box under the countdown.
  const pending = next?.serveStatus === "pending";
  const link = "font-medium underline underline-offset-2";
  const day = (d: string) => formatDate(d, { weekday: "short", day: "numeric", month: "short" });
  const notices: HomeNotice[] = fresh.map((f) => {
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

  // Changes to the band of an upcoming session they're on, made by someone else, not shown here yet.
  // Shown on one visit only (HomeNotices marks them seen), last in the box.
  const today = todayYmd();
  const upcoming = (u: UpdateItem) => (u.session?.date ?? "") >= today || (u.otherSession?.date ?? "") >= today;
  if (bandSeenAt) {
    // Compared as times, not text: the seen marker is saved to the millisecond, while created_at has
    // microseconds, so as text the newest notice would always look unseen and never go away.
    const seenMs = Date.parse(bandSeenAt);
    notices.push(
      ...updates
        .filter((u) => BAND_CHANGES.has(u.kind) && u.concernsMe && !u.byMe && Date.parse(u.createdAt) > seenMs && upcoming(u))
        .reverse() // oldest first, like the rest of the box
        .map((u) => ({
          key: `band-${u.id}`,
          text: updateText(u),
          action: (
            <OpenInboxButton className={link}>See updates</OpenInboxButton>
          ),
          once: u.createdAt,
        })),
    );
  }
  // Broadcasts and notices sit together: under the countdown, above the session.
  const messages = (broadcasts.length > 0 || notices.length > 0) && (
    <div className="space-y-3">
      <BroadcastList items={broadcasts} />
      <HomeNotices items={notices} />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="font-display text-3xl font-medium">{name ? `Hi ${name},` : "Welcome"}</h1>

      {!next && (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          You&apos;re not on any upcoming sessions yet. Once a roster is published, your next one shows here.{" "}
          <Link href="/roster" className="font-medium text-foreground underline underline-offset-2">
            See the roster
          </Link>
        </p>
      )}
      {!next && messages}
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

          {messages}

          <SessionCard s={next} />
        </>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<HomeLoader className="py-24" />}>
        <HomeView />
      </Suspense>
    </>
  );
}
