import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { AutoRefresh } from "@/components/auto-refresh";
import { TeamServices } from "@/components/sessions/team-services";
import { requireTeamUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Services · Brighton Worship" };

/** A worship team's lead (Sessions → Services): the team's services, with the media crew and anyone else serving. */
async function ServicesView() {
  const user = await requireTeamUser("/sessions/services");
  if (!user.isLead) notFound();
  return <TeamServices userId={user.id} team={user.team} opensPlans={false} detailBase="/sessions/services" />;
}

export default function WorshipServicesPage() {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<SessionLoader className="py-24" />}>
        <ServicesView />
      </Suspense>
    </>
  );
}
