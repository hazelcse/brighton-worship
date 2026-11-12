"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createMember } from "@/app/(app)/team/actions";
import { MemberForm } from "@/components/team/member-form";
import { useCloseOnLeave } from "@/lib/use-close-on-leave";

type Member = {
  id: string;
  uid: number | null;
  name: string;
  email: string;
  instruments: string[];
  emPercent: number | null;
  gender: "male" | "female" | null;
  serves: "both" | "sunday" | "pnp";
  isRoot: boolean;
  isActive: boolean;
  groups: string[];
};

const INSTRUMENTS = [
  ["keys", "Keys"], ["synth/pads", "Synth/Pads"], ["electric guitar", "Electric Guitar"],
  ["acoustic guitar", "Acoustic Guitar"], ["bass", "Bass"], ["drums", "Drums"],
  ["worship leader", "Worship Leader"], ["vocalist", "Vocalist"], ["band leader", "BL/TB"],
] as const;
const LABEL: Record<string, string> = Object.fromEntries(INSTRUMENTS);
const MINISTRIES = [["EM", "EM"], ["CM", "CM"]] as const;

/** Which ministries a member serves: EM/CM members serve both. */
function serves(em: number | null): string[] {
  if (em === null) return [];
  return [...(em > 0 ? ["EM"] : []), ...(em < 100 ? ["CM"] : [])];
}

function ministry(em: number | null): string | null {
  if (em === null) return null;
  return em >= 100 ? "EM" : em <= 0 ? "CM" : "EM/CM";
}
const MINISTRY_STYLE: Record<string, string> = {
  EM: "bg-sky-100 text-sky-800",
  CM: "bg-rose-100 text-rose-800",
  "EM/CM": "bg-violet-100 text-violet-800",
};

/** Dropdown with tick boxes; nothing ticked = no filter. */
function MultiSelect({
  options,
  selected,
  onChange,
  allLabel,
  pluralNoun,
  groupLabel,
  combinedLabel,
  className = "",
}: {
  options: readonly (readonly [string, string])[];
  selected: string[];
  onChange: (v: string[]) => void;
  allLabel: string;
  pluralNoun: string;
  groupLabel: string;
  combinedLabel?: string; // shown when every option is ticked
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const names = Object.fromEntries(options);
  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? names[selected[0]]
        : combinedLabel && selected.length === options.length
          ? combinedLabel
          : `${selected.length} ${pluralNoun}`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-2 rounded-lg border bg-surface px-3 text-sm ${
          selected.length ? "border-accent text-accent" : "border-border"
        }`}
      >
        {label}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="group"
          aria-label={groupLabel}
          className="absolute left-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          {options.map(([value, name]) => {
            const on = selected.includes(value);
            return (
              <label key={value} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-background">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(on ? selected.filter((s) => s !== value) : [...selected, value])}
                  className="accent-accent"
                />
                {name}
              </label>
            );
          })}
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full border-t border-border px-3 py-2 text-left text-sm text-muted hover:bg-background">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Phones only: the instrument and ministry filters as one dropdown, tick boxes grouped under
 * Instrument and Ministry (nothing ticked in a group = no filter, like the desktop dropdowns).
 */
function MobileFilter({
  instruments,
  setInstruments,
  ministries,
  setMinistries,
}: {
  instruments: string[];
  setInstruments: (v: string[]) => void;
  ministries: string[];
  setMinistries: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const picked = instruments.length + ministries.length;
  const group = (label: string, options: readonly (readonly [string, string])[], selected: string[], set: (v: string[]) => void) => (
    <fieldset>
      <legend className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">{label}</legend>
      {options.map(([value, name]) => {
        const on = selected.includes(value);
        return (
          <label key={value} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-background">
            <input
              type="checkbox"
              checked={on}
              onChange={() => set(on ? selected.filter((x) => x !== value) : [...selected, value])}
              className="accent-accent"
            />
            {name}
          </label>
        );
      })}
    </fieldset>
  );
  return (
    <div ref={ref} className="relative shrink-0 sm:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-label={picked ? `Filters: ${picked} picked` : "Filters: everyone"}
        onClick={() => setOpen((o) => !o)}
        // Looks like the shared FilterMenu button.
        className={`flex h-10 items-center gap-2 rounded-lg border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
          picked ? "border-accent text-accent" : "border-border"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        Filter
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-2 max-h-[70vh] w-60 overflow-y-auto rounded-xl border border-border bg-surface pb-1 shadow-lg">
          {group("Instrument", INSTRUMENTS, instruments, setInstruments)}
          {group("Ministry", MINISTRIES, ministries, setMinistries)}
          {picked > 0 && (
            <button
              type="button"
              onClick={() => {
                setInstruments([]);
                setMinistries([]);
              }}
              className="mt-1 w-full border-t border-border px-3 py-2 text-left text-sm text-muted hover:bg-background"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Phones only, root: a black "+" dropdown holding "New user" and "Manage permissions". */
function MobileActions({ onNewUser }: { onNewUser: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const item = "flex w-full items-center px-3 py-2.5 text-left text-sm hover:bg-background";
  return (
    <div ref={ref} className="relative shrink-0 sm:hidden">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add user or manage permissions"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-1.5 rounded-lg bg-ink px-3 text-ink-foreground hover:bg-ink/90"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNewUser();
            }}
            className={item}
          >
            + New user
          </button>
          <Link href="/team/permissions" role="menuitem" onClick={() => setOpen(false)} className={item}>
            Manage permissions
          </Link>
        </div>
      )}
    </div>
  );
}

export function TeamGallery({
  members,
  isRoot,
  groups,
}: {
  members: Member[];
  isRoot: boolean;
  groups: string[];
}) {
  const [query, setQuery] = useState("");
  const [instruments, setInstruments] = useState<string[]>([]);
  const [ministries, setMinistries] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useCloseOnLeave(dialogRef);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter(
        (m) =>
          (!q || m.name.toLowerCase().includes(q)) &&
          (instruments.length === 0 || instruments.some((i) => m.instruments.includes(i))) &&
          // Ticking EM and CM together narrows to people who serve both (EM/CM).
          (ministries.length === 0 || ministries.every((x) => serves(m.emPercent).includes(x))),
      )
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [members, query, instruments, ministries]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Phones: one row of search, Filter dropdown and (root) the "+" actions dropdown; from 640px the two
            filter dropdowns, then search, with root's buttons on the right. */}
        <div className="flex flex-wrap items-center gap-2">
          <MobileFilter instruments={instruments} setInstruments={setInstruments} ministries={ministries} setMinistries={setMinistries} />
          <MultiSelect
            options={INSTRUMENTS}
            selected={instruments}
            onChange={setInstruments}
            allLabel="All instruments"
            pluralNoun="instruments"
            groupLabel="Filter by instrument"
            className="hidden sm:block"
          />
          <MultiSelect
            options={MINISTRIES}
            selected={ministries}
            onChange={setMinistries}
            allLabel="EM & CM"
            pluralNoun="ministries"
            combinedLabel="EM/CM"
            groupLabel="Filter by ministry"
            className="hidden sm:block"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            aria-label="Search members by name"
            className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 max-sm:order-first sm:w-56 sm:flex-none"
          />
          {isRoot && <MobileActions onNewUser={() => dialogRef.current?.showModal()} />}
        </div>
        {isRoot && (
          // From 640px; phones get these from MobileActions.
          <div className="hidden flex-wrap gap-2 sm:flex">
            <button
              type="button"
              onClick={() => dialogRef.current?.showModal()}
              className="h-10 rounded-lg bg-ink px-4 text-sm font-medium text-ink-foreground hover:bg-ink/90"
            >
              + User
            </button>
            <Link
              href="/team/permissions"
              className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50"
            >
              Manage permissions
            </Link>
          </div>
        )}
      </div>

      <p className="text-sm text-muted">
        {filtered.length} of {members.length} members
        {instruments.length > 0 && <> · playing {instruments.map((i) => LABEL[i]).join(" or ")}</>}
        {ministries.length > 0 && <> · serving {ministries.length === 2 ? "both EM and CM" : ministries[0]}</>}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">No members match.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((m) => {
            const min = ministry(m.emPercent);
            return (
              <li key={m.id}>
                <Link
                  href={`/team/${m.id}`}
                  className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate font-medium group-hover:text-accent">{m.name}</h2>
                      <p className="text-xs text-muted">
                        {[
                          m.gender ? (m.gender === "male" ? "Male" : "Female") : null,
                          m.serves === "sunday" ? "Sunday only" : m.serves === "pnp" ? "P&P only" : null,
                          !m.isActive ? "Inactive" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {isRoot && m.email.endsWith("@placeholder.invalid") && (
                          <span className="text-amber-700" title="This member has a placeholder email">
                            {m.gender || !m.isActive || m.serves !== "both" ? " · " : ""}Needs email
                          </span>
                        )}
                      </p>
                    </div>
                    {min && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${MINISTRY_STYLE[min]}`}>{min}</span>}
                  </div>
                  <ul className="flex flex-wrap gap-1.5" aria-label="Instruments">
                    {m.instruments.length === 0 && <li className="text-xs text-muted">No instruments yet</li>}
                    {m.instruments.map((i) => (
                      <li key={i} className={`rounded-full px-2 py-0.5 text-xs ${instruments.includes(i) ? "bg-accent/15 text-accent" : "bg-background text-foreground"}`}>
                        {LABEL[i] ?? i}
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {isRoot && (
        <dialog
          ref={dialogRef}
          aria-labelledby="create-member-title"
          className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
          onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
        >
          <div className="max-h-[85vh] space-y-4 overflow-y-auto p-6">
            <div className="flex items-start justify-between">
              <h2 id="create-member-title" className="font-display text-3xl font-semibold">
                Create user
              </h2>
              <button type="button" aria-label="Close" onClick={() => dialogRef.current?.close()} className="-mr-2 -mt-1 rounded-full p-2 text-muted hover:bg-background">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <MemberForm mode="create" action={createMember} groups={groups} />
          </div>
        </dialog>
      )}
    </div>
  );
}
