"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { markUpdatesSeen } from "@/app/(app)/roster/serving-actions";
import { UpdatesBoard } from "@/components/roster/updates-board";
import type { UpdateItem } from "@/lib/serving";

/** Fired (e.g. by the landing page's "See updates") to open the nav's inbox. */
export const OPEN_INBOX_EVENT = "open-inbox";

function InboxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

/**
 * The inbox left of the account icon: roster updates (what used to be the Roster page's Updates box)
 * in a popup, with a count of unread ones. Opening it marks them all read.
 */
export function Inbox({ updates }: { updates: UpdateItem[] }) {
  const [open, setOpen] = useState(false);
  // When the inbox was last opened here: updates arriving later (the page refreshes) count again.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const unread = updates.filter((u) => u.isNew && (!openedAt || u.createdAt > openedAt)).length;

  const show = () => {
    setOpen(true);
    if (unread > 0 || !openedAt) {
      setOpenedAt(new Date().toISOString());
      void markUpdatesSeen();
    }
  };

  useEffect(() => {
    const onOpen = () => show();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener(OPEN_INBOX_EVENT, onOpen);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener(OPEN_INBOX_EVENT, onOpen);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-foreground/80 transition hover:bg-white/10 hover:text-ink-foreground aria-expanded:bg-white/10 aria-expanded:text-ink-foreground"
      >
        <InboxIcon />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Inbox"
          className="fixed inset-x-4 top-14 z-40 mt-2 flex max-h-[min(32rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-96"
        >
          <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">Inbox</h2>
            <span className="text-xs text-muted">{updates.length ? `${updates.length} update${updates.length === 1 ? "" : "s"}` : ""}</span>
          </div>
          <UpdatesBoard updates={updates} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** A link-style button that opens the inbox (for notices pointing at a roster update). */
export function OpenInboxButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_INBOX_EVENT))}>
      {children}
    </button>
  );
}
