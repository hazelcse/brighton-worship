import Link from "next/link";
import { ROLE_LABEL, formatDate } from "@/lib/roster";
import type { UpdateItem } from "@/lib/serving";

const DOT: Record<UpdateItem["kind"], string> = {
  declined: "bg-red-500",
  refused: "bg-red-300",
  swap_declined: "bg-red-300",
  asked: "bg-amber-400",
  posted: "bg-amber-400",
  swap_proposed: "bg-sky-400",
  taken: "bg-emerald-500",
  swapped: "bg-emerald-500",
  cancelled: "bg-border",
  band_role_asked: "bg-amber-400",
  band_role_refused: "bg-red-300",
  band_role_taken: "bg-emerald-500",
  band_role_missing: "bg-red-500",
  session_updated: "bg-sky-500",
  roster_added: "bg-violet-500",
  roster_removed: "bg-violet-300",
  roster_part_changed: "bg-violet-400",
  roster_session_changed: "bg-violet-400",
  roster_band_changed: "bg-violet-300",
  member_added: "bg-teal-500",
  member_removed: "bg-teal-300",
  service_linked: "bg-indigo-500",
  service_unlinked: "bg-indigo-300",
};

const day = (date: string) => formatDate(date, { weekday: "short", day: "numeric", month: "short" });

/**
 * Each update as one sentence naming the part, session and date, e.g. "Keys (CM Sunday Service) – Sun 18 Jan".
 * Also used for the landing page's band change notices.
 */
export function updateText(u: UpdateItem): React.ReactNode {
  const part = u.role ? (ROLE_LABEL[u.role] ?? u.role) : "their part";
  const b = (s: string | null) => <span className="font-medium">{s}</span>;
  const place = u.session ? `${part} (${u.session.name}) – ${day(u.session.date)}` : part;
  // The session offered in return, in full: "Keys (CM Sunday Service) – Sun 20 Dec"
  const otherPart = u.otherRole ? (ROLE_LABEL[u.otherRole] ?? u.otherRole) : part;
  const offered = u.otherSession ? `${otherPart} (${u.otherSession.name}) – ${day(u.otherSession.date)}` : "another date";
  // The two sessions in a swap: yours blue, the other person's amber. (Not in the swap yourself:
  // the requester's side is blue.)
  const BLUE = "bg-sky-100 text-sky-900";
  const AMBER = "bg-amber-100 text-amber-900";
  const chip = (t: string, colour: string) => <span className={`whitespace-nowrap rounded px-1.5 py-0.5 ${colour}`}>{t}</span>;
  const mineLeft = u.mySide !== "other";
  const both = (
    <>
      {chip(place, mineLeft ? BLUE : AMBER)} ↔ {chip(offered, mineLeft ? AMBER : BLUE)}
    </>
  );
  switch (u.kind) {
    case "declined":
      // The reason is only there for root and the person themselves.
      return (
        <>
          {b(u.actor)} cannot serve {place}
          {u.reason && (
            <>
              {" "}
              because <span className="italic">{u.reason}</span>
            </>
          )}
        </>
      );
    case "asked":
      return <>{b(u.actor)} asked {b(u.member)} to take over {place}</>;
    case "posted":
      return <>{b(u.actor)} put {place} on the requests board</>;
    case "taken":
      return <>{b(u.actor)} took over {place} from {b(u.member)}</>;
    case "refused":
      return <>{b(u.actor)} can&apos;t cover {place} for {b(u.member)}</>;
    case "swap_proposed":
      return (
        <>
          {b(u.actor)} proposed a swap with {b(u.member)}: {both}
        </>
      );
    case "swap_declined":
      return (
        <>
          {b(u.actor)} turned down swapping with {b(u.member)}: {both}
        </>
      );
    case "swapped":
      return (
        <>
          {b(u.actor)} and {b(u.member)} swapped {both}
        </>
      );
    case "band_role_asked":
      return (
        <>
          {b(u.actor)} asked {b(u.member)} to take over {part} ({u.session?.name}) – {u.session ? day(u.session.date) : ""}
        </>
      );
    case "band_role_taken":
      return (
        <>
          {b(u.actor)} took over {part} ({u.session?.name}) – {u.session ? day(u.session.date) : ""} from {b(u.member)}
        </>
      );
    case "band_role_refused":
      return (
        <>
          {b(u.actor)} can&apos;t take over {part} ({u.session?.name}) – {u.session ? day(u.session.date) : ""} for {b(u.member)}
        </>
      );
    case "band_role_missing":
      return (
        <>
          {u.session?.name} – {u.session ? day(u.session.date) : ""} has no {part.toLowerCase()} ({b(u.actor)} can&apos;t serve and nobody else in
          the band can do it)
        </>
      );
    case "session_updated":
      return (
        <>
          Session for {b(`${u.session?.name ?? "a service"} – ${u.session ? day(u.session.date) : ""}`)} has been updated
          {u.href && <span className="ml-1 text-muted">→</span>}
        </>
      );
    case "roster_added":
      return (
        <>
          {b(u.actor)} added {b(u.member)} to {place}
          {u.detail && <> (also {u.detail})</>}
        </>
      );
    case "roster_removed":
      // A session deleted since has no session left to name: the detail says what it was.
      return (
        <>
          {b(u.actor)} took {b(u.member)} off {u.session ? place : (u.detail ?? place)}
        </>
      );
    case "roster_part_changed":
      return (
        <>
          {b(u.actor)} changed {b(u.member)}&apos;s part at {u.session?.name} – {u.session ? day(u.session.date) : ""}
          {u.detail && <>: {u.detail}</>}
        </>
      );
    case "roster_session_changed":
      return (
        <>
          {b(`${u.session?.name ?? "A session"} – ${u.session ? day(u.session.date) : ""}`)} has changed
          {u.detail && <>: {u.detail}</>}
        </>
      );
    case "roster_band_changed":
      return (
        <>
          {b(u.actor)} changed the {u.crew ? "crew" : "band"} for {b(`${u.session?.name ?? "a session"} – ${u.session ? day(u.session.date) : ""}`)}
          {u.detail && <>: {u.detail}</>}
        </>
      );
    case "member_added":
      return (
        <>
          {b(u.actor)} added {b(u.detail ?? u.member ?? "someone")} to {u.team ?? "their team"}
        </>
      );
    case "member_removed":
      return (
        <>
          {b(u.actor)} removed {b(u.detail ?? u.member ?? "someone")} from {u.team ?? "their team"}
        </>
      );
    case "service_linked":
      return (
        <>
          {b(u.actor)} linked {b(u.detail ?? "their service")} to your {b(`${u.session?.name ?? "service"} – ${u.session ? day(u.session.date) : ""}`)}
        </>
      );
    case "service_unlinked": {
      const yours = b(`${u.session?.name ?? "service"} – ${u.session ? day(u.session.date) : ""}`);
      const theirs = b(u.detail ?? "their service");
      if (u.reason === "deleted")
        return (
          <>
            {b(u.actor)} deleted {theirs}, which was linked to your {yours}
          </>
        );
      if (u.reason === "moved")
        return (
          <>
            {b(u.actor)} moved {theirs} to another day, so it&apos;s no longer linked to your {yours}
          </>
        );
      return (
        <>
          {b(u.actor)} unlinked {theirs} from your {yours}
        </>
      );
    }
    default:
      return <>{b(u.actor)} withdrew a request for {place}</>;
  }
}

/**
 * Updates that flag a gap someone has to sort out: only these say when they were resolved. The rest
 * (asks, board posts, withdrawals, swaps, take-overs) are just information.
 */
const PROBLEMS = new Set<UpdateItem["kind"]>(["declined", "refused", "band_role_refused", "band_role_missing"]);

/**
 * Roster changes, newest first, in a scrolling list (the nav's inbox). New ones are tinted until the
 * inbox has been opened. `onNavigate`: called when an update's link is followed.
 */
export function UpdatesBoard({ updates, onNavigate }: { updates: UpdateItem[]; onNavigate?: () => void }) {
  if (!updates.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-sm text-center text-sm text-muted">No updates yet.</p>
      </div>
    );
  }
  return (
    <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
      {updates.map((u) => (
        <li key={u.id} className={`relative flex gap-3 px-4 py-2.5 ${u.isNew ? "bg-orange-50" : ""} ${u.href ? "hover:bg-background" : ""}`}>
          <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[u.kind]}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-6">
              {u.href ? (
                // The whole row is the link.
                <Link href={u.href} onClick={onNavigate} className="after:absolute after:inset-0">
                  {updateText(u)}
                </Link>
              ) : (
                updateText(u)
              )}
              {u.isNew && <span className="sr-only"> (new)</span>}
            </p>
            <p className="text-xs text-muted">
              {new Date(u.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {u.resolvedAt && PROBLEMS.has(u.kind) && (
                <span className="text-orange-700">
                  {" "}
                  (resolved on {new Date(u.resolvedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Singapore" })})
                </span>
              )}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
