import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { loadSongBank } from "@/lib/sessions";
import { countPending, loadRecords } from "@/lib/tracking-data";
import { TrackingView } from "@/components/tracking/tracking-view";

export const metadata: Metadata = { title: "Tracking · Brighton Worship" };

async function Tracking() {
  const user = await requireUser();
  if (!user.isRoot) notFound();
  const [records, pending, bank] = await Promise.all([loadRecords(), countPending(), loadSongBank()]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Tracking</h1>
          <p className="text-sm text-muted">Sessions that have happened: who played and what was sung.</p>
        </div>
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
      </div>
      <TrackingView records={records} bank={bank} />
    </div>
  );
}

export default function TrackingPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading sessions…</p>}>
      <Tracking />
    </Suspense>
  );
}
