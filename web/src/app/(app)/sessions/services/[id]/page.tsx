import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { ServiceDetail } from "@/components/sessions/service-detail";
import { requireTeamUser, requireUser } from "@/lib/auth";
import { sessionTeam } from "@/lib/sessions";

export const metadata: Metadata = { title: "Service · Brighton Worship" };

/**
 * A worship lead's service (Sessions › Services): the teams serving at it, the session, and linking.
 * An observer's (from its Services and home page): the same page, read-only, for any service of its
 * group, without opening a team.
 */
async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireUser();
  if (viewer.isObserver && viewer.observerGroup) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const team = await sessionTeam(id);
    if (!team || team.group !== viewer.observerGroup) notFound();
    return <ServiceDetail userId={viewer.id} team={team} sessionId={id} back="/sessions" observer />;
  }
  const user = await requireTeamUser("/sessions/services");
  if (!user.isLead) notFound();
  return <ServiceDetail userId={user.id} team={user.team} sessionId={id} back="/sessions/services" />;
}

export default function WorshipServicePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<SessionLoader label="Loading the service" className="py-24" />}>
      <View params={params} />
    </Suspense>
  );
}
