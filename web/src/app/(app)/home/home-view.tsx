/**
 * The home page's content, shared by the worship teams' home (/home) and the media teams' (/media):
 * a countdown to their next session, notices and broadcasts, then the session's card with its songs
 * and the band, or for a media team the crew. Root and observers get their own overviews (worship only).
 */
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { daysBetween, formatDate, formatTime, todayYmd } from "@/lib/roster";
import { countdown, rehearsalTime } from "@/lib/reminder";
import { loadGroupWeek, loadNewlyPublished, loadNextSession, loadPublishDue, loadServiceOverview, type ServiceDay, type ServiceOverview } from "@/lib/sessions";
import { GROUP_LABEL, type TeamGroup } from "@/lib/team-config";
import { Crew, ServiceCard } from "@/components/sessions/service-card";
import { SessionCard } from "@/components/sessions/session-card";
import { CountdownNumber } from "@/components/countdown-number";
import { BroadcastList } from "@/components/broadcasts";
import { loadMyBroadcasts } from "@/lib/broadcasts";
import { WidePage } from "@/components/wide-page";
import { OpenInboxButton } from "@/components/inbox";
import { HomeNotices, type HomeNotice } from "@/components/home-notices";
import { updateText } from "@/components/roster/updates-board";
import { loadUpdates, type UpdateItem } from "@/lib/serving";
import { createAdminClient } from "@/lib/supabase/admin";


/** Roster updates that change who's in a session's band or crew (shown once on the landing page). */
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

/**
 * Root's home page: one section per group's coming service day (Main: Sunday, Youth: Saturday), with
 * that day's services: each its session (plan and band) and, where it has one, its media crew. If
 * no service that day has a crew to show it in, any crew gets a card of its own.
 */
function ServiceSection({ o }: { o: ServiceOverview }) {
  return (
    <section aria-labelledby={`service-${o.group}`} className="space-y-3">
      <h2 id={`service-${o.group}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-lg font-semibold">{GROUP_LABEL[o.group]} service</span>
        <span className="text-sm text-muted">{formatDate(o.date, { weekday: "long", day: "numeric", month: "long" })}</span>
      </h2>
      {o.services.length ? (
        o.services.map((s) => <ServiceCard key={s.session.rosterSessionId} service={s} />)
      ) : (
        <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
          {o.team ? `${o.team} has no service on a published roster that day.` : "There's no worship team in this group yet."}
        </p>
      )}
      {o.looseCrew.length > 0 && (
        <div className="@container rounded-xl border border-border bg-surface p-4">
          <Crew crew={o.looseCrew} />
        </div>
      )}
    </section>
  );
}

/** One day of an observer's coming week: its services (session, band, media crew), or a crew alone. */
function ServiceDaySection({ day }: { day: ServiceDay }) {
  const label = formatDate(day.date, { weekday: "long", day: "numeric", month: "long" });
  return (
    <section aria-label={label} className="space-y-3">
      <h2 className="text-sm font-medium text-muted">{label}</h2>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {day.services.map((s) => (
          <ServiceCard key={s.session.rosterSessionId} service={s} />
        ))}
        {day.looseCrew.length > 0 && (
          <div className="@container rounded-xl border border-border bg-surface p-4">
            <Crew crew={day.looseCrew} />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * An observer's home page: its group's services in the coming week (e.g. the YF Saturday service and
 * any ad hoc events), each with its session, band and media crew. Observers aren't on any roster, so
 * there's no countdown, notices or broadcasts.
 */
async function ObserverHome({ userId, name, group }: { userId: string; name: string; group: TeamGroup }) {
  const week = await loadGroupWeek(userId, group);
  return (
    <div className="space-y-5">
      <WidePage />
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-medium">{name ? `Hi ${name},` : "Welcome"}</h1>
        <p className="text-sm text-muted">{GROUP_LABEL[group]} services this coming week: the session, the band and the media crew.</p>
      </div>
      {week.length ? (
        week.map((d) => <ServiceDaySection key={d.date} day={d} />)
      ) : (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          No {GROUP_LABEL[group]} services on a published roster this coming week.{" "}
          <Link href="/sessions" className="font-medium text-foreground underline underline-offset-2">
            See later services
          </Link>
        </p>
      )}
    </div>
  );
}

export async function HomeView({ kind = "worship" }: { kind?: "worship" | "media" }) {
  const user = await requireUser(kind);
  const media = kind === "media";
  if (user.observerGroup && !media) return <ObserverHome userId={user.id} name={(user.fullName || "").trim()} group={user.observerGroup} />;
  const [next, fresh, due, broadcasts, updates, bandSeenAt, overview] = await Promise.all([
    // Brighton Serving (root, outside every team) has no sessions of its own: its overview below covers every team.
    // A media team's next session: their crew, and the songs once the worship team publishes them.
    user.team ? loadNextSession(user.id, user.team.id) : Promise.resolve(null),
    // Plans are the worship team's: a media team has none of its own to be told about or publish.
    user.team && !media ? loadNewlyPublished(user.id, user.team.id) : Promise.resolve([]),
    user.team && !media ? loadPublishDue(user.id, user.team.id) : Promise.resolve([]),
    loadMyBroadcasts(user),
    loadUpdates(user), // the nav's inbox loads these too: fetched once
    homeBandSeenAt(user.id),
    // Root serves on no team: it sees every group's coming service instead of its own next session.
    user.isRoot && !media ? loadServiceOverview(user.id) : Promise.resolve(null),
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
    // Root's two services sit side by side on the wide page (the owner's choice); everyone else's
    // home stays the 672px column.
    <div className={overview ? "space-y-5" : "mx-auto max-w-2xl space-y-5"}>
      {overview && <WidePage />}
      <h1 className="font-display text-3xl font-medium">{name ? `Hi ${name},` : "Welcome"}</h1>

      {overview && (
        <>
          {messages}
          {/* Youth on the left, Main on the right; stacked (Youth first) below 1024px. */}
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-x-12">
            {[...overview]
              .sort((a, b) => Number(a.group !== "youth") - Number(b.group !== "youth"))
              .map((o) => (
                <ServiceSection key={o.group} o={o} />
              ))}
          </div>
        </>
      )}
      {!overview && !next && (
        <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          You&apos;re not on any upcoming sessions yet. Once a roster is published, your next one shows here.{" "}
          <Link href="/roster" className="font-medium text-foreground underline underline-offset-2">
            See the roster
          </Link>
        </p>
      )}
      {!overview && !next && messages}
      {!overview && next && (
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
