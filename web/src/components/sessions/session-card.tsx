import Link from "next/link";
import { ROLE_LABEL, ROLE_SHORT, formatDate } from "@/lib/roster";
import type { SessionDetail } from "@/lib/sessions";
import { PartCues } from "@/components/sessions/part-cues";
import { BandName } from "@/components/sessions/band-name";
import { ROLE_LABEL as CATALOGUE_LABEL } from "@/lib/team-config";

/** A part's name: the band's from the roster, media roles (e.g. Wide Angle Cam) from the team catalogue. */
const role = (r: string) => ROLE_LABEL[r] ?? CATALOGUE_LABEL[r] ?? r;
const heading = "mb-1.5 text-xs font-medium uppercase tracking-wider text-muted";

/** A part, with band leader / talkback as +BL / +TB like on the roster. */
function Part({ main, also }: { main: string; also: string[] }) {
  return (
    <>
      {role(main)}
      {also.map((r) => (
        <span key={r} className="ml-1 font-semibold text-accent" title={ROLE_LABEL[r]}>
          +{ROLE_SHORT[r] ?? r}
        </span>
      ))}
    </>
  );
}

/** One colour per song lead, in the order they first lead a song, so each person's songs match. */
const LEAD_COLOURS = [
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
  "bg-lime-100 text-lime-800",
  "bg-fuchsia-100 text-fuchsia-800",
];

/** Song leads' badge colours and the names to show: first names, unless two leads share one. */
function leadBadges(plan: NonNullable<SessionDetail["plan"]>) {
  const leads = new Map<string, string>();
  for (const sec of plan.sections) for (const song of sec.songs) if (song.lead) leads.set(song.lead.id, song.lead.name);
  const first = (name: string) => name.split(" ")[0] || name;
  const firstCount = new Map<string, number>();
  for (const name of leads.values()) firstCount.set(first(name), (firstCount.get(first(name)) ?? 0) + 1);
  return new Map(
    [...leads].map(([id, name], i) => [
      id,
      { label: firstCount.get(first(name))! > 1 ? name : first(name), colour: LEAD_COLOURS[i % LEAD_COLOURS.length]! },
    ]),
  );
}

/** The band by part, in roster order: "Vocalist — Name1, Name2", with +BL / +TB on whoever does them. */
function bandByPart(band: SessionDetail["band"]) {
  const parts = new Map<string, SessionDetail["band"]>();
  for (const m of band) parts.set(m.role, [...(parts.get(m.role) ?? []), m]);
  return [...parts];
}

function PlanSongs({ plan }: { plan: NonNullable<SessionDetail["plan"]> }) {
  if (!plan.sections.length) return <p className="text-sm text-muted">No songs yet.</p>;
  const badges = leadBadges(plan);
  return (
    <div className="space-y-3">
      {plan.sections.map((sec, si) => (
        <div key={si}>
          <p className={heading}>{sec.name}</p>
          <ol className="space-y-1 text-sm">
            {sec.songs.map((song, i) => {
              const badge = song.lead ? badges.get(song.lead.id) : null;
              return (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="w-4 shrink-0 text-right text-xs text-muted">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">
                    {song.title}
                    {song.key && <span className="text-muted"> — {song.key}</span>}
                  </span>
                  {badge && (
                    <span className={`max-w-[40%] shrink-0 truncate rounded-full px-2 py-0.5 text-xs font-medium ${badge.colour}`} title={`Led by ${song.lead!.name}`}>
                      {badge.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

/**
 * A session's card: date, name, your part, the songs once the plan's published (or a note that it
 * isn't yet), and the band (a media team's session: its crew). Links to the plan when you can open it.
 * Used on the home page and in the calendar.
 */
export function SessionCard({
  s,
  href,
  extra,
}: {
  s: SessionDetail;
  /** Where the card links instead of the plan itself (e.g. via a team switch). */
  href?: string;
  /** One more block at the bottom of the card, e.g. root's media crew for the service. */
  extra?: React.ReactNode;
}) {
  // A media team's session: its crew (headed "Crew") where the band would be.
  const people = s.crew ? "crew" : "band";
  const body = (
    <>
      <header className="bg-background/60 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">
          {formatDate(s.date, { weekday: "short", day: "numeric", month: "short" })}
        </p>
        <p className="font-semibold">{s.name}</p>
        {s.role && (
          <p className="text-xs text-muted">
            You: <Part main={s.role} also={s.also} />
          </p>
        )}
      </header>
      <section aria-label="Songs" className="space-y-3 p-4">
        {s.plan && <PartCues role={s.role} cues={s.plan.cues} />}
        {s.plan ? (
          <PlanSongs plan={s.plan} />
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted">
            The worship leaders haven&apos;t published the plan yet.
          </p>
        )}
      </section>
      <section aria-label={people === "crew" ? "Crew" : "Band"} className="p-4">
        <p className={heading}>{people === "crew" ? "Crew" : "Band"}</p>
        {/* Two columns (filled top to bottom) once the card is wide enough, so it isn't one long list. */}
        <dl className="gap-x-6 text-sm @md:columns-2">
          {bandByPart(s.band).map(([part, members]) => (
            <div key={part} className="flex break-inside-avoid gap-3 py-0.5">
              <dt className="w-24 shrink-0 text-xs leading-5 text-muted">{role(part)}</dt>
              <dd className="min-w-0 flex-1">
                {members.map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ", "}
                    <BandName name={m.name} role={m.role} you={m.you} />
                    {m.also.map((r) => (
                      <span key={r} className="ml-1 text-xs font-semibold text-accent" title={ROLE_LABEL[r]}>
                        +{ROLE_SHORT[r] ?? r}
                      </span>
                    ))}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {extra && <div className="p-4">{extra}</div>}
    </>
  );
  // Header, songs and band as three blocks with lines between; @container lets the band go two-column.
  const box = "@container flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface";
  return s.plan?.canOpen ? (
    <Link href={href ?? `/sessions/${s.plan.id}`} prefetch={href ? false : undefined} className={`${box} transition hover:border-accent/50`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}
