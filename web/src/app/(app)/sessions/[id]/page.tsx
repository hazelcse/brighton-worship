import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SessionLoader } from "@/components/session-loader";
import { requireUser } from "@/lib/auth";
import { loadSongBank, loadWorkbench, sessionAccess } from "@/lib/sessions";
import { Workbench } from "@/components/sessions/workbench";
import { MarkSessionsSeen } from "@/components/sessions/mark-sessions-seen";
import { WidePage } from "@/components/wide-page";

export const metadata: Metadata = { title: "Session workbench · Brighton Worship" };

async function WorkbenchView({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const loaded = await loadWorkbench(id, user.id, { withRevision: true });
  if (!loaded) notFound();
  const access = await sessionAccess(user, { roster_session_id: loaded.rosterSessionId, status: loaded.workbench.status });
  if (!access.canView) notFound();
  // The unpublished revision is only for the worship leaders who edit it.
  if (!access.canEdit) loaded.workbench.revision = null;
  const canBrowse = user.can("songs.view");
  const bank = canBrowse ? await loadSongBank() : [];

  return (
    <>
      {/* As wide as the roster editor, so the plan and the song bank both get more room (see LAYOUT.md). */}
      <WidePage />
      {loaded.workbench.status === "published" && <MarkSessionsSeen />}
      <Workbench initial={loaded.workbench} canEdit={access.canEdit} bank={bank} canBrowse={canBrowse} />
    </>
  );
}

export default function WorkbenchPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<SessionLoader label="Loading the session" className="py-24" />}>
      <WorkbenchView params={params} />
    </Suspense>
  );
}
