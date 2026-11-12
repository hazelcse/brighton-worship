import {
  MINISTRY_LABEL,
  ROLE_LABEL,
  ROLE_SHORT,
  ATTACHED_ROLES,
  addDays,
  formatDate,
  weekday,
  type People,
} from "@/lib/roster";
import type {
  AssignmentRow,
  GenerationResult,
  SessionRow,
} from "@/lib/roster-data";
import { MissBadge } from "./miss-badge";
import { PastRowsFrame } from "./past-rows-toggle";

const MINISTRY_STYLE = {
  em: "bg-sky-100 text-sky-800",
  cm: "bg-rose-100 text-rose-800",
  any: "bg-violet-100 text-violet-800",
} as const;

// Column order: singers first, then instruments. Band leader / talkback are shown as "+BL" / "+TB"
// next to the instrument player, not as columns.
const COLUMNS = [
  "worship leader",
  "vocalist",
  "keys",
  "synth/pads",
  "electric guitar",
  "acoustic guitar",
  "bass",
  "drums",
];
const HEADER: Record<string, string> = {
  "worship leader": "WL",
  vocalist: "V",
  keys: "Keys",
  "synth/pads": "Synth",
  "electric guitar": "EG",
  "acoustic guitar": "AG",
  bass: "Bass",
  drums: "Drums",
};

/** The roster as a table: one row per session, one column per part, names stacked in each cell. */
/** Phones: the date column stays put while the table scrolls sideways, with a line down its right edge. */
const FROZEN = "max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:shadow-[1px_0_0_var(--color-border)]";

export function RosterTable({
  sessions,
  assignments,
  onCellClick,
  onSessionClick,
  edited,
  generated,
  nameOf,
  problems,
  isMarked,
  serveStatus,
  thisWeekOf,
  pastHidden,
  onTogglePast,
}: {
  sessions: SessionRow[];
  assignments: AssignmentRow[];
  /** When set (root on a draft), cells are buttons that open the cell editor. */
  onCellClick?: (sessionId: string, role: string) => void;
  /** When set, the date and service are buttons that open the session's settings (band, who can serve…). */
  onSessionClick?: (sessionId: string) => void;
  /** "sessionId|role" of cells changed by hand since generating. */
  edited?: Set<string>;
  /** "sessionId|role|memberId" the optimiser chose: anyone else in an edited cell was put in by hand (bold). */
  generated?: Set<string>;
  /** With `generated`: names for people taken off a part since then, shown struck through. */
  nameOf?: (memberId: string) => string;
  /** "sessionId|role" -> what's wrong: cells with a hard problem (red, over the orange "changed"). */
  problems?: Map<string, string>;
  /** Light-yellow highlight: this person on this date is part of a missed rule the user picked. */
  isMarked?: (memberId: string, date: string) => boolean;
  /** "YYYY-MM-DD": mark out the week (Monday to Sunday) containing this day, e.g. today. */
  thisWeekOf?: string;
  /** This quarter's roster: light orange until confirmed, light red when they can't serve. */
  serveStatus?: Record<string, "pending" | "accepted" | "declined">;
  /** With `thisWeekOf`: hide the sessions in weeks before it. */
  pastHidden?: boolean;
  /** With `thisWeekOf`: show a triangle beside this week's top line that hides / shows past sessions. */
  onTogglePast?: () => void;
}) {
  const active = sessions.filter((s) => !s.cancelled);
  const cell = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const k = `${a.session_id}|${a.role}`;
    cell.set(k, [...(cell.get(k) ?? []), a]);
  }
  // People in the roster as generated (or as published, when editing it) who've been taken off
  // that part since: "sessionId|role" -> member ids.
  const removed = new Map<string, string[]>();
  if (generated && nameOf) {
    const now = new Set(assignments.map((a) => `${a.session_id}|${a.role}|${a.member_id}`));
    const shown = new Set(active.map((s) => s.id));
    for (const g of generated) {
      if (now.has(g)) continue;
      const [sid, role, mid] = g.split("|");
      if (!shown.has(sid)) continue;
      removed.set(`${sid}|${role}`, [...(removed.get(`${sid}|${role}`) ?? []), mid]);
    }
  }
  // Only show columns some session actually needs (or that still show someone taken off).
  const columns = COLUMNS.filter(
    (c) => active.some((s) => (s.composition as Record<string, number>)[c] > 0) || active.some((s) => removed.has(`${s.id}|${c}`)),
  );
  // Alternate weeks (Monday to Sunday) are lightly tinted: the 1st, 3rd, 5th… week shown.
  const weekOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
  const tinted = new Set<string>();
  let n = 0;
  let last = "";
  for (const s of active) {
    const w = weekOf(s.date);
    if (w !== last) {
      n += 1;
      last = w;
    }
    if (n % 2 === 1) tinted.add(s.id);
  }
  // This week's rows: bold dates and sessions, between two heavy lines.
  const thisWeek = thisWeekOf ? active.filter((s) => weekOf(s.date) === weekOf(thisWeekOf)).map((s) => s.id) : [];
  const firstOfWeek = thisWeek[0];
  const lastOfWeek = thisWeek[thisWeek.length - 1];
  // Sessions in weeks before this one, which can be folded away; the toggle sits on the first
  // row after them (this week's first row, when this week has a session).
  const past = new Set(thisWeekOf ? active.filter((s) => weekOf(s.date) < weekOf(thisWeekOf)).map((s) => s.id) : []);
  const boundary = past.size > 0 ? active.find((s) => !past.has(s.id))?.id : undefined;
  const togglePast = onTogglePast && boundary ? onTogglePast : undefined;
  const rows = togglePast && pastHidden ? active.filter((s) => !past.has(s.id)) : active;

  const table = (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="sticky top-0 bg-background text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className={`px-2 py-1.5 font-semibold ${FROZEN} max-sm:bg-background`}>
              Date
            </th>
            <th scope="col" className="px-2 py-1.5 font-semibold">
              Service
            </th>
            <th scope="col" className="px-2 py-1.5 font-semibold">
              EM/CM
            </th>
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className="px-2 py-1.5 font-semibold"
                title={ROLE_LABEL[c]}
              >
                {HEADER[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((s) => (
            <tr
              key={s.id}
              data-past-boundary={togglePast && s.id === boundary ? "" : undefined}
              aria-current={thisWeek.includes(s.id) ? "date" : undefined}
              className={`align-top ${past.has(s.id) ? "opacity-70" : ""} ${tinted.has(s.id) ? "bg-slate-100/50" : ""} ${s.id === firstOfWeek ? "border-t-2 border-t-foreground" : ""} ${
                s.id === lastOfWeek ? "border-b-2 border-b-foreground" : ""
              }`}
            >
              <td
                className={`whitespace-nowrap px-2 py-1.5 ${thisWeek.includes(s.id) ? "font-bold" : "font-medium"} ${FROZEN} ${
                  // Opaque, so names scroll under it: slate-50 is the row tint (slate-100 at 50%) over white.
                  tinted.has(s.id) ? "max-sm:bg-slate-50" : "max-sm:bg-surface"
                }`}
              >
                <SessionLink session={s} onClick={onSessionClick}>
                  {formatDate(s.date, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </SessionLink>
              </td>
              <td className={`px-2 py-1.5 ${thisWeek.includes(s.id) ? "font-bold" : ""}`}>
                <SessionLink session={s} onClick={onSessionClick}>
                  {s.name}
                </SessionLink>
              </td>
              <td className="px-2 py-1.5">
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${MINISTRY_STYLE[s.ministry]}`}
                >
                  {MINISTRY_LABEL[s.ministry]}
                </span>
              </td>
              {columns.map((c) => {
                const need = (s.composition as Record<string, number>)[c] ?? 0;
                const people = (cell.get(`${s.id}|${c}`) ?? []).sort((a, b) =>
                  a.name.localeCompare(b.name),
                );
                const gone = (removed.get(`${s.id}|${c}`) ?? []).map((id) => ({ id, name: nameOf!(id) })).sort((a, b) => a.name.localeCompare(b.name));
                const isEdited = edited?.has(`${s.id}|${c}`) || gone.length > 0;
                const problem = problems?.get(`${s.id}|${c}`);
                const editable = Boolean(onCellClick) && need > 0;
                const when = formatDate(s.date, { day: "numeric", month: "short" });
                // The whole cell (everyone in this part, plus empty places) is edited at once.
                const Item = editable ? "span" : "li";
                const slot = (key: string, className: string, children: React.ReactNode) => (
                  <Item key={key} className={`${editable ? "block " : ""}${className}`}>
                    {children}
                  </Item>
                );
                return (
                  <td
                    key={c}
                    className={`px-2 py-1.5 ${problem ? "bg-red-50" : isEdited ? "bg-orange-50" : ""}`}
                    title={problem ?? (isEdited ? "Changed by hand" : undefined)}
                  >
                    {need === 0 && people.length === 0 && gone.length === 0 ? (
                      <span className="text-border" aria-label="not needed">
                        –
                      </span>
                    ) : (
                      <CellList
                        editable={editable}
                        label={`Change ${ROLE_LABEL[c]} (${s.name}, ${when})`}
                        onClick={() => onCellClick?.(s.id, c)}
                      >
                        {people.map((a) =>
                          slot(
                            a.member_id,
                            `whitespace-nowrap ${isEdited && generated && !generated.has(`${s.id}|${c}|${a.member_id}`) ? "font-semibold" : ""} ${
                              isMarked?.(a.member_id, s.date)
                                ? "-mx-1 rounded bg-yellow-100 px-1"
                                : serveStatus?.[`${s.id}|${a.member_id}`] === "pending"
                                  ? "-mx-1 w-fit rounded bg-orange-100 px-1"
                                  : serveStatus?.[`${s.id}|${a.member_id}`] === "declined"
                                    ? "-mx-1 w-fit rounded bg-red-100 px-1"
                                    : ""
                            }`,
                            <>
                              {a.name}
                              {a.also_roles.map((r) => (
                                <span key={r} className="ml-1 text-xs font-semibold text-accent" title={ROLE_LABEL[r]}>
                                  +{ROLE_SHORT[r]}
                                </span>
                              ))}
                            </>,
                          ),
                        )}
                        {Array.from({ length: Math.max(0, need - people.length) }, (_, i) =>
                          slot(`empty-${i}`, "text-xs text-danger", "Unfilled"),
                        )}
                        {gone.map((g) =>
                          slot(
                            `gone-${g.id}`,
                            "whitespace-nowrap text-muted line-through",
                            <>
                              {g.name}
                              <span className="sr-only"> (taken off)</span>
                            </>,
                          ),
                        )}
                      </CellList>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (!togglePast) return table;
  return (
    <PastRowsFrame hidden={Boolean(pastHidden)} count={past.size} onToggle={togglePast}>
      {table}
    </PastRowsFrame>
  );
}

/** A session's date or name: plain text, or (when editable) a button that opens its settings. */
function SessionLink({ session, onClick, children }: { session: SessionRow; onClick?: (id: string) => void; children: React.ReactNode }) {
  if (!onClick) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => onClick(session.id)}
      aria-label={`Change ${session.name}, ${formatDate(session.date, { day: "numeric", month: "short" })}: band, who can serve, times`}
      className="-mx-1 rounded px-1 py-0.5 text-left hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {children}
    </button>
  );
}

/** A cell's names: a plain list, or (when editable) one button that opens the whole cell. */
function CellList({ editable, label, onClick, children }: { editable: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  if (!editable) return <ul className="space-y-0.5">{children}</ul>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="-mx-1 block w-[calc(100%+0.5rem)] space-y-0.5 rounded px-1 py-0.5 text-left hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {children}
    </button>
  );
}

/** Green "all good" or red "impossible" summary. */
export function ResultStatus({
  result,
  generatedAt,
  edited,
}: {
  result: GenerationResult;
  generatedAt: string | null;
  /** Set once the roster has been changed by hand. */
  edited?: { cells: number; changePoints: number; problems: number };
}) {
  if (edited) {
    const better = edited.changePoints < 0;
    return (
      <div
        role="status"
        className="space-y-1 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900"
      >
        <p className="font-semibold">Edited by hand</p>
        <p>
          {edited.cells} {edited.cells === 1 ? "part" : "parts"} changed since
          generating. Score{" "}
          {edited.changePoints === 0
            ? "the same as"
            : `${Math.abs(edited.changePoints)} ${Math.abs(edited.changePoints) === 1 ? "point" : "points"} ${better ? "higher" : "lower"} than`}{" "}
          the generated roster
          {edited.problems
            ? `, with ${edited.problems} ${edited.problems === 1 ? "problem" : "problems"} to fix.`
            : "."}
        </p>
      </div>
    );
  }
  if (result.status === "impossible") {
    return (
      <p role="status" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <span className="font-semibold">This roster is impossible as the rules stand.</span> This is the closest roster the
        optimiser could find. Change the hard rules or the sessions and generate again, or fix it by hand.
      </p>
    );
  }
  return (
    <p
      role="status"
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
    >
      ✓ Every place is filled and every hard rule is met.{" "}
      {result.status === "optimal"
        ? "This is the best roster for these rules and weights."
        : "Within 2% of the best possible roster."}
      {generatedAt && (
        <span className="block pt-1 text-xs text-emerald-800">
          Generated{" "}
          {new Date(generatedAt).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          })}{" "}
          in {result.solve_seconds}s
        </span>
      )}
    </p>
  );
}

/** Side panel: the weights that went into this roster. */
export function WeightsPanel({
  result,
  sessions,
  sentence,
}: {
  result: GenerationResult;
  sessions: SessionRow[];
  sentence: (id: string) => string;
}) {
  const types = [
    ...new Map(
      sessions.filter((s) => !s.cancelled).map((s) => [s.name, s]),
    ).values(),
  ];
  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl p-4 font-semibold hover:bg-background/60 [&::-webkit-details-marker]:hidden">
        Weights used
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="text-muted transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="space-y-3 px-4 pb-4">
      <div className="space-y-1 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Sessions
        </h3>
        {types.map((s) => (
          <p key={s.name} className="flex justify-between gap-3">
            <span>{s.name}</span>
            <span className="font-medium">{s.weight}</span>
          </p>
        ))}
      </div>
      <div className="space-y-1 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Rules
        </h3>
        {Object.entries(result.weights.rules).map(([id, w]) => (
          <p key={id} className="flex justify-between gap-3">
            <span className="min-w-0">{sentence(id)}</span>
            <span className="shrink-0 font-medium">
              {w.hard ? "hard" : w.weight}
            </span>
          </p>
        ))}
        <p className="flex justify-between gap-3">
          <span className="min-w-0">
            Split EM/CM by each person&apos;s % (built in)
          </span>
          <span className="shrink-0 font-medium">
            {result.weights.em_cm_split}
          </span>
        </p>
      </div>
      </div>
    </details>
  );
}

/** Side panel: whether each rule was met. */
export function RulesPanel({
  result,
  sentence,
  isBuiltIn,
}: {
  result: GenerationResult;
  sentence: (id: string) => string;
  isBuiltIn: (id: string) => boolean;
}) {
  const hardIds = Object.entries(result.weights.rules)
    .filter(([, w]) => w.hard)
    .map(([id]) => id);
  const broken = new Set(result.hard_broken.map((h) => h.rule));
  const soft = result.soft.filter((s) => !isBuiltIn(s.rule));
  const brokenBy = new Map(result.hard_broken.map((h) => [h.rule, h]));
  return (
    <section
      aria-labelledby="rules-met-title"
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <h2 id="rules-met-title" className="font-semibold">
        Rules
      </h2>
      {hardIds.length === 0 && soft.length === 0 && (
        <p className="text-sm text-muted">
          No rules besides the built-in ones.
        </p>
      )}
      <ul className="space-y-2 text-sm">
        {hardIds.map((id) => (
          <li key={id} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="text-xs text-muted">Hard · </span>
              {sentence(id)}
            </span>
            <MissBadge
              ruleId={id}
              ok={!broken.has(id)}
              text={broken.has(id) ? "Broken" : "Met"}
              where={brokenBy.get(id)?.where}
            />
          </li>
        ))}
        {soft.map((s) => (
          <li key={s.rule} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="text-xs text-muted">Soft · </span>
              {sentence(s.rule)}
            </span>
            <MissBadge
              ruleId={s.rule}
              ok={s.violations === 0}
              text={
                s.violations === 0 ? "Fully met" : `Missed ${s.violations}×`
              }
              where={s.where}
            />
          </li>
        ))}
      </ul>
      {result.spacing && (
        <p className="border-t border-border pt-2 text-xs text-muted">
          <span className="font-medium text-foreground">Spacing:</span>{" "}
          {result.spacing.within_1_week} times someone serves back-to-back weeks
          (7 days or less apart), {result.spacing.within_2_weeks} within 2
          weeks.
        </p>
      )}
      {result.variety && (
        <p className="text-xs text-muted">
          <span className="font-medium text-foreground">Variety:</span> {result.variety.pairs} different pairs serve together;
          the same two people serve together at most {result.variety.max_together} times.
        </p>
      )}
    </section>
  );
}

/** Everyone's load (shown in a popup). */
export function LoadsTable({
  result,
  people,
}: {
  result: GenerationResult;
  people: People;
}) {
  const notRostered = people.filter(
    (p) => !result.loads.some((l) => l.member === p.id),
  );
  // Each person's parts in the usual role order; band leader / talkback as +BL / +TB, like the roster.
  const order = Object.keys(ROLE_LABEL);
  const instruments = new Map(
    people.map((p) => {
      const sorted = [...p.instruments].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return [
        p.id,
        {
          main: sorted.filter((r) => !(ATTACHED_ROLES as readonly string[]).includes(r)).map((r) => ROLE_LABEL[r] ?? r).join(", "),
          also: sorted.filter((r) => (ATTACHED_ROLES as readonly string[]).includes(r)),
        },
      ];
    }),
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Main services and P&Ps are balanced separately. Weighted load = sessions
        × session weight. For people who serve both EM and CM, their EM share is
        shown against their target.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Instruments</th>
              <th className="py-2 pr-3 font-medium">Services</th>
              <th className="py-2 pr-3 font-medium">P&amp;P</th>
              <th className="py-2 pr-3 font-medium">Weighted load</th>
              <th className="py-2 pr-3 font-medium">EM / CM</th>
              <th className="py-2 font-medium">EM share (target)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {result.loads.map((l) => {
              const both =
                l.em_target !== null && l.em_target > 0 && l.em_target < 100;
              const off =
                both && l.em_actual !== null
                  ? Math.abs(l.em_actual - (l.em_target ?? 0))
                  : 0;
              return (
                <tr key={l.member}>
                  <td className="py-1.5 pr-3 font-medium">
                    {l.name}
                    {l.factor !== undefined && l.factor < 1 && (
                      <span
                        className="ml-1 text-xs font-normal text-muted"
                        title="Serves less"
                      >
                        ×{l.factor}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-muted">
                    {instruments.get(l.member)?.main || "–"}
                    {instruments.get(l.member)?.also.map((r) => (
                      <span key={r} className="ml-1 font-semibold text-accent" title={ROLE_LABEL[r]}>
                        +{ROLE_SHORT[r]}
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5 pr-3">{l.main ?? l.services}</td>
                  <td className="py-1.5 pr-3">{l.pnp ?? "–"}</td>
                  <td className="py-1.5 pr-3">{l.weighted}</td>
                  <td className="py-1.5 pr-3 text-muted">
                    {l.em} / {l.cm}
                  </td>
                  <td className="py-1.5">
                    {both ? (
                      <span className={off > 15 ? "text-amber-700" : ""}>
                        {l.em_actual ?? "–"}% ({l.em_target}%)
                      </span>
                    ) : (
                      <span className="text-muted">
                        {l.em_target === 100
                          ? "EM only"
                          : l.em_target === 0
                            ? "CM only"
                            : "–"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {notRostered.length > 0 && (
        <p className="text-xs text-muted">
          Not rostered (no matching role or ministry):{" "}
          {notRostered.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}
