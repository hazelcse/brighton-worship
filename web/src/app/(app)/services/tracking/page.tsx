import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { WidePage } from "@/components/wide-page";
import { CrewTrackingView } from "@/components/tracking/crew-tracking-view";
import { requireTeamUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/team-config";
import { loadCrewRecords } from "@/lib/tracking-data";

export const metadata: Metadata = { title: "Tracking · Brighton Media" };

/**
 * A media lead's Tracking (Services › Tracking): who served at each session that has happened, by
 * role, straight from the team's published rosters. Table only, with filters, columns and delete.
 */
async function Tracking() {
  const user = await requireTeamUser("/services/tracking", "media");
  if (!user.isLead) notFound();
  const records = await loadCrewRecords(user.team.id);
  // The team's roles, plus any a session still has that the team has since dropped.
  const roles: string[] = [...user.team.config.roles];
  for (const r of records) for (const role of Object.keys(r.crew)) if (!roles.includes(role)) roles.push(role);

  return (
    <div className="space-y-5">
      {/* As wide as the worship team's Tracking, so every role column fits (see LAYOUT.md). */}
      <WidePage />
      <CrewTrackingView records={records} roles={roles.map((key) => ({ key, label: ROLE_LABEL[key] ?? key }))} />
    </div>
  );
}

export default function MediaTrackingPage() {
  return (
    <Suspense fallback={<SessionLoader label="Loading sessions" className="py-24" />}>
      <Tracking />
    </Suspense>
  );
}
