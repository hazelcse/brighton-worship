import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarLoader } from "@/components/calendar-loader";
import { requireUser } from "@/lib/auth";
import { formatRange, quarterOf, todayYmd } from "@/lib/roster";
import { listRosters } from "@/lib/roster-data";

export const metadata: Metadata = { title: "Past rosters · Brighton Worship" };

const STATUS_STYLE = {
  draft: "bg-amber-100 text-amber-800",
  published: "bg-emerald-100 text-emerald-800",
  archived: "bg-stone-100 text-muted",
  revision: "bg-amber-100 text-amber-800", // never listed (listRosters leaves them out)
};

async function PastRosters() {
  const user = await requireUser();
  if (!user.can("roster.edit")) notFound();
  const today = todayYmd();
  // Past = published rosters whose last date has passed, plus older versions that were replaced.
  const rosters = (await listRosters(user.team.id)).filter((r) => r.status === "archived" || (r.status === "published" && r.ends_on < today));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/roster" className="text-sm text-muted hover:text-foreground">
          ← Roster
        </Link>
        <h1 className="font-display text-4xl font-semibold">Past rosters</h1>
        <p className="text-sm text-muted">
          Published rosters whose quarter has ended, newest first, and older versions that were replaced. Current rosters are on{" "}
          <Link href="/roster/new" className="text-accent underline-offset-2 hover:underline">
            Rosters
          </Link>
          .
        </p>
      </div>
      {rosters.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          No past rosters yet.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {rosters.map((r) => (
            <li key={r.id}>
              <Link
                href={r.status === "draft" ? `/roster/${r.id}/plan` : `/roster/${r.id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-background"
              >
                <span className="font-medium">{quarterOf(r.starts_on).label}</span>
                <span className="text-sm text-muted">{formatRange(r.starts_on, r.ends_on)}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}>
                  {r.status === "archived" ? "Replaced" : "Completed"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PastRostersPage() {
  return (
    <Suspense fallback={<CalendarLoader label="Loading past rosters" className="py-24" />}>
      <PastRosters />
    </Suspense>
  );
}
