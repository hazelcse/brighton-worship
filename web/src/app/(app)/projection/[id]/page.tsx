import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { requireTeamUser } from "@/lib/auth";
import { loadWorkbench } from "@/lib/sessions";
import { projectionPlanVisible } from "@/lib/projection";
import { Workbench } from "@/components/sessions/workbench";
import { MarkSessionsSeen } from "@/components/sessions/mark-sessions-seen";

export const metadata: Metadata = { title: "Session · Brighton Media" };

/**
 * A worship session plan as a media team sees it from Projection: read only, without the band or
 * the song bank (so the nav's width, not the workbench's wide page). Republished changes show in
 * the same "what changed" box the band gets.
 */
async function View({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTeamUser("/projection", "media");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (!(await projectionPlanVisible({ id: user.id, isLead: user.isLead }, user.team, id))) notFound();
  const loaded = await loadWorkbench(id, user.id);
  if (!loaded || loaded.workbench.status !== "published") notFound();
  // Not on the band: no part to highlight. The band stays in the data (it names who leads each
  // song) but isn't shown.
  const workbench = { ...loaded.workbench, myRole: null, myId: null, revision: null };
  return (
    <>
      <MarkSessionsSeen href="/projection" />
      <Workbench initial={workbench} canEdit={false} bank={[]} canBrowse={false} projection />
    </>
  );
}

export default function ProjectionSessionPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<SessionLoader label="Loading the session" className="py-24" />}>
      <View params={params} />
    </Suspense>
  );
}
