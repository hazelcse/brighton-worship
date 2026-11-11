# Page layouts

How every page in the app is laid out, as of 11 Nov 2026. Read this before changing a page's
layout, and keep it up to date when you do. The measurements the owner chose on purpose are
protected in [LAYOUT.md](LAYOUT.md) (and checked by `web/scripts/check-layout.mjs`); don't change
those without asking. Fonts are in [FONTS.md](FONTS.md).

Sizes: Tailwind units are 4px (`p-4` = 16px). `max-w-md` 448px, `xl` 576, `2xl` 672, `3xl` 768,
`4xl` 896. Breakpoints: `sm` 640px, `md` 768, `lg` 1024, `xl` 1280 (window widths).

## The frame every signed-in page sits in

- **Nav bar** (`web/src/components/app-nav.tsx`): `sticky top-0 z-30 bg-ink`, 56px tall. Contents
  `mx-auto flex h-14 max-w-page px-4 sm:px-6`: "Brighton Worship", the menu (from md), and the
  account icon pushed right. Below md: hamburger + 288px slide-in sidebar.
- **Page area** (`web/src/app/(app)/layout.tsx`): `<main className="mx-auto w-full max-w-page
  flex-1 px-4 py-6 sm:px-6">`. `max-w-page` = **992px** (`--container-page: 62rem` in
  `globals.css`), so the usable width is **944px** from 640px up (window − 32px below that). Pages
  line up with the nav: left edge under "Brighton Worship", right edge under the account icon.
- Pages are either **full width** (944px) or set their own **narrower centred column**
  (`mx-auto max-w-2xl` 672px or `max-w-3xl` 768px). Nothing goes wider than the page area; wide
  tables scroll sideways inside their box instead.

## Shared patterns

- **Back link** above the title: `text-sm text-muted hover:text-foreground`, "← Roster".
- **Page titles**: `font-display text-4xl font-semibold` (36px) on detail and admin pages;
  `font-display text-3xl` (30px) on Home, Sessions, Build session, Tracking, Pending and the
  workbench. Songs and Team have **no title**: their toolbar is the header.
- **Header row**: title left, buttons right, `flex flex-wrap items-end justify-between gap-3`.
- **Buttons** are 40px tall (`h-10`): primary `rounded-lg bg-ink px-4 text-sm font-medium`,
  secondary `rounded-lg border border-border bg-surface px-4`, icon-only `h-10 w-10 rounded-lg`
  (+, bin, !). The session workbench uses 36px (`h-9`) buttons.
- **Gallery cards** (Songs, Team): `rounded-xl border border-border bg-surface p-4`, lift on hover
  (`hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md`), in
  `grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`: 4 per row on
  desktop, 3 from 1024px, 2 from 420px, 1 on small phones.
- **Link cards** (Sessions, permission groups): same box, `hover:border-accent/50`, in
  `grid gap-3 sm:grid-cols-2 lg:grid-cols-3`.
- **Section card**: `space-y-3|4 rounded-xl border border-border bg-surface p-4 sm:p-5`, h2
  `text-lg font-semibold`.
- **Bordered list**: `overflow-hidden rounded-xl border bg-surface` → `ul divide-y` → rows
  `px-4 py-3 hover:bg-background`.
- **Empty state**: `rounded-xl border border-dashed border-border p-6|p-10 text-center text-sm
  text-muted`.
- **Dialogs**: `<dialog className="m-auto w-[calc(100%-2rem)] max-w-… rounded-2xl bg-surface p-0
  shadow-2xl">`, inner `max-h-[85vh] overflow-y-auto p-6`, title `font-display text-2xl|3xl`.
- **FilterMenu** (`web/src/components/filter-menu.tsx`): 40px trigger with funnel icon; width set
  by the page (`w-36` on Songs); popover 240px.
- **Roster table** (`roster-filter.tsx`, `roster-results.tsx`): chip filters
  (`h-8 rounded-full`), then `overflow-x-auto rounded-xl border` table, `text-[13px]`, sticky
  header. Scrolls sideways (one column per role).

## Pages

### Outside the app frame

**`/` Login** (`web/src/app/page.tsx`): full-screen dark (`bg-ink`), everything centred. Title
"Brighton / Worship" `font-display`, 60px → 96px (sm) → 128px (lg). Log in button below.

**`/change-password`**: dark full screen, one centred 384px card (`max-w-sm rounded-2xl p-6`),
title `font-display text-3xl`, form, "Log out" link.

### Home

**`/home`**: narrow column **672px** (`mx-auto max-w-2xl space-y-5`). Title "Hi (name),". Then
broadcasts list, the dark countdown card (`rounded-xl bg-ink p-6`), notices (accent-tinted list),
and the next session's card (songs, then band in two columns once the card is wide enough).

### Roster

**`/roster` (landing)**: full width, fills the window height (`min-h-[calc(100dvh-8.5rem)]`,
`gap-4`). Top row: dark "This quarter's roster" card (max 576px) and, when published, a 224px
"Next quarter" card; on the right (editors) "View past rosters" and a dark **+** menu. Below, two
panels sharing the height: **Updates** and **Requests** (root: **Actionables**), each a bordered
box with a scrolling list. Below 640px the top row stacks.

**`/roster/new` (Rosters)**: narrow **672px**. Back link, title "Rosters" + "Past rosters →".
List of roster rows (`rounded-xl border px-4 py-3`); selecting one shows open/delete icon tiles;
a dashed **+** square adds one (dialog with a quarter picker, 2 → 4 columns).

**`/roster/past`**: full width. Title "Past rosters" + intro; one bordered list of rosters with a
status pill on the right.

**`/roster/current`** (and `?quarter=next`): full width. Back link; quarter label over the date
range title; root gets "Edit" (dark). Legend line, then the roster table (scrolls sideways).

**`/roster/schedule`**: full width. From 1024px: calendar on the left, a **320px** side column on
the right, the whole thing filling the window height. Calendar: month header with Today and
arrows, 7-column grid (96px rows on phones, stretching at lg). Side column: cover panel (if any)
and the scrolling **Absences** list (root: "Everyone / Only mine" switch), with "+ Create absence"
under it. Below 768px the create button floats bottom-right as a round 56px button.

**`/roster/[id]`** (view any roster): full width. Back link, quarter label + date range title;
"Continue planning" (draft) or "Edit" (published). Notices capped at 672px, then the roster table.

**`/roster/[id]/plan`** (Plan the roster / Edit sessions): full width, sections 40px apart
(`space-y-10`). Header: label, title, date range; right: **bin** icon (delete draft) or "← Back
to the roster".
1. **Sessions to plan**: heading row with "Session defaults" and a **+** icon button; one bordered
   list grouped by date (112px date column; rows `px-3 py-1.5`, session lines `px-2 py-1`,
   service names 13px).
2. **Rules**: "+ Add rule", three collapsible bordered groups.
3. **Generate**: a section card, two columns from 640px, then the generate controls.

**`/roster/[id]/generated`** (the roster editor): **wider than the nav**: with Tracking, the only
pages past the 992px cap (`data-wide-page`): max (window + 992px) ÷ 2, so its edges sit halfway between the
nav's edges and the window's, giving the roster columns more room on desktop. Header stacks below 1024px: title ("Generated roster"
or the quarter) left; right: Loads (orange pill), back to planning, Reset, Save draft, Publish
(all `h-10`). Body: roster table; from **1280px** a 256px side column (warnings, result, rules,
weights) sits to its right, otherwise it drops below the table.

### Sessions

**`/sessions`**: full width. Title "Sessions" + subtitle, "+ Build session" (dark) right. Link
cards 1 → 2 (sm) → 3 (lg) per row: date line, "Just published" pill, name, songs with key chips.

**`/sessions/build`**: narrow **768px**. Back link, title, subtitle, amber notice; per quarter a
small uppercase heading and a list of session rows (date block, name, stage badge).

**`/sessions/[id]` (workbench / session builder)**: **wider than the nav**, the same width as the
roster editor (`<WidePage />`: max (window + 992px) ÷ 2). Two columns from 1024px: the plan on the left and a
sticky **song bank** panel on the right (384px at lg, 448px at xl; collapses to a 44px strip when
minimised). Left: back link, date line, title + badges, a row of 36px icon buttons and "Publish",
alerts, band (collapsible), then the plan editor (item cards, 2 → 4 field columns). Below 1024px
the song bank is a floating "Song bank" pill that opens full screen.

**`/sessions/tracking`** (root): **wider than the nav**, the same width as the roster editor
(`data-wide-page`: max (window + 992px) ÷ 2), so more table columns show. Title "Tracking", dark **+** with a pending count
badge; while table rows are ticked, a red-outlined 40px **bin** sits just left of the + (opens
"Are you sure you want to delete N sessions?"). Toolbar (wraps): Filters, search (fills the row,
min 192px), Columns, Table/List switch.
Table view: bordered box, max 65% of the window tall, scrolls both ways, sticky header; a sticky
40px checkbox column (header box ticks all shown rows) then the sticky date column; ticked rows
tint orange; sessions marked as no session have no checkbox and show their reason across the
row. List view: collapsible rows (date 112px → 144px at sm), details in two columns from 768px;
each row ends with a pencil then a bin (same popup, for that one session).

**`/sessions/tracking/pending`** (root): full width. Back link, title "Pending sessions", intro.
Accordion list of sessions; each opens the record form (band 1 → 2 → 4 columns, song rows in four
columns from 640px, two link fields).

### Songs

**`/songs` (song bank)**: full width, `space-y-5`, no title.
- **Toolbar: always one row from 768px up** (`flex flex-wrap items-center gap-2 md:flex-nowrap`),
  left to right:
  - search, filling whatever space is left (`md:flex-1`, never under 160px);
  - Filters, 144px (`w-36`);
  - **!** needs review, a 40px square showing only "!", with the count in its tooltip (only for
    people who can review, when something needs review);
  - "Missing" / "Missing from Drive" (from 1280px), with count;
  - then pushed right (`ml-auto`): Drive sync (the "Synced … ago" text shows only from 1024px),
    Updates, and the dark **+** add menu.
  - Nothing in the row shrinks or wraps except the search. Tested with every button showing:
    one 40px row at 768, 900, 1024, 1100, 1280 and 1440px windows (search 166–298px wide).
  - Below 768px: the search and the Filters button share the first row (Filters shows only its
    icon and arrow, menu opens right-aligned); the **!** button is hidden; Updates is a 40px bell
    with an orange dot top-right when there are new updates; the rest wrap onto a second row,
    which starts with the song count ("12 of 368 songs", Clear filters) on the left. The
    separate count line below is hidden on phones (except to show "Scanning…").
- Search results: songs matching on the title first, then on the artist, then lyrics-only
  matches; each group keeps the usual order. Chinese titles also match their Hanyu pinyin
  (spaced or run together, tones optional: "zhu ni", "zhuni", "zhǔ nǐ"; ü as u or v), worked out
  on the server with `pinyin-pro`; a pinyin match counts as a title match.
- Count line ("12 of 368 songs", Clear filters; "Scanning…" on the right). From 768px only; on
  phones the count moves into the toolbar's second row.
- **Cards**: the same grid as Team, 4 per row on desktop (see Gallery cards). Each card: title,
  small "Lyrics match" text (`text-xs text-muted`, not italic) when the search matched only the
  lyrics, type pill, status dots
  top-right, an eye button bottom-right to preview the songsheet.
- Search matches title, artist and lyrics (lyrics come from the songsheet scan).
- **Protected** (LAYOUT.md): the one-row toolbar, search/filter/! sizes and the card grid. Claude
  Code asks the owner before an edit that would change them.

**`/songs/[id]`**: full width. Back link; title 36px → 48px (sm) with a round raise-issue button
beside it; artist; fact pills. Optional "Missing from Drive" and issues boxes. Then two columns
from 1024px (3 : 2): **Details** card on the left; songsheet preview, links, versions and delete
on the right (the right column comes first on phones).

**`/songs/transpose`**: narrow **768px**. Back link, title "Transpose songsheet", intro. Step
cards "1. Songsheet" and "2. New key" (key grid 4 → 6 columns), action row, success box.

### Team

**`/team`**: full width, no title. Toolbar: instrument and ministry pickers and search (224px
from 640px) on the left; root gets "+ User" and "Manage permissions" on the right (stacks below
640px). Count line, then the **gallery cards** grid (4 per row on desktop) with instrument chips.

**`/team/[id]`**: full width. Back link; label, name title, chip row. Member rules card. Root sees
two columns from 1024px (3 : 2): "Edit member" left; permissions, password and delete cards
right. Others see one details card.

**`/team/permissions`** (root): full width, sections 40px apart. Title "Manage permissions".
Permission groups as link cards (1 → 2 → 3 per row) plus a collapsible "+ New permission group"
form; **People** list; transfer-root card (red border).

**`/team/permissions/groups/[id]`**: full width. Back link, group name title. Name/description
card, then two columns from 1024px: permissions by category, and people checklist; save button at
the bottom.

**`/team/permissions/users/[id]`**: full width. Back link, name title, email. Name/active card,
security groups card, permissions list with a dropdown per category; save at the bottom.

## Notes for future changes

- New pages: use the full page area unless the content is a single reading column (then
  `max-w-2xl` or `max-w-3xl`); never widen past `max-w-page`.
- Card grids of people or songs: reuse the gallery grid above so they match.
- Changing `max-w-page`, the nav, or anything listed in LAYOUT.md needs the owner's OK.
