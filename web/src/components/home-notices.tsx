"use client";

import { useEffect, useState } from "react";
import { markHomeBandSeen } from "@/app/(app)/home/actions";

/** One line in the landing page's notices box. `once`: shown on one visit only (band changes), at its time. */
export type HomeNotice = { key: string; text: React.ReactNode; action: React.ReactNode; once?: string };

/**
 * The landing page's notices (plans to publish, plans published, sessions to confirm, band changes),
 * together in one box. Band changes are marked seen as soon as they're shown, but stay on screen
 * until the person leaves the page (the page refreshes itself every 30 seconds).
 */
export function HomeNotices({ items }: { items: HomeNotice[] }) {
  const [held, setHeld] = useState<HomeNotice[]>(() => items.filter((n) => n.once));
  // New band changes arriving with a refresh join the ones already showing.
  const incoming = items.filter((n) => n.once && !held.some((h) => h.key === n.key));
  if (incoming.length) setHeld([...held, ...incoming]);

  const newest = held.reduce<string | null>((max, n) => (n.once && (!max || n.once > max) ? n.once : max), null);
  useEffect(() => {
    if (newest) void markHomeBandSeen(newest);
  }, [newest]);

  const shown = [...items.filter((n) => !n.once), ...held];
  if (!shown.length) return null;
  return (
    <ul aria-label="Notices" className="divide-y divide-accent/20 rounded-xl border border-accent/40 bg-accent/10 text-sm">
      {shown.map((n) => (
        <li key={n.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
          <span className="min-w-0 flex-1">{n.text}</span>
          <span className="shrink-0">{n.action}</span>
        </li>
      ))}
    </ul>
  );
}
