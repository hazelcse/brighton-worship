"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type TouchEvent } from "react";
import { deleteAbsence, getSessionDetail, saveAbsence } from "@/app/(app)/roster/schedule/actions";
import { ROLE_SHORT, addDays, formatDate, formatTime, parseYmd, weekday, ymd } from "@/lib/roster";
import { rehearsalTime, sessionTime } from "@/lib/reminder";
import type { SessionDetail } from "@/lib/sessions";
import { SessionCard } from "@/components/sessions/session-card";
import type { CoverDetail, MySession } from "@/lib/serving";
import type { AbsenceInput } from "@/lib/absence";
import type { AbsenceClash } from "@/lib/serving";
import { AbsenceCoverDialog } from "./absence-cover-dialog";
import { CoverPanel } from "./cover-panel";

export type Absence = {
  id: string;
  memberId: string;
  memberName: string;
  startsOn: string;
  endsOn: string;
  reason: string;
};

/** A rostered session (root only), e.g. EM Sunday Service, or its rehearsal (kind "rehearsal"). */
export type ServiceEvent = {
  id: string;
  date: string;
  name: string;
  kind: string;
  /** For a rehearsal: the service or event it's for. */
  forSession?: { date: string; name: string; kind: string };
};

/** "EM" / "CM" from a session kind like "em_sunday", or null for a custom event. */
function ministryOf(kind: string | undefined) {
  return kind?.startsWith("em_") ? "EM" : kind?.startsWith("cm_") ? "CM" : null;
}

/** "EM Rehearsal", "CM Rehearsal", or "EM/CM Rehearsal" when both are that day. */
function rehearsalLabel(rehearsals: { forSession?: { kind: string } }[]) {
  const ministries = [...new Set(rehearsals.map((r) => ministryOf(r.forSession?.kind)).filter(Boolean))].sort();
  return ministries.length ? `${ministries.join("/")} Rehearsal` : "Rehearsal";
}

/** What a rehearsal is for: "EM Sunday Service · Sun 15 Nov". */
function RehearsalFor({ s }: { s?: { date: string; name: string } }) {
  if (!s) return null;
  return (
    <span className="block text-muted">
      For {s.name} · {formatDate(s.date, { weekday: "short", day: "numeric", month: "short" })}
    </span>
  );
}

type Props = {
  absences: Absence[];
  services: ServiceEvent[];
  today: string;
  userId: string;
  isRoot: boolean;
  /** The viewer's own sessions on published rosters. */
  mySessions?: MySession[];
  /** Opened from a request to cover: that day is highlighted and the panel offers take over / swap. */
  cover?: CoverDetail | null;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Row sizes (px) used to work out how many bars fit in a week row. */
const DAY_HEADER = 28;
const EVENTS = 16;
const LANE = 16;
const MORE = 14;

/** Calendar chips: one "Sun Svc" however many Sunday services there are, and one "PnP". */
function serviceChips(services: ServiceEvent[]) {
  const chips: { label: string; dot: string }[] = [];
  if (services.some((s) => s.kind.endsWith("_sunday"))) chips.push({ label: "Sun Svc", dot: SERVICE_DOT.sunday });
  if (services.some((s) => s.kind.endsWith("_pnp"))) chips.push({ label: "PnP", dot: SERVICE_DOT.pnp });
  const rehearsals = services.filter((s) => s.kind === "rehearsal");
  if (rehearsals.length) chips.push({ label: rehearsalLabel(rehearsals), dot: SERVICE_DOT.rehearsal });
  if (services.some((s) => s.kind === "custom")) chips.push({ label: "Other", dot: SERVICE_DOT.custom });
  return chips;
}

/** Dot colours for services, Google Calendar style. */
const SERVICE_DOT = { sunday: "bg-accent", pnp: "bg-[#5f7f9e]", rehearsal: "bg-[#c2a26a]", custom: "bg-muted" };
function serviceDot(kind: string) {
  if (kind === "rehearsal") return SERVICE_DOT.rehearsal;
  return kind.endsWith("_sunday") ? SERVICE_DOT.sunday : kind.endsWith("_pnp") ? SERVICE_DOT.pnp : SERVICE_DOT.custom;
}

/** One colour per person, so their bars are easy to follow across the month. */
// Muted, earthy tones; bars are translucent tints with dark text in the same hue.
const COLOURS = [
  { bar: "bg-[#6b8fa3]/20 text-[#2f4a5a] border-[#6b8fa3]", dot: "bg-[#6b8fa3]" }, // slate blue
  { bar: "bg-[#7f9a7a]/20 text-[#3b5237] border-[#7f9a7a]", dot: "bg-[#7f9a7a]" }, // sage
  { bar: "bg-[#9a86a8]/20 text-[#4e3f5c] border-[#9a86a8]", dot: "bg-[#9a86a8]" }, // lavender
  { bar: "bg-[#b9857a]/20 text-[#6b3b31] border-[#b9857a]", dot: "bg-[#b9857a]" }, // clay
  { bar: "bg-[#c2a26a]/25 text-[#6b5223] border-[#c2a26a]", dot: "bg-[#c2a26a]" }, // ochre
  { bar: "bg-[#6f9c96]/20 text-[#2f5550] border-[#6f9c96]", dot: "bg-[#6f9c96]" }, // teal grey
  { bar: "bg-[#a87f92]/20 text-[#5c3a4a] border-[#a87f92]", dot: "bg-[#a87f92]" }, // dusty rose
  { bar: "bg-[#8a8fb5]/20 text-[#3f4468] border-[#8a8fb5]", dot: "bg-[#8a8fb5]" }, // periwinkle
];
export function colourFor(memberId: string) {
  let h = 0;
  for (const ch of memberId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[h % COLOURS.length]!;
}

export function monthStart(date: string) {
  const { y, m } = parseYmd(date);
  return ymd(y, m, 1);
}
export function shiftMonth(first: string, n: number) {
  const { y, m } = parseYmd(first);
  const t = y * 12 + (m - 1) + n;
  return ymd(Math.floor(t / 12), (t % 12) + 1, 1);
}
/** Monday on or before the date. */
export function weekStart(date: string) {
  return addDays(date, -((weekday(date) + 6) % 7));
}
function dayNumber(date: string) {
  return parseYmd(date).d;
}

export function describeDates(a: { startsOn: string; endsOn: string }) {
  if (a.startsOn === a.endsOn) return formatDate(a.startsOn, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const sameYear = a.startsOn.slice(0, 4) === a.endsOn.slice(0, 4);
  const start = formatDate(a.startsOn, sameYear ? { day: "numeric", month: "short" } : undefined);
  return `${start} – ${formatDate(a.endsOn)}`;
}

/** "Sun, 11/08/26", or "Sun, 11/08/26 – Tue, 11/10/26" for a range. */
function shortDate(date: string) {
  const day = formatDate(date, { weekday: "short" });
  return `${day}, ${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(2, 4)}`;
}
export function shortDates(a: { startsOn: string; endsOn: string }) {
  return a.startsOn === a.endsOn ? shortDate(a.startsOn) : `${shortDate(a.startsOn)} – ${shortDate(a.endsOn)}`;
}

type Segment = { absence: Absence; col: number; span: number; lane: number; startsHere: boolean; endsHere: boolean };

/** Lay a week's absences into lanes, Google Calendar style: earliest and longest first. */
export function layoutWeek(start: string, absences: Absence[], maxLanes: number) {
  const end = addDays(start, 6);
  const inWeek = absences
    .filter((a) => a.startsOn <= end && a.endsOn >= start)
    .sort((a, b) => (a.startsOn === b.startsOn ? b.endsOn.localeCompare(a.endsOn) : a.startsOn.localeCompare(b.startsOn)));
  const laneEnds: string[] = [];
  const segments: Segment[] = [];
  for (const a of inWeek) {
    const s = a.startsOn < start ? start : a.startsOn;
    const e = a.endsOn > end ? end : a.endsOn;
    let lane = laneEnds.findIndex((le) => le < s);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = e;
    const col = (weekday(s) + 6) % 7;
    const span = (weekday(e) + 6) % 7 - col + 1;
    segments.push({ absence: a, col, span, lane, startsHere: a.startsOn >= start, endsHere: a.endsOn <= end });
  }
  // Per day: how many absences didn't fit in the visible lanes.
  const hidden = Array.from({ length: 7 }, (_, i) => segments.filter((g) => g.lane >= maxLanes && g.col <= i && i < g.col + g.span).length);
  return { segments: segments.filter((g) => g.lane < maxLanes), hidden };
}

/** Absences that include the given day. */
function onDay(absences: Absence[], date: string) {
  return absences.filter((a) => a.startsOn <= date && a.endsOn >= date);
}

export function ScheduleView({ absences: all, services, today, userId, isRoot, mySessions = [], cover }: Props) {
  const [month, setMonth] = useState(() => monthStart(cover?.session.date ?? today));
  // Days to point out while choosing a swap: every option, and the one picked.
  const [focus, setFocus] = useState<{ options: string[]; selected: string[] }>({ options: [], selected: [] });
  // The request's service and its rehearsal: both flash so it's clear the cover needs both days.
  const coverDates = cover ? [cover.session.date, ...(cover.session.rehearsal ? [cover.session.rehearsal] : [])] : [];
  // Bumped whenever the highlighted days change, so they flash again.
  const [flashKey, setFlashKey] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dayDialogRef = useRef<HTMLDialogElement>(null);
  // The session panel: opened from an event in the day popup; closes back to the calendar.
  const sessionDialogRef = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState<{ id: string; rehearsal: boolean; detail: SessionDetail | null; loading: boolean } | null>(null);
  const [editing, setEditing] = useState<Absence | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [draftStart, setDraftStart] = useState(today);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Root sees everyone by default and can narrow it to their own. Members only ever get their own.
  // Covering for someone: start on just your own absences and sessions.
  const [showEveryone, setShowEveryone] = useState(!cover);
  const absences = useMemo(() => (isRoot && showEveryone ? all : all.filter((a) => a.memberId === userId)), [all, isRoot, showEveryone, userId]);
  // Services show only in root's Everyone view.
  const showServices = isRoot && showEveryone;
  const servicesByDate = useMemo(() => {
    const m = new Map<string, ServiceEvent[]>();
    for (const s of services) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return m;
  }, [services]);
  // Otherwise the event row shows the viewer's own sessions.
  const mineByDate = useMemo(() => {
    const m = new Map<string, MySession[]>();
    for (const s of mySessions) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return m;
  }, [mySessions]);
  const showEvents = showServices || mySessions.length > 0;
  const top = DAY_HEADER + (showEvents ? EVENTS : 0);

  // Fit as many bars as each week row has room for; the rest show as "…".
  const weeksRef = useRef<HTMLDivElement>(null);
  const [maxLanes, setMaxLanes] = useState(2);
  useEffect(() => {
    const el = weeksRef.current;
    if (!el) return;
    const measure = () => {
      const row = el.firstElementChild as HTMLElement | null;
      if (row) setMaxLanes(Math.max(0, Math.floor((row.clientHeight - top - MORE) / LANE)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [top]);

  const weeks = useMemo(() => {
    const first = weekStart(month);
    const last = addDays(shiftMonth(month, 1), -1);
    const out: string[] = [];
    for (let w = first; w <= last; w = addDays(w, 7)) out.push(w);
    return out;
  }, [month]);

  const upcoming = useMemo(
    () => absences.filter((a) => a.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn)),
    [absences, today],
  );

  // Only the person who made an absence can change it (root included: they can view, not edit).
  const canEdit = (a: Absence) => a.memberId === userId;

  function openDay(date: string) {
    setSelectedDay(date);
    dayDialogRef.current?.showModal();
  }
  function openSession(id: string, rehearsal: boolean) {
    dayDialogRef.current?.close();
    setOpened({ id, rehearsal, detail: null, loading: true });
    sessionDialogRef.current?.showModal();
    getSessionDetail(id)
      .then((detail) => setOpened((o) => (o?.id === id ? { ...o, detail, loading: false } : o)))
      .catch(() => setOpened((o) => (o?.id === id ? { ...o, loading: false } : o)));
  }
  function openCreate(date = today) {
    dayDialogRef.current?.close();
    setEditing(null);
    setDraftStart(date < today ? today : date);
    setDraftKey((k) => k + 1);
    dialogRef.current?.showModal();
  }
  function openAbsence(a: Absence) {
    dayDialogRef.current?.close();
    setEditing(a);
    setDraftKey((k) => k + 1);
    dialogRef.current?.showModal();
  }

  const monthLabel = formatDate(month, { month: "long", year: "numeric" });

  // Phones: swipe the calendar sideways to change month (left = next, right = previous).
  // Mostly-horizontal swipes only, so vertical scrolling and taps behave as before.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  function onTouchStart(e: TouchEvent) {
    swiped.current = false;
    swipe.current = e.touches.length === 1 && window.matchMedia("(max-width: 767px)").matches ? { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY } : null;
  }
  function onTouchEnd(e: TouchEvent) {
    const start = swipe.current;
    swipe.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const step = dx < 0 ? 1 : -1;
    swiped.current = true;
    setTimeout(() => (swiped.current = false), 400);
    setMonth((m) => shiftMonth(m, step));
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      weeksRef.current?.animate(
        [
          { transform: `translateX(${step * 25}%)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 200, easing: "ease-out" },
      );
    }
  }

  return (
    <div className="grid gap-4 pb-20 md:pb-0 lg:h-[calc(100dvh-8.5rem)] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Calendar */}
      <section aria-label="Calendar" className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="mr-auto text-lg font-semibold">{monthLabel}</h2>
          <button
            type="button"
            onClick={() => setMonth(monthStart(today))}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent/50"
          >
            Today
          </button>
          <button type="button" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="rounded-lg p-2 hover:bg-background">
            <Arrow dir="left" />
          </button>
          <button type="button" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="rounded-lg p-2 hover:bg-background">
            <Arrow dir="right" />
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-border text-center text-xs font-medium uppercase tracking-wider text-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} className={`py-2 ${d === "Sun" ? "bg-accent/[0.06] text-accent" : ""}`}>
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>

        <div
          ref={weeksRef}
          className="flex min-h-0 flex-1 flex-col"
          onTouchStart={onTouchStart}
          onTouchMove={(e) => {
            if (e.touches.length > 1) swipe.current = null;
          }}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => (swipe.current = null)}
          // A swipe that ends over a day shouldn't also open it.
          onClickCapture={(e) => {
            if (swiped.current) {
              swiped.current = false;
              e.stopPropagation();
              e.preventDefault();
            }
          }}
        >
          {weeks.map((w) => {
            const { segments, hidden } = layoutWeek(w, absences, maxLanes);
            return (
              // Fixed height (basis-0 on desktop): rows never grow to fit more bars.
              <div
                key={w}
                className="grid h-24 shrink-0 grid-cols-7 overflow-hidden border-b border-border last:border-b-0 lg:h-auto lg:min-h-0 lg:flex-1 lg:basis-0"
                style={{
                  gridTemplateRows: `${DAY_HEADER}px ${showEvents ? `${EVENTS}px ` : ""}repeat(${maxLanes}, ${LANE}px) minmax(0, 1fr)`,
                }}
              >
                {Array.from({ length: 7 }, (_, i) => {
                  const date = addDays(w, i);
                  const inMonth = date.slice(0, 7) === month.slice(0, 7);
                  const isToday = date === today;
                  const isCover = coverDates.includes(date);
                  const isPicked = focus.selected.includes(date);
                  const mark = isCover
                    ? "bg-orange-100 ring-2 ring-inset ring-orange-400"
                    : isPicked
                      ? "bg-sky-100 ring-2 ring-inset ring-sky-400"
                      : focus.options.includes(date)
                        ? "bg-sky-50"
                        : "";
                  const flash = isCover || isPicked ? "animate-[day-flash_0.7s_ease-in-out_3]" : "";
                  return (
                    <button
                      key={isCover || isPicked ? `${date}-${flashKey}` : date}
                      type="button"
                      onClick={() => openDay(date)}
                      aria-label={`Absences on ${formatDate(date, { weekday: "long", day: "numeric", month: "long" })}`}
                      style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
                      className={`flex min-h-0 flex-col items-center overflow-hidden pt-1 text-xs hover:bg-background/70 ${i < 6 ? "border-r border-border" : ""} ${
                        mark || (i === 6 ? "bg-accent/[0.06]" : "")
                      } ${inMonth ? "" : "bg-background/60 text-muted/70"} ${flash}`}
                    >
                      <span
                        className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 ${
                          isToday ? "bg-accent font-semibold text-accent-foreground" : ""
                        }`}
                      >
                        {dayNumber(date)}
                      </span>
                      {hidden[i]! > 0 && (
                        <span aria-hidden className="mt-auto text-sm font-bold leading-3 tracking-widest text-muted">
                          …
                        </span>
                      )}
                    </button>
                  );
                })}
                {showEvents &&
                  Array.from({ length: 7 }, (_, i) => {
                    const day = addDays(w, i);
                    const chips = showServices
                      ? serviceChips(servicesByDate.get(day) ?? [])
                      : (mineByDate.get(day) ?? []).map((m) => ({
                          label: `${m.kind === "rehearsal" ? rehearsalLabel([m]) : [ministryOf(m.kind), m.kind.endsWith("_pnp") ? "PnP" : "Svc"].filter(Boolean).join(" ")} · ${ROLE_SHORT[m.role] ?? m.role}`,
                          dot: serviceDot(m.kind),
                        }));
                    if (!chips.length) return null;
                    // Clicks pass through to the day box, which lists every service that day.
                    return (
                      <div
                        key={`svc-${i}`}
                        style={{ gridColumn: i + 1, gridRow: 2 }}
                        className="pointer-events-none z-10 flex min-w-0 items-center gap-1.5 overflow-hidden px-1"
                      >
                        {chips.map((c) => (
                          <span key={c.label} className="flex min-w-0 items-center gap-1 text-[9px] font-medium leading-[14px] text-foreground sm:text-[10px]">
                            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />
                            <span className="truncate">{c.label}</span>
                          </span>
                        ))}
                      </div>
                    );
                  })}
                {segments.map((g) => {
                  const c = colourFor(g.absence.memberId);
                  return (
                    <button
                      key={g.absence.id}
                      type="button"
                      onClick={() => openAbsence(g.absence)}
                      title={`${g.absence.memberName}: ${g.absence.reason} (${describeDates(g.absence)})`}
                      style={{ gridColumn: `${g.col + 1} / span ${g.span}`, gridRow: g.lane + (showEvents ? 3 : 2) }}
                      className={`relative z-10 my-px truncate px-1 text-left text-[9px] font-medium leading-[14px] transition hover:brightness-95 sm:text-[10px] ${c.bar} ${
                        g.startsHere ? "ml-1 rounded-l border-l-2" : ""
                      } ${g.endsHere ? "mr-1 rounded-r" : ""}`}
                    >
                      {g.absence.memberName.split(" ")[0]}
                      <span className="hidden opacity-80 sm:inline"> · {g.absence.reason}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      {/* Upcoming absences */}
      <div className="flex min-h-0 flex-col gap-3">
        {cover && (
          <CoverPanel
            cover={cover}
            onFocus={(options, selected) => {
              setFocus({ options, selected });
              setFlashKey((k) => k + 1);
              setMonth(monthStart(selected[0] ?? cover.session.date));
            }}
          />
        )}
        <section aria-label="Upcoming absences" className="flex max-h-[28rem] min-h-0 flex-1 flex-col rounded-xl border border-border bg-surface lg:max-h-none">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-lg font-semibold">Absences</h2>
            {isRoot && (
              <div role="group" aria-label="Whose absences to show" className="flex rounded-lg border border-border p-0.5 text-xs font-medium">
                {[
                  { value: true, label: "Everyone" },
                  { value: false, label: "Only mine" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    aria-pressed={showEveryone === o.value}
                    onClick={() => setShowEveryone(o.value)}
                    className="rounded-md px-2.5 py-1 text-muted aria-pressed:bg-ink aria-pressed:text-ink-foreground"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {upcoming.length ? (
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {upcoming.map((a) => {
                // Just who and when; the reason is on the card that opens when clicked.
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => openAbsence(a)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-background">
                      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${colourFor(a.memberId).dot}`} />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-medium">{a.memberName}</span>
                        <span className="text-muted"> – {shortDates(a)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="text-center text-sm text-muted">No absences</p>
            </div>
          )}
        </section>
        {/* Desktop: full width under the box. Mobile: a round floating button, bottom right. */}
        <button
          type="button"
          onClick={() => openCreate()}
          aria-label="Create absence"
          className="fixed bottom-5 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-ink-foreground shadow-lg hover:bg-ink/90 md:static md:h-10 md:w-full md:rounded-lg md:shadow-none"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden className="md:hidden">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="hidden text-sm font-medium md:inline">+ Create absence</span>
        </button>
      </div>

      <dialog
        ref={dayDialogRef}
        aria-labelledby="day-title"
        onClick={(e) => {
          if (e.target === dayDialogRef.current) dayDialogRef.current?.close(); // backdrop
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        {selectedDay && (
          <DayList
            date={selectedDay}
            services={showServices ? (servicesByDate.get(selectedDay) ?? []) : undefined}
            mine={showServices ? [] : (mineByDate.get(selectedDay) ?? [])}
            absences={onDay(absences, selectedDay)}
            userId={userId}
            canCreate={selectedDay >= today}
            onPick={openAbsence}
            onCreate={() => openCreate(selectedDay)}
            onClose={() => dayDialogRef.current?.close()}
            onOpenSession={openSession}
          />
        )}
      </dialog>

      <dialog
        ref={sessionDialogRef}
        aria-labelledby="session-title"
        onClose={() => setOpened(null)}
        onClick={(e) => {
          if (e.target === sessionDialogRef.current) sessionDialogRef.current?.close(); // backdrop: back to the calendar
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-0 text-foreground shadow-2xl backdrop:bg-ink/40"
      >
        {opened && <SessionPanel opened={opened} onClose={() => sessionDialogRef.current?.close()} />}
      </dialog>

      <dialog
        ref={dialogRef}
        aria-labelledby="absence-title"
        onClose={() => setEditing(null)}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <AbsenceForm
          key={draftKey}
          absence={editing}
          defaultStart={draftStart}
          today={today}
          readOnly={editing ? !canEdit(editing) : false}
          onDone={() => dialogRef.current?.close()}
        />
      </dialog>
    </div>
  );
}

/** A session from the calendar: when (and its rehearsal), then the same card as the home page. */
function SessionPanel({
  opened,
  onClose,
}: {
  opened: { rehearsal: boolean; detail: SessionDetail | null; loading: boolean };
  onClose: () => void;
}) {
  const d = opened.detail;
  const at = (t: string | null) => (t ? ` at ${formatTime(t)}` : "");
  const long = (date: string) => formatDate(date, { weekday: "long", day: "numeric", month: "long" });
  const short = (date: string) => formatDate(date, { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="flex max-h-[85dvh] flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="session-title" className="text-lg font-semibold">
            {d ? (opened.rehearsal ? `Rehearsal: ${d.name}` : d.name) : "Session"}
          </h2>
          {d && (
            <p className="text-sm text-muted">
              {opened.rehearsal && d.rehearsal
                ? `${long(d.rehearsal)}${at(rehearsalTime(d))} · for ${short(d.date)}${at(sessionTime(d))}`
                : `${long(d.date)}${at(sessionTime(d))}${d.rehearsal ? ` · Rehearsal ${short(d.rehearsal)}${at(rehearsalTime(d))}` : ""}`}
            </p>
          )}
        </div>
        <button type="button" aria-label="Back to the calendar" onClick={onClose} className="-mr-2 rounded-full p-2 text-muted hover:bg-background">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {opened.loading ? (
          <p className="text-sm text-muted">Loading the session…</p>
        ) : d ? (
          <SessionCard s={d} />
        ) : (
          <p className="text-sm text-muted">This session isn&apos;t available any more.</p>
        )}
      </div>
    </div>
  );
}

function DayList({
  date,
  services,
  mine,
  absences,
  userId,
  canCreate,
  onPick,
  onCreate,
  onClose,
  onOpenSession,
}: {
  date: string;
  /** That day's services, or undefined to leave the section out. */
  services?: ServiceEvent[];
  /** The viewer's own sessions that day. */
  mine: MySession[];
  absences: Absence[];
  userId: string;
  canCreate: boolean;
  onPick: (a: Absence) => void;
  onCreate: () => void;
  onClose: () => void;
  /** Open a session's panel ("<id>:rehearsal" for a rehearsal). */
  onOpenSession: (id: string, rehearsal: boolean) => void;
}) {
  return (
    <div className="flex max-h-[80dvh] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <h2 id="day-title" className="text-lg font-semibold">
          {formatDate(date, { weekday: "long", day: "numeric", month: "long" })}
        </h2>
        <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 rounded-full p-2 text-muted hover:bg-background">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
      {mine.length > 0 && (
        <>
          <h3 className="bg-background px-5 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">You&apos;re serving</h3>
          <ul className="divide-y divide-border">
            {mine.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenSession(s.id, s.kind === "rehearsal")}
                  className="flex w-full items-baseline gap-2.5 px-5 py-1.5 text-left text-xs hover:bg-background"
                >
                  <span aria-hidden className={`h-2 w-2 shrink-0 translate-y-px rounded-full ${serviceDot(s.kind)}`} />
                  <span className="min-w-0 flex-1">
                    {s.kind === "rehearsal" ? rehearsalLabel([s]) : s.name} · {ROLE_SHORT[s.role] ?? s.role}
                    <RehearsalFor s={s.forSession} />
                  </span>
                  <span aria-hidden className="text-muted">›</span>
                </button>
              </li>
            ))}
          </ul>
          <h3 className="bg-background px-5 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">Absences</h3>
        </>
      )}
      {services && (
        <>
          <h3 className="bg-background px-5 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">Services</h3>
          {services.length ? (
            <ul className="divide-y divide-border">
              {services.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onOpenSession(s.id, s.kind === "rehearsal")}
                    className="flex w-full items-baseline gap-2.5 px-5 py-1.5 text-left text-xs hover:bg-background"
                  >
                    <span aria-hidden className={`h-2 w-2 shrink-0 translate-y-px rounded-full ${serviceDot(s.kind)}`} />
                    <span className="min-w-0 flex-1">
                      {s.kind === "rehearsal" ? rehearsalLabel([s]) : s.name}
                      <RehearsalFor s={s.forSession} />
                    </span>
                    <span aria-hidden className="text-muted">›</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-3 text-sm text-muted">No services</p>
          )}
          <h3 className="bg-background px-5 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">Absences</h3>
        </>
      )}
      {absences.length ? (
        <ul className="divide-y divide-border">
          {absences.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-2.5 px-5 py-1.5 text-left text-xs hover:bg-background">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${colourFor(a.memberId).dot}`} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{a.memberName}</span>
                  {a.memberId === userId && <span className="text-muted"> (you)</span>}
                  <span className="text-muted"> · {a.reason}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`px-5 text-sm text-muted ${services ? "py-3" : "py-8 text-center"}`}>No absences</p>
      )}
      </div>
      {canCreate && (
        <div className="border-t border-border p-4">
          <button type="button" onClick={onCreate} className="h-10 w-full rounded-lg bg-ink text-sm font-medium text-ink-foreground hover:bg-ink/90">
            + Create absence on this day
          </button>
        </div>
      )}
    </div>
  );
}

function AbsenceForm({
  absence,
  defaultStart,
  today,
  readOnly,
  onDone,
}: {
  absence: Absence | null;
  defaultStart: string;
  today: string;
  readOnly: boolean;
  onDone: () => void;
}) {
  const [start, setStart] = useState(absence?.startsOn ?? defaultStart);
  const [end, setEnd] = useState(absence?.endsOn ?? defaultStart);
  const [singleDay, setSingleDay] = useState(absence ? absence.startsOn === absence.endsOn : true);
  const [reason, setReason] = useState(absence?.reason === "Absence" ? "" : (absence?.reason ?? ""));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [covering, setCovering] = useState<{ input: AbsenceInput; clashes: AbsenceClash[] } | null>(null);
  const [pending, start_] = useTransition();

  if (absence && readOnly) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <span aria-hidden className={`h-3 w-3 rounded-full ${colourFor(absence.memberId).dot}`} />
          <h2 id="absence-title" className="text-lg font-semibold">
            {absence.memberName}
          </h2>
        </div>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">When</dt>
            <dd>{describeDates(absence)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Reason</dt>
            <dd>{absence.reason}</dd>
          </div>
        </dl>
        <div className="flex justify-end">
          <button type="button" onClick={onDone} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">
            Close
          </button>
        </div>
      </div>
    );
  }

  const save = () =>
    start_(async () => {
      setError(null);
      const input = { id: absence?.id, startsOn: start, endsOn: singleDay ? start : end, reason };
      const r = await saveAbsence(input);
      if (r.ok) onDone();
      // It falls on sessions they've confirmed: find cover for those first, or it isn't added.
      else if (r.clashes?.length) setCovering({ input, clashes: r.clashes });
      else setError(r.message);
    });
  const remove = () =>
    start_(async () => {
      setError(null);
      const r = await deleteAbsence(absence!.id);
      if (r.ok) onDone();
      else setError(r.message);
    });

  const inputClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <>
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-4 p-6"
    >
      <h2 id="absence-title" className="text-lg font-semibold">
        {absence ? "Edit absence" : "Create absence"}
      </h2>

      <div className={`grid gap-3 ${singleDay ? "" : "sm:grid-cols-2"}`}>
        <label className="block space-y-1">
          <span className="text-sm font-medium">
            {singleDay ? "Date" : "Start date"} <span className="text-xs font-normal text-muted">mm/dd/yyyy</span>
          </span>
          <input
            type="date"
            required
            value={start}
            min={absence ? undefined : today}
            onChange={(e) => {
              setStart(e.target.value);
              if (end < e.target.value) setEnd(e.target.value);
            }}
            className={inputClass}
          />
        </label>
        {!singleDay && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              End date <span className="text-xs font-normal text-muted">mm/dd/yyyy</span>
            </span>
            <input type="date" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
          </label>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={singleDay}
          onChange={(e) => {
            setSingleDay(e.target.checked);
            if (!e.target.checked && end < start) setEnd(start);
          }}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Single day
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          Reason <span className="font-normal text-muted">(optional)</span>
        </span>
        <input
          value={reason}
          maxLength={80}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Absence"
          className={inputClass}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {absence &&
          (confirmDelete ? (
            <span className="flex items-center gap-2 text-sm">
              Delete this absence?
              <button type="button" disabled={pending} onClick={remove} className="rounded-lg bg-danger px-3 py-1.5 font-medium text-white disabled:opacity-50">
                {pending ? "Deleting…" : "Delete"}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-muted">
                Keep
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-medium text-danger hover:underline">
              Delete
            </button>
          ))}
        <span className="ml-auto flex items-center gap-3">
          <button type="button" onClick={onDone} className="text-sm text-muted">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60">
            {pending && !confirmDelete ? "Saving…" : "Save"}
          </button>
        </span>
      </div>
    </form>
    {covering && (
      <AbsenceCoverDialog
        absence={covering.input}
        clashes={covering.clashes}
        onCancel={() => {
          setCovering(null);
          setError(
            covering.clashes.length === 1
              ? "Not saved. You're serving that day, so find someone to cover it to add this absence."
              : "Not saved. You're serving on days in this absence, so find someone to cover them to add it.",
          );
        }}
        onSaved={() => {
          setCovering(null);
          onDone();
        }}
      />
    )}
    </>
  );
}

export function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}
