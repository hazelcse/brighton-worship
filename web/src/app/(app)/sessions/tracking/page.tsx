import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { requireUser } from "@/lib/auth";
import { loadSongBank } from "@/lib/sessions";
import { countPending, countPendingAll, loadAllServices, loadRecords } from "@/lib/tracking-data";
import { TrackingView } from "@/components/tracking/tracking-view";
import { WidePage } from "@/components/wide-page";

export const metadata: Metadata = { title: "Tracking · Brighton Worship" };

async function Tracking() {
  const user = await requireUser();
  if (!user.isLead) notFound();
  // Root sees every worship team's services (Main and Youth), each with its media crew; a lead, their own team's sessions.
  const [records, pending, bank] = await Promise.all([
    user.isRoot || !user.team ? loadAllServices() : loadRecords(user.team.id),
    // Brighton Serving: every worship team's (the Pending page then asks which team).
    user.team ? countPending(user.team.id) : countPendingAll(),
    loadSongBank(),
  ]);

  return (
    <div className="space-y-5">
      {/* As wide as the roster editor, so more table columns fit (see LAYOUT.md). */}
      <WidePage />
      {/* The header row is drawn by TrackingView, which puts the bin (for ticked rows) beside the +. */}
      <TrackingView
        records={records}
        bank={bank}
        byService={user.isRoot || !user.team}
        heading={
          <div>
            <h1 className="font-display text-3xl font-semibold">Tracking</h1>
            <p className="text-sm text-muted">
              {user.isRoot
                ? "Services that have happened: the media team, the worship team and the session."
                : "Sessions that have happened: who played and what was sung."}
            </p>
          </div>
        }
        add={
        <Link
          href="/sessions/tracking/pending"
          aria-label={pending ? `Confirm sessions (${pending} pending)` : "Confirm sessions"}
          title="Sessions waiting to be confirmed"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-xl font-medium leading-none text-ink-foreground hover:bg-ink/90"
        >
          +
          {pending > 0 && (
            <span className="absolute -right-1.5 -top-1.5 rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white">
              {pending > 99 ? "99+" : pending}
            </span>
          )}
        </Link>
        }
      />
    </div>
  );
}

export default function TrackingPage() {
  return (
    <Suspense fallback={<SessionLoader label="Loading sessions" className="py-24" />}>
      <Tracking />
    </Suspense>
  );
}
