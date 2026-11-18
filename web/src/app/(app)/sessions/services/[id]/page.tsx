import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { ServiceDetail } from "@/components/sessions/service-detail";
import { requireTeamUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Service · Brighton Worship" };

/** A worship lead's service (Sessions › Services): the teams serving at it, the session, and linking. */
async function View({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTeamUser("/sessions/services");
  if (!user.isLead) notFound();
  const { id } = await params;
  return <ServiceDetail userId={user.id} team={user.team} sessionId={id} back="/sessions/services" />;
}

export default function WorshipServicePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<SessionLoader label="Loading the service" className="py-24" />}>
      <View params={params} />
    </Suspense>
  );
}
