"use client";

import { useEffect, type RefObject } from "react";

/**
 * Close a <dialog> when its page is left.
 *
 * With cacheComponents, Next keeps a page you navigate away from alive (hidden in React's
 * <Activity>) and shows it again as it was when you come back. A modal dialog that was left
 * open, e.g. after following a link inside it, would come back half-open and clipped. Hiding
 * the page runs effect cleanups, so closing the dialog here puts it back to normal.
 */
export function useCloseOnLeave(ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [ref]);
}
