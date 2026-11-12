import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { requireUser } from "@/lib/auth";
import { loadSongBank } from "@/lib/sessions";
import { loadPending } from "@/lib/tracking-data";
import { PendingList } from "@/components/tracking/pending-list";

export const metadata: Metadata = { title: "Pending sessions · Brighton Worship" };

async function Pending() {
  const user = await requireUser();
  if (!user.isRoot) notFound();
  const [sessions, bank] = await Promise.all([loadPending(), loadSongBank()]);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/sessions/tracking" className="text-sm text-muted hover:text-foreground">
          ← Tracking
        </Link>
        <h1 className="font-display text-3xl font-semibold">Pending sessions</h1>
        <p className="text-sm text-muted">
          Sessions that have happened but aren&apos;t in tracking yet. Check the band and songs, add the livestream links, and save.
        </p>
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
