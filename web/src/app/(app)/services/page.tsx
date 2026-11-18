import type { Metadata } from "next";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { AutoRefresh } from "@/components/auto-refresh";
import { TeamServices } from "@/components/sessions/team-services";
import { requireTeamUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Services · Brighton Media" };

/** A media team's Services (everyone on the team): its services, with the worship band and session they crew. */
async function ServicesView() {
  const user = await requireTeamUser("/services", "media");
  // Media members don't open the worship team's plans.
  // The lead's cards open the service (its teams, the session, and linking its ad hoc ones).
  return <TeamServices userId={user.id} team={user.team} opensPlans={false} detailBase={user.isLead ? "/services" : undefined} />;
}

export default function MediaServicesPage() {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<SessionLoader className="py-24" />}>
        <ServicesView />
      </Suspense>
    </>
  );
}
