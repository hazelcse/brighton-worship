# Page layouts

How every page in the app is laid out, as of 11 Nov 2026. Read this before changing a page's
layout, and keep it up to date when you do. The measurements the owner chose on purpose are
protected in [LAYOUT.md](LAYOUT.md) (and checked by `web/scripts/check-layout.mjs`); don't change
those without asking. Fonts are in [FONTS.md](FONTS.md).

**Page widths and the nav bar width are owner-only** (restated 13 Nov 2026): never change a page's
width, or the nav's span from "Brighton Worship" to the account (profile) button, unless the owner
specifically asks. If Claude decides one needs to change, it must first warn the owner, explain
why and what would change, and ask for permission; no edit until they say yes. See
[LAYOUT.md](LAYOUT.md#page-widths-and-the-nav-bar-width-owner-only).

Sizes: Tailwind units are 4px (`p-4` = 16px). `max-w-md` 448px, `xl` 576, `2xl` 672, `3xl` 768,
`4xl` 896. Breakpoints: `sm` 640px, `md` 768, `lg` 1024, `xl` 1280 (window widths).

## The frame every signed-in page sits in

- **Nav bar** (`web/src/components/app-nav.tsx`): `sticky top-0 z-30 bg-ink`, 56px tall. Contents
  `mx-auto flex h-14 max-w-page px-4 sm:px-6`: "Brighton Worship", the menu (from md), and the
  **inbox** (36px icon with an orange unread count) + account icon pushed right. Below md:
  hamburger + 288px slide-in sidebar. In the sidebar, Schedule (Roster, Absences), Sessions and (developers) Develop
  open the same indented sub-list with a thin line on its left (16px items); Develop's "Reset app
  data" is in light red.
- **Inbox** (`web/src/components/inbox.tsx`, for anyone who can see the roster): the roster
  updates, newest first (new ones tinted, linked ones clickable). A popup under the icon, 384px
  wide, right-aligned, max 512px tall with the list scrolling; below 640px it spans the window
  less 16px each side. Opening it marks everything read.
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
  (`h-8 rounded-full`; root and developers also get a "People" chip-sized dropdown, searchable
  tick boxes, that keeps only the sessions those people serve at, shown at every width; below 640px
  without its "People" label, as an `h-10 rounded-lg` button with a person icon like the Filter dropdown), then
  `overflow-x-auto rounded-xl border` table (the viewer's own part cells, not the date, get a 2px
  soft orange (orange-300 at 70%) inset border; root and developers get it only on published rosters, not the roster editor; a 32px round eye button at the right end of
  the filter row (black with a white eye when on, white with a black border and eye when off), shown at every width when the viewer is on the roster, turns it off and on, remembered per browser), `text-[13px]`, sticky
  header. **Phones (below 640px)**: the Ministry and Service chips are one `h-10` "Filter"
  dropdown (tick boxes under Ministry and Service, at least one on in each; plain border, never
  orange) at the left of the filter row; the roster editor has it in its header instead. The filter
  row stays on one line on phones (8px gaps), and the "N sessions" count is left out when it doesn't fit. Scrolls sideways (one column per role); below 640px the Date column stays frozen at the
  left (opaque, thin line on its right) while the rest scrolls under it.

## Pages

### Outside the app frame

**`/` Login** (`web/src/app/page.tsx`): full-screen dark (`bg-ink`), everything centred. Title
"Brighton / Worship" `font-display`, 60px → 96px (sm) → 128px (lg). Log in button below.

**`/change-password`**: dark full screen, one centred 384px card (`max-w-sm rounded-2xl p-6`),
title `font-display text-3xl`, form, "Log out" link.

### Home

**`/home`**: narrow column **672px** (`mx-auto max-w-2xl space-y-5`). Title "Hi (name),". Then
the dark countdown card (`rounded-xl bg-ink p-6`), then broadcasts and notices together
(`space-y-3`: broadcast cards, then the accent-tinted notices list), then the next session's card
(songs, then band in two columns once the card is wide enough). With no upcoming session: the
dashed "not on any upcoming sessions" box, then broadcasts and notices.
- Notices, in order: "you haven't confirmed", **sessions left open for editing** (they left a
  session's builder while still in edit mode: "(service) on (date) is still open for editing. Your
  changes aren't saved yet." with "Go back and save" linking to `/sessions/<id>`; it stays until
  they save or stop editing there, `worship_session_open_edits`, `web/src/lib/open-edits.ts`),
  plans due to be published, plans published or
  updated, then **band changes** (someone else changed the band of an upcoming session they're on:
  roster edits, take-overs, swaps), worded as in the inbox, each with "See
  updates" (opens the inbox). A band change shows on one visit only: it's marked seen when shown and stays until
  they leave the page (`profiles.home_band_seen_at`, `web/src/components/home-notices.tsx`).

### Roster

**`/roster` (landing)**: full width, fills the window height (`min-h-[calc(100dvh-8.5rem)]`,
`gap-4`). Top row: dark "This quarter's roster" card (max 576px) and, when published, a 224px
"Next quarter" card; on the right (editors) "View past rosters" and a dark **+** menu (on phones
they get their own row: View past rosters at the left, + at the right). When both
are published (every screen, everyone; max 576px from 640px up) they're
one button (`quarter-switch-button.tsx`): press and hold (touch or mouse) flips it
between this quarter (dark) and next quarter (light, like the desktop card), two dots show which,
and a tap opens the one showing. Below,
**Your Services** and the **Requests** panel (root: **Actionables**) share the rest of the
height equally (`flex-[1_1_0px]` each, so content doesn't skew the split; space is left blank when
there are few services; with none, an animated wind-and-leaf picture, `wind-leaf.tsx`, sits
centred in it over "No confirmed services coming up."). Your Services has no box or border: an `text-lg font-semibold` h2
over **one sideways-scrolling row** of gallery-style cards (`drag-scroll.tsx`), as wide as the
gallery grid's columns (4 per row from 1280px, 3 from 1024px, 2 from 420px, 75% on small phones so
the next card peeks in). The row snaps to cards; touch and trackpads scroll natively, and a mouse
can press-and-drag it (with a short glide, stopping at either end, never looping); fades show on
whichever side has more. Cards: their confirmed upcoming services on any published roster, with
the date, service name and the band (role short name + name; never songs). A card links to the
session once its plan is published, otherwise it isn't clickable. Requests is a bordered box with
a scrolling list; each request has its buttons (✓ / ✗, Can't / Take over) on the right, unless
any one request's text and buttons can't share a line, then every request puts its buttons on a
row of their own underneath, right-aligned (`useStackedRows` in `requests-board.tsx`). Roster updates moved to the nav's inbox. Below 640px the top row stacks.

**`/roster/new` (Rosters)**: narrow **672px**. Back link, title "Rosters" + "Past rosters →".
List of roster rows (`rounded-xl border px-4 py-3`); selecting one shows open/delete icon tiles;
a dashed **+** square adds one (dialog with a quarter picker, 2 → 4 columns).

**`/roster/past`**: full width. Title "Past rosters" + intro; one bordered list of rosters with a
status pill on the right.

**`/roster/current`** (and `?quarter=next`): full width. Back link; quarter label over the date
range title; root gets "Edit" (dark). Legend line, then the roster table (scrolls sideways). This
week's rows are bold between two heavy lines; earlier weeks are faded (`opacity-70`) and start
hidden. A small triangle in the left side padding (16px wide, so it fits the phone gutter), centred
on this week's heavy top line, shows / hides them (▸ hidden, ▾ shown; `past-rows-toggle.tsx`).

**`/roster/absences`**: full width. From 1024px: calendar on the left, a **320px** side column on
the right, the whole thing filling the window height. Calendar: month header with Today and
arrows, 7-column grid (96px rows on phones, stretching at lg). Side column: cover panel (if any)
and the scrolling **Absences** list (root and developers: a borderless filter icon opening a tick-box list, "Only me" and "Everyone" first,
then each person with an absence, searchable; it filters the calendar too), with "+ Create absence"
under it. Below 768px the create button floats bottom-right as a round 56px button, and swiping
the calendar sideways changes month (left = next, right = previous; mostly-horizontal swipes of
50px+ only, with a short slide-in).

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
(all `h-10`). Editing a published roster: the Published / Unpublished changes / Editing badges sit
to the right of the title at every width (each wraps on its own), and the buttons are Load, Reset,
Edit (or ×, save), Republish. Stacked (below 1024px) there's 16px between the date range and the
button row. **Phones (below 640px)**: the Ministry and Service chips are replaced by one `h-10`
"Filter" dropdown (`MobileRosterFilter`, styled like FilterMenu; checkboxes grouped under Ministry
and Service, at least one on in each) at the left of the button row, with Load / Reset / Edit
right-aligned on the same row. Body: roster table; from **1280px** a 256px side column (warnings,
result, rules, weights) sits to its right, otherwise it drops below the table.

### Sessions

**`/sessions`**: full width. Title "Sessions" + subtitle, "+ Build session" (dark) right; on
**phones (below 640px)** that button is hidden and a 40px dark "+" (like the roster's New button,
named "Build session") sits centred under the cards instead. Link cards 1 → 2 (sm) → 3 (lg) per row: date line, "Just published" pill, name, songs with key chips.
Worship leaders also see their sessions' drafts here, mixed in by date: white, with a dashed
amber border (`amber-400`) and a small amber "Draft" pill after the date (9px text, 14px tall,
just under the date's line) in place of "Just published". A published plan with unpublished
changes stays a normal white card with a green "Published" pill then the "Draft" pill.

**`/sessions/build`**: narrow **768px**. Back link, title, subtitle, amber notice; per quarter a
small uppercase heading and a list of session rows (date block, name, stage badge). Only sessions
whose plan hasn't been started; started ones (drafts, published) are on `/sessions`.

**`/sessions/[id]` (workbench / session builder)**: **wider than the nav**, the same width as the
roster editor (`<WidePage />`: max (window + 992px) ÷ 2). Two columns from 1024px: the plan on the left and a
sticky **song bank** panel on the right (384px at lg, 448px at xl by default; collapses to a 44px strip when
minimised). The 16px gap between them is a drag handle (line shows on hover; arrow keys move it
16px, Shift 64px; double-click resets): it moves the split only, never the page width. The bank
stays 320px to half the row and the plan keeps at least 560px; the chosen width is remembered per
browser (`localStorage` `sessions.songBankWidth`). Left: back link, date line (underlines on hover; opens the **Dates** dialog, 448px: service and
rehearsal with times, and for its worship leaders "Change rehearsal date" (or "Add rehearsal" when there's none) bottom right, which turns
it into a 512px dialog: a month calendar from this month to the service's month, 56px rows with
the band's absences as 4px bars, days before today or after the service greyed out, the service
boxed orange, the current rehearsal blue, the new day green; arrows between months, swipe on
phones; then the time, an "Away on …" list with a sub picker per person, and Remove rehearsal /
Cancel / Save), title + badges (the badges in one row, to the right of the title when they fit,
otherwise as a row under it), a row of 36px icon buttons and "Publish". **Phones (below 640px)**:
the date line moves under the title and badges, shortened to one line ("Sun, 15 Nov 2026 ·
Rehearsal Sat 14 Nov"; it wraps only if it still doesn't fit). In the button row the eye
(simplified view) stays at the left and Undo / Edit / Publish sit at the right; while editing,
× and save sit at the left and + at the right. **Leaving while editing**: any in-app link
("← Sessions", the nav) opens a 384px dialog like the save prompt: "Save before you go?" (or "You're
still editing" with nothing changed), an × in the top right corner to stay, and Leave anyway / Save
and leave (Stop editing and leave) centred under the text; closing the tab, reloading or going to another site gets the browser's own "Leave site?"
prompt. Leaving anyway (or by the browser's back button) keeps the edits unsaved, unlocks the
session and puts a notice on Home; coming back picks the edits up in edit mode, with an
accent-tinted note above the band ("You left this session open for editing on …"). Then
alerts, band (collapsible), "Session links (N)" (collapsible like band, closed to read and open
while editing; only when the session has links; added from the **+** menu's "+ Session link"),
then the plan editor (or, in the simplified view, the run sheet with each song's links under its sequence,
one "Name: address" per line, no bullets, and transitions in italics between the songs, unnumbered) (item cards, 2 → 4 field columns). In an open song
while editing, the title field has two 40px buttons on its right: the song bank's magnifier (or
"Change") and an outlined upload arrow, "Upload your own songsheet", which opens a 448px dialog (a
dashed drop box for one PDF or .docx; for a PDF, Song title + a 96px Key select under it; Cancel /
Attach bottom right). An attached sheet shows as a bordered row under the title (file icon and
name, then View / Replace / Remove), with "Filled in from the songsheet: …" under it after a .docx.
In view mode an unpublished song's attached sheet shows the same row (View only) at the bottom of
the open song; once published it's a button among the set's Songsheets like a bank song's. In a song's sequence
builder, steps drag to a new spot (mouse: press and move; touch: press and hold, then move), taking
their tags, linked instruments and comment with them; "Use song's sequence" and "Clear" sit right of
the own-element box from 640px, and on their own line on phones ("Use song's sequence" left, "Clear" right). Below 1024px
the song bank is a floating "Song bank" pill that opens a bottom sheet over the page (no
backdrop: the plan behind it still scrolls and takes taps; the pill hides while it's open). The
sheet starts just under the nav; its 24px two-dash handle drags it taller or shorter, and let go
near the bottom it shrinks to just that handle bar, which drags or taps back up. Its ✕ (in place of
the desktop ">") is the only way to close it. The panel's list starts with
one row at every width: search (fills the row, 40px tall), then an icon-and-arrow-only Filters
dropdown (Language, Type) whose menu opens right-aligned. A song opened in the panel
has a "← Song bank" back link (an arrow with a line) and shows its title (with an "In song N" badge beside it when it's already the chosen slot's song),
pills and "Use for…" button, then the songsheet preview card, then its sequence,
links and notes, then the "Open song page ↗" link.

**`/sessions/tracking`** (root): **wider than the nav**, the same width as the roster editor
(`data-wide-page`: max (window + 992px) ÷ 2), so more table columns show. Title "Tracking", dark **+** with a pending count
badge, and just left of it a 40px "Export CSV" button (downloads the sessions shown after filters
and search, every column, `web/src/lib/tracking-csv.ts`); while table rows are ticked, a red-outlined 40px **bin** sits just left of the + (opens
"Are you sure you want to delete N sessions?"). Toolbar (wraps): Filters, search (fills the row,
min 192px), Columns, Table/List switch. The search's icon sits inside its right end (32px button): the
magnifier (plain search) or a right-join icon (query search, `web/src/lib/tracking-query.ts`), and
tapping it switches between them. In query mode a help line (red with the error when the query
can't be read) shows under the toolbar. The query searches within what the filters leave. The Columns menu (240px) hangs from the button's right
edge, or from its left edge when that would run off the screen (phones, where Columns wraps to
the start of a row). **Phones (below 640px)**: Filters and Columns show just their icon and arrow,
and share the first row with the search (which may go under 192px there); the second row has the
Table/List switch at the left (32px tall, fully rounded) and, at the right, the bin (when rows
are ticked), Export CSV as just its 40px download icon, and the + (these leave the title row).
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
  - Filters, 144px (`w-36`): one dropdown (`MultiFilterMenu`, same look as FilterMenu) with tick
    boxes, several per group, nothing ticked = all: Language, Type, Artist (every artist in the
    library, A–Z; the list scrolls) and, for people who can review when something needs review,
    Status ("Needs review (N)"; this replaced the old "!" button). The button shows up to two
    picks, then "N filters";
  - "Missing" / "Missing from Drive" (from 1280px), with count;
  - then pushed right (`ml-auto`): Drive sync (the "Synced … ago" text shows only from 1024px),
    Updates, and the dark **+** add menu.
  - Nothing in the row shrinks or wraps except the search. Tested with every button showing (when
    it still had the "!" button): one 40px row at 768, 900, 1024, 1100, 1280 and 1440px windows (search 166–298px wide).
  - Below 768px: the search and the Filters button share the first row (Filters shows only its
    icon and arrow, menu opens right-aligned; it has the same Artist and Status lists); Updates is a 40px bell
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
beside it; artist (no fact pills). Optional "Missing from Drive" and issues boxes. Then two columns
from 1024px (3 : 2): **Details** card on the left; songsheet preview, versions and delete on the
right (Details spans both rows; the preview sits above the rest). On phones: preview, then
Details, then the songsheet card and delete. Details always opens read-only, two columns on every screen: Type | Tempo, Language |
Original key, Time signature (if set), then full width: standard sequence
(drawn as in the session builder's full view, `SequenceView`: || Intro | Verse x2 (High) [Drums] ||),
themes, Reference links (`SongLinks`; no separate Edit), then notes (no Sections
list). In the edit form the links also come just before Additional notes: each shows as a plain
link with a small faded pencil; the pencil opens it as a white card with a light grey
border (`border-border bg-surface`) with labelled white inputs (Link title, Link), Up/Down, Done and Remove. New links open as cards straight away. For people who can edit songs or links, a borderless,
faded pencil follows the title (underlined on hover; no hover on phones). It opens the edit form
(`?edit=1`; on phones the page scrolls down to it) with the details and/or the Reference links
rows, whichever they may change, and one Save for both (links are checked first, so a bad link
saves nothing). Saving goes back to the read-only view, and while editing the back link reads "← Back to song"
and does the same (dropping the edits). Leaving the page drops the edits without asking, and there's no cancel button.

**Songsheet views** (the Preview card here and in the session song bank, its Full size popup, the
song cards' eye popup, and the session PDF popup): each page is shown zoomed in on its white
margins — each side margin halved, top and bottom trimmed by the same share so the page keeps its
shape. Margins are measured per page from its pixels (`web/src/lib/sheet-crop.ts`), never cut
into ink, and all pages of a sheet share one zoom. The Preview card's padding is `p-2 sm:p-2.5`
(half a section card's).

**`/songs/transpose`**: narrow **768px**. Back link, title "Transpose songsheet", intro. Step
cards "1. Songsheet" and "2. New key" (key grid 4 → 6 columns), action row, success box.
Picking a library song's own key opens its stored songsheet's PDF straight away (nothing is
transposed); View / .docx / PDF then give the stored sheet too.

**Loading (song pages and songsheet views)**: `/songs`, `/songs/[id]` and `/songs/transpose`
while their data loads, the songsheet preview card, the PDF popup and the transposer's "Working
out the key" show `NoteLoader` (`web/src/components/note-loader.tsx`): three random music symbols
(text characters, the device's own symbol font) bouncing on the spot over "Loading . .. ...". It
fades in after 300ms so quick loads show nothing; with reduce motion the notes stay still.

**Loading (roster pages)**: every `/roster/...` page shows `CalendarLoader`
(`web/src/components/calendar-loader.tsx`) while its data loads, `py-24`: three small calendar
pages, 26×30px to match `NoteLoader`'s symbols and in the same `text-foreground/70` (outline, solid
top strip, day number; no accent colour), for the next three Sundays, each flipping
over on its top edge in turn and coming back as the Sunday three weeks on, over "Loading the
roster . .. ..." (the label names the page). Same 300ms fade-in and reduce-motion rule as
`NoteLoader`. It only shows on a full page load; moving between pages in the app keeps the old
page up until the new one is ready.

**Loading (team and session pages)**: same pattern and style (three 30px items in
`text-foreground/70`, taking turns over a label naming the page, `py-24`, 300ms fade-in,
still with reduce motion). Every `/team/...` page shows `TeamLoader`
(`web/src/components/team-loader.tsx`): a roll call of three solid little people that pop in one
after another, then all fade out. Every `/sessions/...` page shows `SessionLoader`
(`web/src/components/session-loader.tsx`): three 24×30px song sheets (outlined like the calendar
pages) whose three lines draw in left to right in turn.

**Loading (home page)**: `/home` shows `HomeLoader` (`web/src/components/home-loader.tsx`),
`py-24`, same size, colour, label, fade-in and reduce-motion rules: five 30px instruments (mic,
keyboard, acoustic guitar, electric guitar/bass, drums; 10px apart) fly out of the middle to
their places, hold, gather back into the middle and become a plain (empty) Latin cross; the cross
shrinks back as the band flies out again, in a 5s loop with no gap. With reduce motion the band
sits still and the cross isn't shown.

### Team

**`/team`**: full width, no title. Toolbar: instrument and ministry pickers and search (224px
from 640px) on the left; root gets "+ User" and "Manage permissions" on the right. **Phones
(below 640px)**: one row: search (fills the space) on the left, then one Filter dropdown in place
of the two pickers (styled like FilterMenu, icon and arrow only, no word; tick boxes grouped under Instrument and Ministry,
nothing ticked = no filter, plus Clear; opens right-aligned to the button), then for root a black "+ ▾" dropdown holding "+ New user"
and "Manage permissions" (menu opens right-aligned). Count line, then the **gallery cards** grid (4 per row on desktop)
with instrument chips.

**`/team/[id]`**: full width. Back link; label, name title, chip row. Root and developers: a Personal rule card ("can serve A, B, C, but should not be rostered for A, B", Edit → a full-width-on-phones, 288px-from-640px tick-box dropdown of their instruments, Save / Cancel). Member rules card. Root sees
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
- Page widths and the nav bar width: only when the owner specifically asks. If Claude thinks one
  must change, warn, explain why, and ask permission **before** editing (not just in a summary).
