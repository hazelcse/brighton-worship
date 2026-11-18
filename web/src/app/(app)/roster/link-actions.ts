"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, inTeam } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkCandidates, linkMembers, linkTo, linkableSession, notifyLinkChange, unlinkSession, type LinkCandidate } from "@/lib/service-links";

/**
 * Linking a team's ad hoc service to other teams' (same group, same day): leads only. See
 * lib/service-links.ts for the rules.
 */

export type LinkState = {
  /** The other teams' ad hoc services that day. */
  candidates: LinkCandidate[];
  /** What it's linked to now: the other teams' sessions in its link. */
  linked: { id: string; name: string; team: string }[];
  /** Why it can't be linked from here (e.g. added while editing a published roster), or null. */
  note: string | null;
};

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function signedInLead() {
  const user = await getCurrentUser();
  if (!user?.isLead || !user.team) return null;
  return inTeam(user);
}

/**
 * Linking options for an ad hoc session of the signed-in team: `sessionId` for one that exists, or
 * null with its `date` while it's being made. Null when the viewer can't link (not the lead).
 */
export async function serviceLinkOptions(sessionId: string | null, date: string): Promise<LinkState | null> {
  const user = await signedInLead();
  if (!user) return null;
  const db = createAdminClient();
  let self = null;
  if (sessionId) {
    self = await linkableSession(db, sessionId);
    if (!self) return { candidates: [], linked: [], note: "It can be linked to other teams' services once the roster is republished." };
    if (self.team.id !== user.team.id || self.kind !== "custom") return null;
    date = self.date;
  }
  if (!isDay(date)) return { candidates: [], linked: [], note: null };
  const [candidates, members] = await Promise.all([
    linkCandidates(db, user.team, date, self),
    self?.linkId ? linkMembers(db, self.linkId) : Promise.resolve([]),
  ]);
  return {
    candidates,
    linked: members.filter((m) => m.id !== self?.id).map((m) => ({ id: m.id, name: m.name, team: m.team.name })),
    note: null,
  };
}

/** Link the signed-in team's ad hoc session to another team's service, or (null) unlink it. */
export async function setServiceLink(sessionId: string, targetId: string | null): Promise<{ ok: boolean; message: string | null }> {
  try {
    const user = await signedInLead();
    if (!user) return { ok: false, message: "Only the lead can link services." };
    const db = createAdminClient();
    const self = await linkableSession(db, sessionId);
    if (!self) return { ok: false, message: "It can be linked once the roster is republished." };
    if (self.team.id !== user.team.id) return { ok: false, message: "Session not found." };
    if (self.kind !== "custom") return { ok: false, message: "Standard services are linked already." };
    // The other teams' sessions it was linked with, before and after: their leads hear of the change.
    const before = self.linkId ? (await linkMembers(db, self.linkId)).filter((m) => m.id !== self.id) : [];
    let message: string;
    let name = self.name;
    if (targetId) {
      name = await linkTo(db, self, String(targetId));
      message = name === self.name ? "Linked." : `Linked, as ${name}.`;
    } else {
      await unlinkSession(db, self);
      message = "Not linked.";
    }
    const now = await linkableSession(db, self.id);
    const after = now?.linkId ? (await linkMembers(db, now.linkId)).filter((m) => m.id !== self.id) : [];
    const by = { actorId: user.id, teamId: user.team.id, name };
    await notifyLinkChange(db, by, "service_unlinked", before.filter((b) => !after.some((a) => a.id === b.id)));
    await notifyLinkChange(db, by, "service_linked", after.filter((a) => !before.some((b) => b.id === a.id)));
    await db.from("audit_log").insert({ actor_id: user.id, action: "roster.link_service", target: self.id, details: { to: targetId } });
    revalidatePath("/roster", "layout");
    revalidatePath("/sessions", "layout");
    revalidatePath("/home");
    revalidatePath("/services", "layout");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
