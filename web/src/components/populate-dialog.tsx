"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importMembersJson, importSessionsFile, populatePastSessions, populateRandomAbsences } from "@/app/actions/dev";

/** The quarter today falls in (1–4) and the current year. */
function thisQuarter() {
  const now = new Date();
  return { quarter: Math.floor(now.getMonth() / 3) + 1, year: now.getFullYear() };
}

type What = "members" | "sessions" | "absences";
const CHOICES: { value: What; label: string }[] = [
  { value: "members", label: "Members" },
  { value: "sessions", label: "Past sessions" },
  { value: "absences", label: "Absences" },
];

const select =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const fileInput =
  "block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-border/40";

function QuarterYear({
  quarter,
  year,
  years,
  onQuarter,
  onYear,
}: {
  quarter: number;
  year: number;
  years: number[];
  onQuarter: (q: number) => void;
  onYear: (y: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block space-y-1 text-sm">
        <span>Quarter</span>
        <select value={quarter} onChange={(e) => onQuarter(Number(e.target.value))} className={select}>
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              Q{q}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>Year</span>
        <select value={year} onChange={(e) => onYear(Number(e.target.value))} className={select}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Developers: fill the app with test data. Members from a JSON file; past sessions made up for a
 * quarter or read from a CSV of the team's records; random absences for a quarter.
 */
export function PopulateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [what, setWhat] = useState<What>("members");
  const [sessionSource, setSessionSource] = useState<"random" | "csv">("random");
  const [quarter, setQuarter] = useState(() => thisQuarter().quarter);
  const [year, setYear] = useState(() => thisQuarter().year);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const baseYear = thisQuarter().year;
  // Past sessions: three years back through this one. Absences: last year through three ahead.
  const years = what === "sessions" ? Array.from({ length: 4 }, (_, i) => baseYear - 3 + i) : Array.from({ length: 5 }, (_, i) => baseYear - 1 + i);
  const needsFile = what === "members" || (what === "sessions" && sessionSource === "csv");

  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);

  const reset = () => {
    setMessage(null);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };
  const close = () => {
    if (pending) return;
    reset();
    onClose();
  };

  const run = () =>
    start(async () => {
      let r: { ok: boolean; message: string | null };
      if (needsFile) {
        if (!file) {
          setMessage({ ok: false, text: what === "members" ? "Choose a JSON file." : "Choose an Excel or CSV file." });
          return;
        }
        if (what === "members") r = await importMembersJson(await file.text());
        else {
          const form = new FormData();
          form.set("file", file);
          r = await importSessionsFile(form);
        }
      } else {
        r = what === "sessions" ? await populatePastSessions(quarter, shownYear) : await populateRandomAbsences(quarter, shownYear);
      }
      setMessage({ ok: r.ok, text: r.message ?? (r.ok ? "Done." : "That didn't go through.") });
      if (r.ok) router.refresh();
    });

  // A year from the other list (e.g. next year, after switching to past sessions) becomes the latest offered.
  const shownYear = years.includes(year) ? year : years.at(-1)!;

  return (
    <dialog ref={ref} onClose={close} aria-labelledby="populate-title" className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl">
      <form
        className="space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <h2 id="populate-title" className="font-display text-2xl font-semibold">
          Populate
        </h2>

        <div role="radiogroup" aria-label="What to populate" className="grid grid-cols-3 gap-1 rounded-lg bg-background p-1">
          {CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={what === c.value}
              disabled={pending}
              onClick={() => {
                setWhat(c.value);
                reset();
              }}
              className={`rounded-md px-2 py-1.5 text-sm font-medium transition ${what === c.value ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {what === "members" && (
          <>
            <p className="text-sm text-muted">
              Adds the team members in a JSON file. Anyone whose email or name is already in the team is skipped. Members with a password in the file sign in with it; the rest get the
              default password.
            </p>
            <input ref={fileRef} type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={fileInput} />
          </>
        )}

        {what === "sessions" && (
          <>
            <div className="flex gap-4 text-sm">
              {(
                [
                  ["random", "Generate random"],
                  ["csv", "Import Excel / CSV"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="session-source"
                    checked={sessionSource === v}
                    onChange={() => {
                      setSessionSource(v);
                      reset();
                    }}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  {label}
                </label>
              ))}
            </div>
            {sessionSource === "random" ? (
              <>
                <p className="text-sm text-muted">
                  Adds the quarter&apos;s sessions up to today to Tracking: EM and CM Sunday services and Prayer &amp; Praise on the usual schedule, plus 1–2 ad-hoc events with 2–5
                  songs. Bands are random members who play each role; songs are random from the song library.
                </p>
                <QuarterYear quarter={quarter} year={shownYear} years={years} onQuarter={setQuarter} onYear={setYear} />
              </>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Adds the sessions in the records spreadsheet: the Excel workbook (.xlsx, its Database sheet) or that sheet saved as CSV. Columns: Date, Worship Leader, Singer, Drummer, Electric Guitarist, Acoustic
                  Guitarist, Bassist, Keyboardist, Synth Player, then WL, Artist, Song and Key for songs 1–5, Link 1, Link 2. Sessions already in Tracking and dates
                  after today are skipped.
                </p>
                <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={fileInput} />
              </>
            )}
          </>
        )}

        {what === "absences" && (
          <>
            <p className="text-sm text-muted">Gives every active team member 1–5 absences in the quarter: single days and leave of 4–14 days.</p>
            <QuarterYear quarter={quarter} year={shownYear} years={years} onQuarter={setQuarter} onYear={setYear} />
          </>
        )}

        {message && (
          <p role="alert" className={`text-sm ${message.ok ? "text-emerald-700" : "text-danger"}`}>
            {message.text}
          </p>
        )}
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <button
            type="submit"
            disabled={pending || (needsFile && !file)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            {pending ? "Working…" : needsFile ? "Import" : "Populate"}
          </button>
          <button type="button" onClick={close} disabled={pending} className="text-sm text-muted">
            {message?.ok ? "Close" : "Cancel"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
