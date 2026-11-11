"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const item = "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-background";

/** Songs page: one "+" button with a menu for adding a new song or a new transposition. */
export function AddMenu({ onNewSong, canTranspose }: { onNewSong?: () => void; canTranspose: boolean }) {
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
      // Leaving the page (e.g. to the transposer) closes the menu too.
      setOpen(false);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add"
        title="Add"
        onClick={() => setOpen((o) => !o)}
        className="grid h-10 w-10 place-items-center rounded-lg bg-ink text-ink-foreground transition hover:bg-ink/90"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
          {onNewSong && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNewSong();
              }}
              className={item}
            >
              + New song
            </button>
          )}
          {canTranspose && (
            <Link href="/songs/transpose" role="menuitem" onClick={() => setOpen(false)} className={item}>
              + New transposition
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
