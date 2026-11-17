import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { requireTeamUser } from "@/lib/auth";
import { loadSongBank } from "@/lib/sessions";
import { loadPending } from "@/lib/tracking-data";
import { PendingList } from "@/components/tracking/pending-list";
import { NewSessionButton } from "@/components/tracking/new-session";
import { SESSION_TYPES, todayYmd } from "@/lib/roster";
import { splitsMinistry } from "@/lib/team-config";

export const metadata: Metadata = { title: "Pending sessions · Brighton Worship" };

async function Pending() {
  const user = await requireTeamUser("/sessions/tracking/pending");
  if (!user.isLead) notFound();
  const [sessions, bank] = await Promise.all([loadPending(user.team.id), loadSongBank()]);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/sessions/tracking" className="text-sm text-muted hover:text-foreground">
          ← Tracking
        </Link>
        {/* "+" (top right): add a whole new session that wasn't on a roster. */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold">Pending sessions</h1>
            <p className="text-sm text-muted">
              Sessions that have happened but aren&apos;t in tracking yet. Check the band and songs, add the livestream links, and save.
            </p>
          </div>
          <NewSessionButton
            kinds={user.team.config.sessionKinds.map((k) => ({ value: k, name: SESSION_TYPES[k].name }))}
            ministry={splitsMinistry(user.team.config)}
            today={todayYmd()}
            bank={bank}
          />
        </div>
      </div>
      <PendingList sessions={sessions} bank={bank} />
    </div>
  );
}

export default function PendingPage() {
  return (
    <Suspense fallback={<SessionLoader label="Loading sessions" className="py-24" />}>
      <Pending />
    </Suspense>
  );
}
