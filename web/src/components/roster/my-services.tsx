import Link from "next/link";
import { ROLE_LABEL, ROLE_SHORT, formatDate } from "@/lib/roster";
import type { MyService } from "@/lib/sessions";
import { DragScroll } from "./drag-scroll";
import { WindLeaf } from "./wind-leaf";

const CARD = "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4";

/** One service: date, name, and the band (no songs, even once the plan is published). */
function ServiceBody({ s }: { s: MyService }) {
  return (
    <>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted">
          {formatDate(s.date, { weekday: "short", day: "numeric", month: "short" })}
        </p>
        <p className="font-semibold leading-snug">{s.name}</p>
      </div>
      <ul className="space-y-0.5 text-sm">
        {s.band.map((m) => (
          <li key={`${m.id}-${m.role}`} className="flex items-baseline gap-2">
            <span className="w-12 shrink-0 text-xs text-muted" title={ROLE_LABEL[m.role] ?? m.role}>
              {ROLE_SHORT[m.role] ?? m.role}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {m.name}
              {m.also.map((r) => (
                <span key={r} className="ml-1 text-xs font-semibold text-accent" title={ROLE_LABEL[r]}>
                  +{ROLE_SHORT[r] ?? r}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Card widths: as many per row as the Songs / Team galleries (4 → 3 → 2), with a peek of the next
 * card on small phones. Extra cards are reached by scrolling / dragging the row sideways.
 */
const WIDTH =
  "w-[85%] min-[420px]:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)] xl:w-[calc((100%-2.25rem)/4)]";

/**
 * The viewer's confirmed upcoming services, one sideways-scrolling row, with no box around the
 * section. It takes the share of the page height the Updates box had, so Requests keeps its height
 * and the space stays when there are few (or no) services. A card opens the session once its plan
 * is published; until then it isn't a link.
 */
export function MyServices({ services }: { services: MyService[] }) {
  return (
    <section aria-label="Your Services" className="flex flex-[1_1_0px] flex-col gap-3">
      <h2 className="text-lg font-semibold">Your Services</h2>
      {services.length === 0 ? (
        <WindLeaf label="No confirmed services coming up." className="flex-1 py-6" />
      ) : (
        <DragScroll className="gap-3 pb-3 pt-1">
          {services.map((s) => (
            <div key={s.rosterSessionId} className={`flex shrink-0 snap-start ${WIDTH}`}>
              {s.planId ? (
                <Link
                  href={`/sessions/${s.planId}`}
                  draggable={false}
                  className={`${CARD} w-full transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md`}
                >
                  <ServiceBody s={s} />
                </Link>
              ) : (
                <div className={`${CARD} w-full`}>
                  <ServiceBody s={s} />
                </div>
              )}
            </div>
          ))}
        </DragScroll>
      )}
    </section>
  );
}
