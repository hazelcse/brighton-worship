"use client";

import { useEffect, useRef, useState } from "react";

export type FilterGroup = {
  id: string;
  /** e.g. "Language". */
  label: string;
  /** The first option is "all" (value ""). */
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
};

function Chevron({ open, dir = "down" }: { open?: boolean; dir?: "down" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 transition ${dir === "right" ? (open ? "rotate-90" : "") : open ? "rotate-180" : ""}`}
    >
      {dir === "right" ? <path d="m9 6 6 6-6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

/**
 * One "Filters" dropdown holding several filters (e.g. Language and Type), each opening its own
 * list of choices inside it. The button shows what's picked.
 */
export function FilterMenu({
  groups,
  className = "",
  align = "left",
  iconOnlyOnMobile = false,
}: {
  groups: FilterGroup[];
  className?: string;
  align?: "left" | "right";
  /** Below 768px the button shows only its icon and arrow (no "All songs" / picked text). */
  iconOnlyOnMobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<string | null>(null);
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

  const picked = groups.filter((g) => g.value).map((g) => g.options.find((o) => o.value === g.value)?.label ?? g.value);
  const summary = picked.length ? picked.join(" · ") : "All songs";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Filters: ${summary}`}
        onClick={() => {
          setOpen((o) => !o);
          setSection(null);
        }}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
          picked.length ? "border-accent/60" : "border-border"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          <span className={`truncate ${iconOnlyOnMobile ? "hidden md:inline" : ""}`}>{summary}</span>
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-30 mt-1.5 w-60 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg ${
            align === "right" ? "right-0" : iconOnlyOnMobile ? "right-0 md:left-0 md:right-auto" : "left-0"
          }`}
        >
          {groups.map((g) => {
            const expanded = section === g.id;
            const current = g.options.find((o) => o.value === g.value);
            return (
              <div key={g.id}>
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={expanded}
                  onClick={() => setSection(expanded ? null : g.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-background"
                >
                  <span className="font-medium">{g.label}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-muted">
                    <span className="truncate">{current?.label}</span>
                    <Chevron dir="right" open={expanded} />
                  </span>
                </button>
                {expanded && (
                  <div role="menu" aria-label={g.label} className="border-y border-border bg-background/60 py-1">
                    {g.options.map((o) => {
                      const on = o.value === g.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={on}
                          onClick={() => {
                            g.onChange(o.value);
                            setSection(null);
                          }}
                          className={`flex w-full items-center gap-2 py-2 pl-6 pr-3 text-left text-sm hover:bg-background ${on ? "font-medium text-accent" : ""}`}
                        >
                          <span aria-hidden className="w-3">
                            {on ? "✓" : ""}
                          </span>
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {picked.length > 0 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                for (const g of groups) g.onChange("");
                setOpen(false);
              }}
              className="w-full border-t border-border px-3 py-2.5 text-left text-sm text-muted hover:bg-background hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const LANGUAGE_OPTIONS = [
  { value: "", label: "All languages" },
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
];

export const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "praise", label: "Praise" },
  { value: "worship", label: "Worship" },
  { value: "praise_worship", label: "Praise / Worship" },
];
