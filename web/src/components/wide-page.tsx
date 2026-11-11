"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Put this in a page that should be wider than the nav (see LAYOUT.md): the page area in
 * `app/(app)/layout.tsx` widens while it holds a visible `[data-wide-page]` element.
 *
 * Next keeps pages you've left in the document, hidden (cacheComponents), so a plain attribute
 * would keep every later page wide. The attribute is in the server HTML (wide from the first
 * paint), removed when React hides the page (its effects are cleaned up) and added back when
 * it shows again.
 */
export function WidePage() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute("data-wide-page", "");
    return () => el.removeAttribute("data-wide-page");
  }, []);
  return <span ref={ref} data-wide-page="" hidden />;
}
