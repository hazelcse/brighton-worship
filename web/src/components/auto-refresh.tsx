"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** How often an open, visible page picks up other people's changes. */
const EVERY_MS = 30_000;

/** Don't pull the page out from under someone mid-task: a dialog open, or typing / choosing in a field. */
function busy(): boolean {
  if (document.querySelector("dialog[open]")) return true;
  const el = document.activeElement;
  return Boolean(el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable));
}

/**
 * Keeps a page current without a reload: re-fetches its data (not the whole page, so scroll position
 * and open panels stay) when you come back to the tab, and every minute while it's visible.
 * Renders nothing.
 */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || busy()) return;
      last = Date.now();
      router.refresh();
    };
    // Back on the tab or window: refresh, unless it was only just refreshed.
    const onReturn = () => {
      if (Date.now() - last > 5_000) refresh();
    };
    const timer = setInterval(refresh, EVERY_MS);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [router]);
  return null;
}
