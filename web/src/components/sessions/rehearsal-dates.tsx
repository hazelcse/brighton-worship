"use client";

import { useMemo, useRef, useState, useTransition, type TouchEvent } from "react";
import { useRouter } from "next/navigation";
import { loadRehearsalPlanner, rehearsalSubOptions, saveRehearsal, type RehearsalPlanner } from "@/app/(app)/sessions/rehearsal-actions";
import { Arrow, colourFor, layoutWeek, monthStart, shiftMonth, shortDates, weekStart, type Absence } from "@/components/schedule/schedule-view";
import { CandidateOptions, WithPlaceNote } from "@/components/roster/requests-board";
import { ROLE_LABEL, addDays, defaultRehearsalTime, formatDate, formatTime, parseYmd } from "@/lib/roster";
import type { CoverCandidate } from "@/lib/serving";

/*
 * The session builder's "date · rehearsal" line. Clicking it shows the service and rehearsal dates;
 * the session's worship leaders can then move the rehearsal (add one, or remove it) on a calendar of the
 * band's absences, and sort out anyone away on the new day: ask a sub in their name, or go ahead
 * without one.
 */

const btn = "inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium disabled:opacity-50";
const primary = `${btn} bg-ink text-ink-foreground hover:bg-ink/90`;
const secondary = `${btn} border border-border bg-surface hover:border-accent/50`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const long = (d: string) => formatDate(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const short = (d: string) => formatDate(d, { weekday: "short", day: "numeric", month: "short" });
const part = (role: string) => ROLE_LABEL[role] ?? role;

/** The boxes on the calendar, as on the schedule's swap view: the service orange, the rehearsal blue. */
const MARK = {
  service: "bg-orange-100 ring-2 ring-inset ring-orange-400",
  rehearsal: "bg-sky-100 ring-2 ring-inset ring-sky-400",
  picked: "bg-emerald-100 ring-2 ring-inset ring-emerald-500",
};

type Props = {
  planId: string;
  date: string;
  startTime: string | null;
  rehearsal: string | null;
  rehearsalTime: string | null;
  /** A worship leader of a rostered session with a rehearsal: may change it. */
  canChange: boolean;
};

export function RehearsalDates({ planId, date, startTime, rehearsal, rehearsalTime, canChange }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"info" | "change">("info");
  const [planner, setPlanner] = useState<RehearsalPlanner | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped on every "Change rehearsal date", so the form starts afresh.
  const [formKey, setFormKey] = useState(0);

  function open() {
    setMode("info");
    setNotice(null);
    dialogRef.current?.showModal();
  }
  function startChange() {
    setMode("change");
    setPlanner(null);
    setLoadError(null);
    setFormKey((k) => k + 1);
    loadRehearsalPlanner(planId)
      .then(setPlanner)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Couldn't load the calendar."));
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="group block text-left text-sm font-medium text-muted outline-none"
      >
        {/*
         * The underline grows out from the middle on hover (and focus) and shrinks back to it after:
         * a 1.5px line drawn as a background, so it can animate. On phones the rehearsal wraps to its
         * own line (the <br>), and each line gets its own underline (box-decoration-break: clone).
         */}
        <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1.5px] bg-[position:50%_100%] bg-no-repeat pb-[3px] transition-[background-size] duration-300 ease-out [box-decoration-break:clone] group-hover:bg-[length:100%_1.5px] group-focus-visible:bg-[length:100%_1.5px] motion-reduce:transition-none">
          {formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          {rehearsal && (
            <>
              <span className="hidden sm:inline"> · </span>
              <br className="sm:hidden" />
              Rehearsal {formatDate(rehearsal, { weekday: "short", day: "numeric", month: "short" })}
            </>
          )}
        </span>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="rehearsal-dates-title"
        onClose={() => setMode("info")}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close(); // backdrop
        }}
        className={`m-auto w-[calc(100%-2rem)] rounded-2xl bg-surface p-0 text-foreground shadow-2xl backdrop:bg-ink/40 ${mode === "change" ? "max-w-lg" : "max-w-md"}`}
      >
        {mode === "info" ? (
          <div className="max-h-[85vh] overflow-y-auto p-6">
            <h2 id="rehearsal-dates-title" className="font-display text-2xl font-semibold">
              Dates
            </h2>
            <dl className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
              <DateRow label="Service" swatch={MARK.service} date={date} time={startTime} />
              {rehearsal ? (
                <DateRow label="Rehearsal" swatch={MARK.rehearsal} date={rehearsal} time={rehearsalTime} />
              ) : (
                <div className="flex gap-3 px-4 py-3 text-sm">
                  <dt className="w-20 shrink-0 text-muted">Rehearsal</dt>
                  <dd className="text-muted">No rehearsal</dd>
                </div>
              )}
            </dl>
            {notice && (
              <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {notice}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => dialogRef.current?.close()} className={secondary}>
                Close
              </button>
              {canChange && (
                <button type="button" onClick={startChange} className={primary}>
                  {rehearsal ? "Change rehearsal date" : "Add rehearsal"}
                </button>
              )}
            </div>
          </div>
        ) : planner ? (
          <ChangeRehearsal
            key={formKey}
            planId={planId}
            planner={planner}
            onBack={() => setMode("info")}
            onSaved={(message) => {
              setNotice(message);
              setMode("info");
              router.refresh();
            }}
          />
        ) : (
          <div className="p-6">
            <h2 id="rehearsal-dates-title" className="font-display text-2xl font-semibold">
              {rehearsal ? "Change rehearsal date" : "Add rehearsal"}
            </h2>
            <p role={loadError ? "alert" : "status"} className={`mt-4 text-sm ${loadError ? "text-danger" : "text-muted"}`}>
              {loadError ?? "Loading the band's calendar…"}
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setMode("info")} className={secondary}>
                Back
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

function DateRow({ label, swatch, date, time }: { label: string; swatch: string; date: string; time: string | null }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 text-sm">
      <dt className="flex w-20 shrink-0 items-center gap-2 text-muted">
        <span aria-hidden className={`h-3 w-3 shrink-0 rounded-sm ${swatch}`} />
        {label}
      </dt>
      <dd className="min-w-0">
        <span className="font-medium">{long(date)}</span>
        {time && <span className="block text-muted">{formatTime(time)}</span>}
      </dd>
    </div>
  );
}

/** What to do about one band member away on the new day. */
type Choice = { target: string } | { ignore: true };

/** Calendar row sizes (px): the day number, then thin absence bars. */
const CELL = 56;
const BARS_TOP = 28;
const BAR = 4;
const BAR_GAP = 2;
const LANES = 4;

function ChangeRehearsal({
  planId,
  planner,
  onBack,
  onSaved,
}: {
  planId: string;
  planner: RehearsalPlanner;
  onBack: () => void;
  onSaved: (message: string) => void;
}) {
  const { today, date: service } = planner;
  // Only this month up to the service's month: the rehearsal has to fall between today and the service.
  const firstMonth = monthStart(today);
  const lastMonth = monthStart(service < today ? today : service);
  const inRange = (d: string) => d >= today && d <= service;
  const current = planner.rehearsal;

  const [month, setMonth] = useState(() => monthStart(current && inRange(current) ? current : today));
  const [picked, setPicked] = useState<string | null>(current && inRange(current) ? current : null);
  const [time, setTime] = useState(planner.time ?? "");
  // Adding a rehearsal: the usual time for the day picked, until they type their own.
  const [timeTouched, setTimeTouched] = useState(Boolean(current));
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, CoverCandidate[] | "loading" | "error">>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = useMemo(() => new Map(planner.band.map((b) => [b.id, b.name])), [planner.band]);
  const roleOf = useMemo(() => new Map(planner.band.map((b) => [b.id, b.role])), [planner.band]);
  // In the schedule's shape, so its bar layout and colours can be reused.
  const absences: Absence[] = useMemo(
    () => planner.absences.map((a) => ({ ...a, memberName: nameOf.get(a.memberId) ?? "Someone", reason: "" })),
    [planner.absences, nameOf],
  );
  const awayOn = (memberId: string, d: string) => absences.some((a) => a.memberId === memberId && a.startsOn <= d && a.endsOn >= d);

  const weeks = useMemo(() => {
    const out: string[] = [];
    const last = addDays(shiftMonth(month, 1), -1);
    for (let w = weekStart(month); w <= last; w = addDays(w, 7)) out.push(w);
    return out;
  }, [month]);

  // The band members away on the picked day, one row each.
  const moved = picked !== null && picked !== current;
  const away = useMemo(() => {
    if (!picked) return [];
    const seen = new Set<string>();
    return absences
      .filter((a) => a.startsOn <= picked && a.endsOn >= picked && !seen.has(a.memberId) && seen.add(a.memberId))
      .map((a) => {
        const status = planner.covered.includes(a.memberId)
          ? ("covered" as const)
          : awayOn(a.memberId, service)
            ? ("service" as const)
            : moved
              ? ("decide" as const)
              : ("current" as const);
        return { absence: a, status };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absences, picked, moved, planner.covered, service]);
  const toDecide = away.filter((x) => x.status === "decide");
  const undecided = toDecide.filter((x) => !choices[x.absence.memberId]);
  const subs = toDecide.flatMap((x) => {
    const c = choices[x.absence.memberId];
    return c ? [{ memberId: x.absence.memberId, targetId: "target" in c ? c.target : null }] : [];
  });
  const asking = subs.filter((s) => s.targetId).length;
  const changed = picked !== null && (moved || time !== (planner.time ?? ""));

  function pick(d: string) {
    if (!inRange(d) || d === picked) return;
    setPicked(d);
    if (!timeTouched) setTime(defaultRehearsalTime(planner.kind, d) ?? "");
    setChoices({});
    setOpenId(null);
    setError(null);
  }

  function toggle(memberId: string) {
    const next = openId === memberId ? null : memberId;
    setOpenId(next);
    if (!next || !picked) return;
    const key = `${memberId}|${picked}`;
    if (candidates[key] && candidates[key] !== "error") return;
    setCandidates((c) => ({ ...c, [key]: "loading" }));
    rehearsalSubOptions(planId, memberId, picked)
      .then((list) => setCandidates((c) => ({ ...c, [key]: list })))
      .catch(() => setCandidates((c) => ({ ...c, [key]: "error" })));
  }

  function save(remove = false) {
    setError(null);
    startTransition(async () => {
      const res = await saveRehearsal({ planId, date: remove ? null : picked, time: remove ? null : time || null, subs: remove ? [] : subs });
      if (res.ok) onSaved(res.message ?? "Saved.");
      else setError(res.message);
    });
  }

  // Phones: swipe sideways to change month (left = next, right = previous), as on the schedule.
  const gridRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  function go(step: number, animate = false) {
    const next = shiftMonth(month, step);
    if (next < firstMonth || next > lastMonth) return;
    setMonth(next);
    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gridRef.current?.animate(
        [
          { transform: `translateX(${step * 25}%)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 200, easing: "ease-out" },
      );
    }
  }
  function onTouchStart(e: TouchEvent) {
    swiped.current = false;
    swipe.current = e.touches.length === 1 ? { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY } : null;
  }
  function onTouchEnd(e: TouchEvent) {
    const start = swipe.current;
    swipe.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    swiped.current = true;
    setTimeout(() => (swiped.current = false), 400);
    go(dx < 0 ? 1 : -1, true);
  }

  return (
    <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back to the dates" className="-ml-2 rounded-lg p-2 text-muted hover:bg-background hover:text-foreground">
          <Arrow dir="left" />
        </button>
        <h2 id="rehearsal-dates-title" className="font-display text-2xl font-semibold">
          {current ? "Change rehearsal date" : "Add rehearsal"}
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted">
        Pick a day between today and the service on {short(service)}. The band&apos;s absences show as thin bars.
      </p>

      {/* Calendar: this month to the service's month */}
      <section aria-label="Calendar" className="mt-4 overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-1 border-b border-border px-3 py-2">
          <h3 className="mr-auto font-semibold">{formatDate(month, { month: "long", year: "numeric" })}</h3>
          {firstMonth !== lastMonth && (
            <>
              <button type="button" aria-label="Previous month" disabled={month <= firstMonth} onClick={() => go(-1)} className="rounded-lg p-2 hover:bg-background disabled:opacity-30">
                <Arrow dir="left" />
              </button>
              <button type="button" aria-label="Next month" disabled={month >= lastMonth} onClick={() => go(1)} className="rounded-lg p-2 hover:bg-background disabled:opacity-30">
                <Arrow dir="right" />
              </button>
            </>
          )}
        </div>
        <div className="grid grid-cols-7 border-b border-border text-center text-xs font-medium uppercase tracking-wider text-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1.5">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>
        <div
          ref={gridRef}
          onTouchStart={onTouchStart}
          onTouchMove={(e) => {
            if (e.touches.length > 1) swipe.current = null;
          }}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => (swipe.current = null)}
          // A swipe that ends over a day shouldn't also pick it.
          onClickCapture={(e) => {
            if (swiped.current) {
              swiped.current = false;
              e.stopPropagation();
              e.preventDefault();
            }
          }}
        >
          {weeks.map((w) => {
            const { segments, hidden } = layoutWeek(w, absences, LANES);
            return (
              <div key={w} className="relative grid grid-cols-7 border-b border-border last:border-b-0" style={{ height: CELL }}>
                {Array.from({ length: 7 }, (_, i) => {
                  const d = addDays(w, i);
                  const ok = inRange(d);
                  const inMonth = d.slice(0, 7) === month.slice(0, 7);
                  const mark = d === service ? MARK.service : d === current ? MARK.rehearsal : d === picked ? MARK.picked : "";
                  // The rehearsal's new day: a green ring inside the blue or orange box too.
                  const pickedRing = d === picked && d !== current && mark !== MARK.picked ? "outline outline-2 -outline-offset-4 outline-emerald-500" : "";
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={!ok}
                      aria-pressed={d === picked}
                      aria-label={`${formatDate(d, { weekday: "long", day: "numeric", month: "long" })}${d === service ? ", the service" : d === current ? ", the current rehearsal" : ""}${ok ? "" : " (can't be picked)"}`}
                      onClick={() => pick(d)}
                      className={`flex flex-col items-center pt-1 text-xs ${i < 6 ? "border-r border-border" : ""} ${
                        ok ? "hover:bg-background" : "cursor-not-allowed bg-background/70 text-muted/50"
                      } ${ok && !inMonth ? "text-muted" : ""} ${mark} ${pickedRing}`}
                    >
                      <span
                        className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 ${
                          d === today ? "bg-accent font-semibold text-accent-foreground" : d === picked ? "font-semibold" : ""
                        }`}
                      >
                        {parseYmd(d).d}
                      </span>
                      {hidden[i]! > 0 && (
                        <span aria-hidden className="absolute mt-0.5 text-[9px] font-bold leading-none text-muted" style={{ top: CELL - 12 }}>
                          +{hidden[i]}
                        </span>
                      )}
                    </button>
                  );
                })}
                {segments.map((g) => (
                  <span
                    key={g.absence.id}
                    aria-hidden
                    title={`${g.absence.memberName}: away ${shortDates(g.absence)}`}
                    className={`pointer-events-none absolute rounded-full ${colourFor(g.absence.memberId).dot}`}
                    style={{
                      left: `calc(${(g.col / 7) * 100}% + ${g.startsHere ? 4 : 0}px)`,
                      width: `calc(${(g.span / 7) * 100}% - ${(g.startsHere ? 4 : 0) + (g.endsHere ? 4 : 0)}px)`,
                      top: BARS_TOP + g.lane * (BAR + BAR_GAP),
                      height: BAR,
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </section>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className={`h-3 w-3 rounded-sm ${MARK.service}`} /> Service
        </li>
        {current && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className={`h-3 w-3 rounded-sm ${MARK.rehearsal}`} /> Current rehearsal
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className={`h-3 w-3 rounded-sm ${MARK.picked}`} /> {current ? "New date" : "Rehearsal"}
        </li>
      </ul>

      {/* The day picked: when, and who's away */}
      {picked ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <p className="mr-auto text-sm">
              <span className="block text-muted">{!current ? "Rehearsal" : moved ? "New rehearsal" : "Rehearsal"}</span>
              <span className="font-medium">{long(picked)}</span>
            </p>
            <label className="text-sm">
              <span className="block text-muted">Time</span>
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setTimeTouched(true);
                }}
                className="mt-1 h-10 rounded-lg border border-border bg-surface px-2 text-sm"
              />
            </label>
          </div>

          <section aria-label="Absences that day" className="overflow-hidden rounded-xl border border-border">
            <h3 className="border-b border-border px-4 py-2 text-sm font-semibold">Away on {short(picked)}</h3>
            {away.length ? (
              <ul className="divide-y divide-border">
                {away.map(({ absence: a, status }) => {
                  const id = a.memberId;
                  const choice = choices[id];
                  const key = `${id}|${picked}`;
                  const list = candidates[key];
                  const target = choice && "target" in choice ? choice.target : "";
                  const targetName = Array.isArray(list) ? list.find((c) => c.id === target)?.name : undefined;
                  const chip =
                    status === "covered"
                      ? { text: "Already asking for cover", cls: "bg-background text-muted" }
                      : status === "service"
                        ? { text: "Away for the service too", cls: "bg-background text-muted" }
                        : status === "current"
                          ? { text: "Current rehearsal", cls: "bg-background text-muted" }
                          : !choice
                            ? { text: "Choose", cls: "bg-amber-100 text-amber-800" }
                            : "ignore" in choice
                              ? { text: "Going ahead", cls: "bg-background text-foreground" }
                              : { text: `Sub: ${targetName ?? "picked"}`, cls: "bg-emerald-100 text-emerald-800" };
                  const actionable = status === "decide";
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        disabled={!actionable}
                        aria-expanded={actionable ? openId === id : undefined}
                        onClick={() => toggle(id)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left enabled:hover:bg-background"
                      >
                        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${colourFor(id).dot}`} />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{a.memberName}</span>
                          <span className="text-muted">
                            {" "}
                            · {part(roleOf.get(id) ?? "")} – {shortDates(a)}
                          </span>
                        </span>
                        <span className={`max-w-[45%] shrink-0 truncate rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip.cls}`}>{chip.text}</span>
                      </button>
                      {actionable && openId === id && (
                        <div className="space-y-3 border-t border-border bg-background/50 px-4 py-3">
                          <label className="block text-sm">
                            <span className="font-medium">Who subs {a.memberName.split(" ")[0]}?</span>
                            {list === "loading" || list === undefined ? (
                              <span className="mt-1 block text-xs text-muted">Loading who&apos;s free…</span>
                            ) : list === "error" ? (
                              <span className="mt-1 block text-xs text-danger">Couldn&apos;t load who&apos;s free. Close this and try again.</span>
                            ) : list.some((c) => !c.unavailable) ? (
                              <select
                                value={target}
                                onChange={(e) => setChoices((c) => ({ ...c, [id]: { target: e.target.value } }))}
                                className="mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
                              >
                                <option value="" disabled>
                                  Choose a person…
                                </option>
                                <CandidateOptions candidates={list} />
                              </select>
                            ) : (
                              <span className="mt-1 block text-xs text-muted">Nobody else who plays this part is free then.</span>
                            )}
                            {Array.isArray(list) && <WithPlaceNote candidates={list} />}
                          </label>
                          <p className="text-xs text-muted">
                            The sub takes {a.memberName.split(" ")[0]}&apos;s place for the whole session. The request is sent in their name, once you save.
                          </p>
                          <button
                            type="button"
                            aria-pressed={Boolean(choice && "ignore" in choice)}
                            onClick={() => {
                              setChoices((c) => ({ ...c, [id]: { ignore: true } }));
                              setOpenId(null);
                            }}
                            className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:border-accent/50 aria-pressed:border-ink"
                          >
                            Go ahead without a sub
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">Nobody in the band is away that day.</p>
            )}
          </section>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted">Tap a day on the calendar.</p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {confirmRemove ? (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-red-200 bg-red-50/60 p-3">
          <p className="mr-auto text-sm">Remove the rehearsal? The band will be told.</p>
          <button type="button" onClick={() => setConfirmRemove(false)} disabled={pending} className={secondary}>
            Keep it
          </button>
          <button type="button" onClick={() => save(true)} disabled={pending} className={`${btn} bg-danger text-white hover:bg-danger/90`}>
            Remove
          </button>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {current ? (
            <button type="button" onClick={() => setConfirmRemove(true)} disabled={pending} className="mr-auto text-sm font-medium text-danger hover:underline">
              Remove rehearsal
            </button>
          ) : (
            <span className="mr-auto" />
          )}
          <button type="button" onClick={onBack} disabled={pending} className={secondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save()}
            disabled={pending || !changed || undecided.length > 0}
            title={undecided.length ? "Choose a sub, or go ahead without one, for everyone away that day" : undefined}
            className={primary}
          >
            {pending ? "Saving…" : asking ? `Save and ask ${asking === 1 ? "the sub" : `${asking} subs`}` : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
