# Layout measurements

Recorded for the project owner on 11 Nov 2026. **Don't change these as a side effect of other
work.** If a change needs a different width or size, ask the owner first, or at least say clearly
in your summary which measurement changed, where and why.

Widths are in CSS pixels at normal (100%) browser zoom. "From 640px up" means windows at least
640px wide (Tailwind's `sm:`); below that is the phone layout.

| What | Measurement | Classes | Set in |
|---|---|---|---|
| Page content area (every signed-in page) | Max **992px** wide, centred. Side padding **16px** on phones, **24px** from 640px up. **24px** top and bottom. **Exception:** the roster editor (`/roster/[id]/generated`, marked `data-wide-page`) is wider: max **(window width + 992px) ÷ 2**, so its edges sit halfway between the nav's edges and the window's edges (e.g. 1216px in a 1440px window) | `mx-auto w-full max-w-page px-4 py-6 sm:px-6 has-[[data-wide-page]]:max-w-[calc(50vw+31rem)]` | `web/src/app/(app)/layout.tsx` |
| Nav bar | Dark background spans the full window. Contents max **992px**, centred, **56px** tall, **16px / 24px** side padding, **8px** between items | `h-14 max-w-page gap-2 px-4 sm:px-6` | `web/src/components/app-nav.tsx` |
| Nav bar while loading | Same as the nav bar: 56px tall, max 992px | `h-14 max-w-page px-4 sm:px-6` | `web/src/components/app-nav.tsx` |
| Mobile sidebar | **288px** wide, never more than **85%** of the screen | `w-72 max-w-[85vw]` | `web/src/components/app-nav.tsx` |
| Roster landing page | Fills the screen height minus **136px**; **16px** between sections | `min-h-[calc(100dvh-8.5rem)] gap-4` | `web/src/app/(app)/roster/page.tsx` |
| Roster landing: quarter cards row | From 640px up: max **768px** when next quarter's card shows, otherwise max **576px** | `sm:max-w-3xl` / `sm:max-w-xl` | `web/src/app/(app)/roster/page.tsx` |
| Roster landing: this quarter's card | Max **576px** wide from 640px up; **16px** side / **12px** top-bottom padding | `sm:max-w-xl px-4 py-3` | `web/src/app/(app)/roster/page.tsx` |
| Roster landing: next quarter's card | **224px** wide from 640px up | `sm:w-56` | `web/src/app/(app)/roster/page.tsx` |
| Song bank toolbar | **Always one row from 768px up**: search, Filters, !, Missing, Drive sync, Updates, + (search on its own row on phones) | `flex flex-wrap items-center gap-2 md:flex-nowrap` | `web/src/components/songs/song-gallery.tsx` |
| Song bank search | Fills the space left on the row, never under **160px** from 768px; on phones shares the first row with the Filters button | `relative min-w-0 flex-1 md:min-w-40` | `web/src/components/songs/song-gallery.tsx` |
| Song bank filter button | **144px** wide from 768px; icon and arrow only on phones | `shrink-0 md:w-36` | `web/src/components/songs/song-gallery.tsx` |
| Song bank needs review | **40px** square showing just **!**; count in the tooltip; hidden on phones | `hidden h-10 w-10 shrink-0 … md:grid` | `web/src/components/songs/song-gallery.tsx` |
| Song bank Missing / right-hand buttons | Never wrap or shrink; Drive sync, Updates and + pinned right | `shrink-0 whitespace-nowrap`, `ml-auto flex shrink-0` | `web/src/components/songs/song-gallery.tsx` |
| Song bank "Synced … ago" text | Only from **1024px** up, so the row fits | `hidden … lg:inline` | `web/src/components/songs/drive-sync-button.tsx` |
| Song bank cards | Same as Team: **4** per row from 1280px, 3 from 1024px, 2 from 420px, 1 below | `grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` | `song-gallery.tsx`, `web/src/app/(app)/songs/page.tsx` |

`max-w-page` is defined once in `web/src/app/globals.css` (`--container-page: 62rem`, i.e. 992px),
so the nav bar and the page always line up: the left edge of "Brighton Worship" sits over the page's
left edge, and the account icon's right edge over the page's right edge.

These depend on the root font size staying at the browser default (16px): nothing in
`web/src/app/globals.css` sets `html { font-size }` or `zoom`.

## Past decisions

- 11 Nov 2026: the owner asked to halve the space between the Develop menu and the account icon.
  At the old 1280px width that space was 574px (with the root/developer menu: Roster, Team,
  Sessions, Songs, Develop), so the width came down by 287px to 992px, and the page content
  area followed so it stays aligned with the nav. Pages with their own narrower width
  (`max-w-2xl`, `max-w-3xl`) were not changed.
- 11 Nov 2026: song bank cards changed from 5 per row to the Team page's grid (4 per row). The
  toolbar was made one row: narrower filter (208 → 144px), "Needs review" became a "!" button,
  and the owner asked to be told before any edit that would break the one-row toolbar.
- 11 Nov 2026: the owner asked for the roster editor to be wider than the nav on desktop so every
  roster column shows at once. Only that page is wider: first the whole window, then (same day)
  narrowed so its edges sit halfway between the nav's edges and the window's: max
  (window + 992px) ÷ 2, with the usual 24px side padding. The nav and every other page stay at 992px.

How every page is laid out (not just these measurements) is in [PAGE-LAYOUTS.md](PAGE-LAYOUTS.md).

## Being told when they change

- `web/scripts/layout-baseline.json` holds the exact class strings above.
- **Before** Claude Code edits one of these files, a hook (`.claude/settings.json`) runs
  `web/scripts/check-layout.mjs --pre`. If the edit would change a measurement, Claude Code stops
  and asks you, saying what would change; nothing is written unless you allow it.
- **After** an edit, `check-layout.mjs --hook` runs too: if a measurement changed anyway, you see
  a "Layout measurement changed" message, and Claude is told to undo it unless you asked.
- Edits made outside Claude Code (or by shell commands) aren't caught by the hooks.
- To check by hand at any time (also catches edits made outside Claude Code):

  ```
  node web/scripts/check-layout.mjs
  ```

- If you do want a new measurement, update this table and `layout-baseline.json` together.
