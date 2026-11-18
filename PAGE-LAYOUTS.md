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
  `mx-auto flex h-14 max-w-page px-4 sm:px-6`: "Brighton Worship" (Youth Worship and Youth Media:
  followed by a small orange-400 superscript "YF", 0.55em, same font; also in the mobile sidebar;
  media teams: "Brighton Media"), the menu (from md; Main Media: Schedule and Team only), and the
  **inbox** (36px icon with an orange unread count) + account icon pushed right. Below md:
  hamburger + 288px slide-in sidebar. In the sidebar, Schedule (Roster, Absences), Sessions and (developers) Develop
  open the same indented sub-list with a thin line on its left (16px items); Develop's "Reset app
  data" is in light red.
- **Profile menu** (account icon): name and email, then the person's team. Someone on more than one
  team gets a full-width **Team** dropdown there instead (their teams in team order, the current one
  picked); choosing a team switches to it at once and opens its home (`switchTeam`,
  `web/src/components/team-switcher.tsx`). Someone on both a worship and a media team also gets a
  **Settings** link (to `/settings`). Developers instead get **View or act as**: Developer,
  Lead, the current team's groups, then "A person" — a dropdown of everyone on every team, under one
  heading per team (someone on two teams is listed under both); picking someone on another team
  switches to that team first.
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
  header. The **Service** chips are only the roster's own kinds of session, then Ad-hoc (Main: Sunday
  service, P&P, Ad-hoc; Youth: Saturday service, Ad-hoc); Ministry only when it has EM or CM
  sessions. **Phones (below 640px)**: the Ministry and Service chips are one `h-10` "Filter"
  dropdown (tick boxes under Ministry and Service, at least one on in each; plain border, never
  orange) at the left of the filter row; the roster editor has it in its header instead. The filter
  row stays on one line on phones (8px gaps), and the "N sessions" count is left out when it doesn't fit. After a cell edit the count reads "N sessions · checking…"
  while the roster is re-checked in the background; if that fails, one red line of text sits between the filter row and the table. Scrolls sideways (one column per role); below 640px the Date column stays frozen at the
  left (opaque, thin line on its right) while the rest scrolls under it.

## Pages

### Outside the app frame

**`/` Login** (`web/src/app/page.tsx`, `components/team-login.tsx`): full-screen dark (`bg-ink`),
everything centred. Title "Brighton" over a second word in *italic*, `font-display`, 60px → 96px
(sm) → 128px (lg). The second word **cycles every 3 seconds** between the kinds of team that exist
("Worship" ↔ "Media"), with the flip-in animation (skipped under reduced motion). Log in button
below; the dialog is just "Log in". The word showing has no effect: logging in opens the person's
own team (Main before Youth). Someone on both a worship and a media team lands on the kind chosen in
**Settings** (`profiles.landing_kind`; worship by default). Root and observers get their own view.
Until the team list arrives the title shows "Brighton / *Worship*".

**`/media`**: the media teams' home, laid out like `/home` (same 672px column, countdown, notices
and broadcasts, then the next session's card) with the crew in place of the band: the card's last
block is **Crew** (role → names in the team's role order, your own name in bold), and its songs are
the worship service it crews once that plan is published; the card then opens that plan on
`/projection/[id]`. Notices: "<worship team>'s plan for <service> on <day> has been published / updated" for plans of
services their team is linked to, opening it on `/projection` ("View plan" / "See what changed"); no
publish-due notices. Loader: cameras, stage lights and a clapperboard.
It sits in the same frame as every signed-in page: the shared nav bar ("Brighton Media", leading back to `/media`; profile menu with the team
dropdown, View as and Log out as above) and the 992px column. Main Media's bar holds **Schedule**
(Roster, Absences) and **Team**, which open the worship app's roster, absences and team directory
pages for their own team; Youth Media's holds none yet. Then **Services** and **Projection** (the
lead: a Services dropdown of Services, Projection, Tracking; Projection's count of new or changed plans
shows on it). No Sessions or Songs for media teams. Other
worship-app pages send media team members back to `/media`, and media pages send worship members
to `/home` (`requireUser(kind)`; `"team"` pages also let in `usesTeamPages` media teams).

**`/change-password`**: dark full screen, one centred 384px card (`max-w-sm rounded-2xl p-6`),
title `font-display text-3xl`, form, "Log out" link.

### Home

**`/home`**: narrow column **672px** (`mx-auto max-w-2xl space-y-5`). Title "Hi (name),". Then
the dark countdown card (`rounded-xl bg-ink p-6`), then broadcasts and notices together
(`space-y-3`: broadcast cards, then the accent-tinted notices list), then the next session's card
(songs, then band in two columns once the card is wide enough). With no upcoming session: the
dashed "not on any upcoming sessions" box, then broadcasts and notices.
- **Root** (on no team) gets the **wide** page (`<WidePage />`, max (window + 992px) ÷ 2) and no
  countdown: title, broadcasts and notices, then two columns from 1024px (48px apart, top-aligned):
  **Youth service** (the coming Saturday) on the left and **Main service** (the coming Sunday) on
  the right; stacked below 1024px (Youth first, 24px apart). Each has a
  heading row (name left, long date right), the worship team's session cards for that day (the
  usual card: songs, then band; the card opens the plan, switching root to that team), or a dashed
  note when nothing's published. Each is a **service card** (`service-card.tsx`): the session card
  plus, for services with a media crew (EM Sunday, EM PnP, YF Saturday), a last **Media crew** block:
  one line per role (96px role column, two columns once the card is wide enough, like the band), grouped under "team · session" only when
  there's more than one, or "No media crew on a published roster yet". If no service that day has a
  crew, any crew rostered that day gets a card of its own under them. The card's header is tinted
  by service, soft and low-saturation: EM Sunday sage `#e9ede3`, CM Sunday slate blue `#e4e9ef`,
  EM PnP clay `#f1e7dc`, CM PnP lavender `#ebe6ef`, ad hoc dusty rose `#f0e3e3`, YF Saturday
  straw yellow `#f2ecd6`.
- Notices, in order: "you haven't confirmed", plans due to be published, plans published or
  updated, then **band changes** (someone else changed the band of an upcoming session they're on:
  roster edits, take-overs, swaps), worded as in the inbox, each with "See
  updates" (opens the inbox). A band change shows on one visit only: it's marked seen when shown and stays until
  they leave the page (`profiles.home_band_seen_at`, `web/src/components/home-notices.tsx`).

### Roster

**`/roster` as root** (Schedule → Roster): not the landing below. Title "Rosters" with the quarter
under it, then one button per team (grid, 1 → 2 per row from 640px): a dark button (team name over
the date range, →) for a team with a roster published this quarter, opening it (`/roster/current`);
otherwise a dashed card ("No roster published this quarter") that isn't a link. Every button
switches root to that team first.

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

**`/roster/absences`** (everyone signed in: no permission needed for your own absences; leads and
root also see others' and every service): full width. From 1024px: calendar on the left, a **320px** side column on
the right, the whole thing filling the window height. Calendar: month header with Today and
arrows, 7-column grid (96px rows on phones, stretching at lg). Side column: cover panel (if any)
and the scrolling **Absences** list (root and developers: a borderless filter icon opening a tick-box list, "Only me" and "Everyone" first,
then each person with an absence (no search); it filters the calendar too), with "+ Create absence"
under it. **Root** sees every team's services, rehearsals and absences, and its filter starts with a
**Teams** group (EM Worship, EM Media, CM, Youth tick boxes; none = all) above "Only me"/"Everyone":
it narrows the calendar's services and rehearsals, the absences and the people list. EM Worship = EM
sessions and people with an EM share; EM Media = Main Media's sessions and members (it only crews
the EM service); CM = CM sessions and people with a CM share; Youth = Youth teams' sessions and
members. Event chips name the ministries: "EM/CM Svc", "EM/CM PnP",
"EM/CM Rehearsal", "YF Svc" (green dot), "YF Rehearsal", "Other". Below 768px the create button floats bottom-right as a round 56px button, and swiping
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
right-aligned on the same row. The **Loads** popup's table: Name, Instruments, Services, P&P (only
with P&Ps), Weighted load, EM / CM and EM share (target) (only with EM/CM sessions); the note above
it says only what applies (Youth: just "Weighted load = sessions × session weight."), and the
weights panel's "Split EM/CM" row is likewise left out. Body: roster table; from **1280px** a 256px side column (warnings,
result, rules, weights) sits to its right, otherwise it drops below the table.

### Sessions

**`/sessions` as root** (nav: **Services** › Services, Tracking): not the page below. Title
"Services" + subtitle, then every worship team's services on published rosters over the next 28
days, by date: a muted date heading (14px), then that day's service cards (as on root's home: session,
band, media crew where the service has one) in a grid, 1 → 2 per row from 1024px, top-aligned, 16px
apart; sections 24px apart. Nothing in that time: a dashed note. Opening a card switches root to its team.
A media session that crews no worship session (an unlinked ad hoc event, say) is a card of its own, its
crew where the band would be.

**A team's Services** (`/sessions/services` for a worship team's lead, nav **Sessions** › Services;
`/services` for everyone on a media team, nav **Services**, a dropdown with Services for the lead):
the same layout and coloured card headers as root's Services above, limited to services the team serves
at: its standard services (with the other teams serving at them) and its own ad hoc services, linked or
not. Another team's ad hoc service appears only once it's linked to one of the team's own. Only the
worship lead's own team's plans open from a card; nothing switches team. On a **media team's** page the sections are
weeks (Monday to Sunday, headed "Week 3 of November", counted by the Monday: the month's 3rd Monday) instead of dates: a week's services
sit two to a row from 1024px (e.g. PnP then Sunday service; a third, such as an ad hoc service, wraps
to the next row), and the next week starts a new section. Below 1024px, one per row.

**A lead's service** (`/services/[id]` for a media lead, `/sessions/services/[id]` for a worship
lead; `[id]` is their own team's session in it): opened by clicking a card on their Services page
(members' cards don't open; leads' cards have no "You:" line). "← Services", the date (muted), the service name (`text-3xl`), and the
teams serving at it; for an ad hoc service, a 40px broken-chain button top right of the heading
opens a popup (`max-w-md`) to unlink or change the link. With a session (a worship team serves at it): the **wide** page
(`<WidePage />`), two columns from 1024px (2 : 3, 24px apart): on the left a one card per team (its name, "(your team)" in a plain header (no service
colour, and no date or service name: the page heading has them), then its band or crew; no songs); on the right a **Session** card (plain header,
"Open plan" for the worship lead's own team) with each section's songs: number, title, key, "Led by",
and the sequence under it. Below 1024px the columns stack. With no session (e.g. an ad hoc service
needing only a crew): the 672px column (`mx-auto max-w-2xl`), the team cards only.

**Projection** (`/projection`, everyone on a media team: nav **Projection** for members, **Services** ›
Projection for the lead): full width, laid out like `/sessions` below (title "Projection" + subtitle,
no buttons; link cards 1 → 2 (sm) → 3 (lg) per row: date line, "Just published" / "Updated" pill,
name, then the songs with key chips). Members see the worship team's
published plans for services they're rostered on (standard services by kind and date, ad hoc ones
by link); the lead sees every upcoming published plan of the group's worship teams. Nothing: a dashed note.

**`/projection/[id]`** (a worship plan opened from Projection): the session page below, read only,
**without** the band and the song bank, so it's one column at the nav's width (no `<WidePage />`).
"← Projection" for the back link; each song opens and closes on its own, so several (or all) can be
open at once; the "what changed" box shows republished changes as it does for the band.

**`/sessions`**: full width. Title "Sessions" + subtitle, "+ Build session" (dark) right; on
**phones (below 640px)** that button is hidden and a 40px dark "+" (like the roster's New button,
named "Build session") sits centred under the cards instead. The lead, developers and anyone with
"See every published session plan" (`sessions.view`) also get a
40px-tall switch button (the word "Me" or "Team" for the current view, 14px medium, then two
opposite arrows; no border or background; muted, accent on "Team") left of "+ Build session", on phones too: it toggles `/sessions?view=all` (every upcoming
published session) and `/sessions` (their own), and the subtitle says which. Link cards 1 → 2 (sm) → 3 (lg) per row: date line, "Just published" pill, name, songs with key chips.
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
prompt. Leaving anyway (or by the browser's back button, or closing the tab) throws the edits away
and unlocks the session. If the editing lock lapses instead (2 minutes without the page renewing
it, e.g. the phone slept), coming back autosaves the edits, unless the other worship leader is
editing or saved in the meantime: then they're dropped, and the alert says why. Then
alerts, band (collapsible), "Session links (N)" (collapsible like band, closed to read and open
while editing; only when the session has links; added from the **+** menu's "+ Session link"),
then the plan editor (or, in the simplified view, the run sheet with each song's links, in blue, under its title and above its sequence,
one "Name: address" per line, no bullets, and transitions in italics between the songs, unnumbered) (item cards, 2 → 4 field columns).
In a sequence you read (both views), a step comment of up to 24 characters sits beside its step;
a step with a longer one starts a line of its own ("| Chorus (Bass) (Drums)", no bar after it) and
the next step starts a new line after its comment. The full view puts that comment on the line
under the step; the simplified view starts it beside the step and wraps it onto the lines under.
Either way it's left-aligned with the sequence (no indent) and ends in "||" if it's the song's
last step. In an open song
while editing, the title field has two 40px buttons on its right: the song bank's magnifier (or
"Change") and an outlined upload arrow, "Upload your own songsheet", which opens a 448px dialog (a
dashed drop box for one PDF or .docx; under it a "Written in" key select, beside Song title (112px)
for a PDF, or on its own (160px, "Reading key…" while the scanner reads a .docx); Cancel /
Attach bottom right). An attached sheet shows as a bordered row under the title (file icon and
name, a small "Written in" key select, then View / Replace / Remove), with "Filled in from the
songsheet: …" under it after a .docx. A .docx is shown transposed to the song's key (a song that
changes key gets "View in C" / "View in E", unless the sheet already has that key change written
in, as with bank songs); a PDF whose
key isn't the song's gets an amber note under the row ("The songsheet is in E, but the song is in
F.", in view mode too) and an amber "sheet in E" chip after the key in the closed song row.
In view mode an unpublished song's attached sheet shows the same row (View only, with its key) at the bottom of
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

**`/sessions/tracking`** (a team's lead; root's version is described after this one): **wider than the nav**, the same width as the roster editor
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

**`/sessions/tracking` as root**: same width, header, search and actions as above, but no table:
there is no Columns menu and no Table/List switch, and the list holds **every worship team's**
services (Main and Youth together, newest first, `loadAllServices` in
`web/src/lib/tracking-data.ts`). The Filters dropdown becomes one 40px button labelled with what's
shown ("YF, CM, EM" when nothing is ticked) whose menu (176px) has three checkboxes, **YF**, **CM**
and **EM**, plus "Show all" once one is ticked. A Main session for both ministries counts as EM and as CM.
Each row: chevron, date, a pill (YF, EM, CM or EM/CM), then the service in medium weight: EM Sunday
service, CM Sunday service, EM PnP, CM PnP, Youth service, or "Ad hoc · <its name>". The row
ends with a pencil then a bin, as above. Opening a row shows up to three boxes (bordered, 16px
padding, 12px apart, top-aligned): **Media team** (role → names, from the group's media roster
that day; only for EM Sunday service, EM PnP and Youth service), **Worship team** (the band, under
the team's name) and **Session** (songs, livestream links, comments). Three across from 1024px when
there's a media team, otherwise two across from 768px; stacked below that. The pencil swaps the
boxes for the usual record form. On phones the second toolbar row has only Export CSV and the +, at
the right.

**`/services/tracking`** (a media team's lead, nav **Services** › Tracking): **wider than the nav**,
like the worship team's Tracking. Title "Tracking" + subtitle; while rows are ticked, the
red-outlined 40px **bin** at the right of the title row (same "Are you sure…?" popup; deleting takes
sessions out of tracking for good, the roster keeps them: `tracking_removed`). No +, no Export CSV,
no List view. Toolbar (wraps): **Filters** (Crew member, Service, Date range; icon only on phones),
search (fills the row, min 192px; plain search only, no query mode), **Columns** (Session: Service;
Crew: each role; remembered on the device). Then the same table box (max 65% of the window tall,
scrolls both ways, sticky header, row count under it): sticky 40px checkbox column (header box
ticks all shown rows), sticky Date column, Service, then one column per role of the team (names,
"-" when nobody); ticked rows tint orange. Every session on the team's published or archived
rosters up to today, newest first, straight from the roster (nothing to confirm); a session marked
as no session has no checkbox and shows its reason across the role columns
(`loadCrewRecords` in `web/src/lib/tracking-data.ts`, `crew-tracking-view.tsx`).

**`/sessions/tracking/pending`** (root): full width. Back link, title "Pending sessions", intro, and
a dark 40px **+** on the right of the title (`new-session.tsx`): a dialog (max 768px, scrolls
within 90% of the window height) to add a whole new session by hand — date (today or earlier),
Session (the team's regular kinds, or "Other (ad-hoc)"), Ministry (EM and CM / EM / CM, only for
Other on teams that split them), Name (placeholder: the kind's name), then the record form — saved
straight into tracking. Accordion list of sessions; each opens the record form (band 1 → 2 → 4
columns, song rows in four columns from 640px, two link fields), with a red-outlined **Delete**
beside "Save to tracking": it turns into "Delete for good?" with a red Delete and Keep; deleting
takes the session off Pending for good without tracking it, and the next one opens.
- Deleting tracked sessions (Tracking's delete) removes them for good: ones from a roster don't come
  back to Pending (`roster_sessions.tracking_removed`).

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

### Root's view

Root is on no team and sees the worship app frame with the bar's name "Brighton Serving", no
Songs link, and **Team** as a plain link (no dropdown) to the Teams overview (`/teams`).
Brighton Serving is outside every team: at login root is in no team, and Home, Schedule → Roster
(root's per-team overview, below), Absences, Services and Tracking cover every team, worship and
media. Pages about one team (`/team`, `/team/permissions`, a roster's own pages, Tracking's
Pending) show the team root opened ("Work in (team)" or any link on a team's page). Opened with
no team, they go to **`/teams/pick`** first: "Which team?" and a grid of team cards (1 → 2 per
row: name, group · kind), each opening that team at the page asked for. While in a team the bar's
Root pill reads "Root · (team name)", the name "Brighton Serving" leads back out (`/serving`), and
the profile menu has "In (team) · Back to Brighton Serving". In that team root can do
everything its lead can. Root's `/team` has a "(team name) · Other teams" line above the toolbar;
`/team/[id]` starts its label with the team name, and `/team/permissions` shows it under the title.

**`/teams`** (root; developers via "Manage teams" in the profile menu): 992px column. Title
"Teams", a grid of team cards (1 → 2 per row: name, group · kind, member count, lead or "No lead
yet"), an **Observers** card (one part per group, split by a rule: the observer's name, an
"observer" badge, email, "sees absences" / "no absences" and "manages permissions" / "can't change
permissions", with a collapsible "Remove observer" confirm; or, with none, a 2-column form: name,
email, then "Can see absences" and "Can manage permissions" tick boxes, both ticked for Youth),
then a collapsible "+ New team" form (name, group Main/Youth, worship/media, lead's email
and name, maximum permissions by category).

**`/teams/[slug]`**: 992px column. Back link, team name title with group, kind and member count,
and a "Work in (team)" button on the right. Cards: **Settings** (read-only list from the team's
config: regular sessions, EM/CM split, Sunday/P&P choice, and for media the worship team it works
on), **Lead** (the lead, or a "Create lead" form: email, and name for a new account; "Change lead"
once there is one), **Members** (the heading itself, no arrow; on hover it turns accent and an accent underline grows out from the centre, opens the team's gallery `/team`; names, 1 → 2 → 3
columns, each linking to that member's page; every link switches root to this team first), and a collapsible "Name and maximum permissions" form.

### The observer's view

An observer (one read-only account per group, on no team, created on `/teams`) sees the same frame as root:
"Brighton Serving" with its group's tag (YF for Youth), links Schedule (Roster, Absences), Team and
**Services** (no Songs, no Tracking), and an "Observer" pill next to the profile button (as root
gets "Root" and developers "Dev"). Everything is limited to its group's teams:

- **Home**: the **wide** page. Greeting and a muted line, then one section per day in the coming
  week (today + 6) with a service: a muted date heading, then that day's service cards (session,
  band, media crew; 1 → 2 per row from 1024px), e.g. the Saturday service and any ad hoc events. A
  day with only a media crew shows it in its own card. No countdown, notices or broadcasts.
- **Roster** and **Services**: root's pages, filtered to the group's teams.
- **Absences**: no Create absence button and no "Create absence" in the day popup. An observer that
  sees absences gets a lead's calendar (everyone on the group's teams, every service), but its filter
  icon opens team tick boxes only (e.g. Youth Worship, Youth Media; none ticked = every team), no
  people. One that doesn't gets no absences at all: the calendar shows only the services and
  rehearsals, and the side box is **Upcoming services** (date in a 96px muted column, then the name;
  each opens the session panel) instead of Absences, and its Schedule menu calls the page
  **Calendar** instead of Absences.
- **Team**: above the gallery, a row of pill links, one per group team (the current one dark), and
  "Manage permissions" on the right (only an observer that manages permissions); following a pill switches team. The gallery has no "+ User".
- **Manage permissions** (only an observer that manages permissions): as a lead's (team name under the title, Transfer lead at the bottom). A
  lead's page shows the permission list with "Lead: allowed / Deny" for each.

Root sees the observer in the group's directories (a sky "observer" badge, not counted in "N of M
members"); its `/team/[id]` has only a Password card.

### Settings

**`/settings`** (linked from the profile menu for people on both a worship and a media team):
`mx-auto max-w-2xl` column, title "Settings" `font-display text-4xl`, then one section card "When I
log in": two radio rows (Brighton Worship, Brighton Media; the chosen one with an accent border)
and Save. Anyone else who opens it sees a line saying they always land on their own team.

### Team

**`/team`**: full width, no title. Toolbar: instrument and ministry pickers and search (224px
from 640px) on the left; root gets "+ User" and "Manage permissions" on the right. **Phones
(below 640px)**: one row: search (fills the space) on the left, then one Filter dropdown in place
of the two pickers (styled like FilterMenu, icon and arrow only, no word; tick boxes grouped under Instrument and Ministry,
nothing ticked = no filter, plus Clear; opens right-aligned to the button), then for root a black "+ ▾" dropdown holding "+ New user"
and "Manage permissions" (menu opens right-aligned). Count line, then the **gallery cards** grid (4 per row on desktop)
with instrument chips. Media teams say "role" wherever worship teams say "instrument" (pickers, chips,
the form), and every picker lists only the team's own roles (`config.roles`). In the new-user form, an
email that already has an account on another team brings up a link box above the Save row
("… already has an account on Main Worship. Link it to this team?", Yes, link / No, cancel).

**`/team/[id]`**: full width. Back link; label (plus "· also on <team>" for a lead, root or developer viewing someone on two teams),
name title, chip row. Root and developers, on teams that use personal rules (Main and Youth Worship, Main Media): a Personal rule card ("can serve A, B, C, but should not be rostered for A, B", Edit → a full-width-on-phones, 288px-from-640px tick-box dropdown of their instruments (roles on Main Media), Save / Cancel). Member rules card. Root sees
two columns from 1024px (3 : 2): "Edit member" left; permissions, password and delete cards
right; for someone also on another team, "Edit member" starts with a line saying name, email and gender
are shared with that profile. Others see one details card.

**`/team/permissions`** (the team's lead, root, developers): full width, sections 40px apart. Title "Manage permissions".
Permission groups as link cards (1 → 2 → 3 per row) plus a collapsible "+ New permission group"
form; **People** list (this team's members); transfer-lead card (red border).

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
