# Teams

Teams come in two **groups**, Main and Youth, and each group has a **worship** team and a **media**
team:

| Group | Worship       | Media       |
| ----- | ------------- | ----------- |
| Main  | Main Worship  | Main Media  |
| Youth | Youth Worship | Youth Media |

Each team has its own lead, members, permission groups, rosters, roster rules, session plans,
tracking and broadcasts. Signed into one team, you only see that team's data (absences are the exception: they're
personal and count for every team someone is on).

## Root

Root is on no team but can do everything a team's lead can, in any team: add, edit, link and remove
members, set their permission groups and personal allows/denies, reset passwords, change the lead,
plan rosters and so on (always within the team's maximum permissions, like the lead). Root works in
one team at a time: **Team** in the bar opens the Teams overview; on a team's page, the **Members**
heading opens its gallery (with "Manage permissions" there, as for the lead) and each name opens that
member. These switch root to that team via `/teams/<slug>/open?next=<page>`.

Removing someone who is also on another team only takes them off this team (its profile, groups and
allows/denies); their login and other teams' profiles stay. Someone on one team only is deleted.

## Permissions every member starts with

Each team's "member" group: Main Worship and Youth Worship can see the roster, the team directory
and the song library, and transpose songsheets; Main Media and Youth Media can see the roster and the
team directory (`20261117300000_member_group_basics.sql`). Leads can change these in Manage
permissions. Absences need no permission at all: everyone sees and manages their own. "See every published
session plan in the team" (`sessions.view`) lets someone open every published plan, not just those
of sessions they serve at, and switch Sessions to the whole team.

## Observers

Each group (Main, Youth) can have one read-only **observer** account at a time. Root creates (or
removes) them on the Teams page. An observer is on no team (`profiles.observer_group`), so it isn't
counted, rostered or listed in a directory (root still sees it there, badged "observer").

It logs in from either title and lands on "Brighton Serving" for its group, outside every team (like
root's, which covers every team): the coming week's
services (session, band and media crew, ad hoc events included), every published session plan, both
of the group's team directories and the rosters. It can't add absences, edit the directory, or change
rosters or sessions.

When root ticks **Can see absences** (`profiles.observer_sees_absences`; on for the Youth observer,
off for Main's), it also sees everyone's absences on its teams, filtered by team (not by person).
Otherwise its Absences page shows only the services, with a list of upcoming services.

When root ticks **Can manage permissions** (`profiles.observer_manages_permissions`; on for the Youth
observer, off for Main's), the observer also manages permissions on both of its teams: permission
groups, everyone's groups and allows/denies, and transferring the lead. It can also deny permissions
to a team's lead (the lead otherwise has everything the team may do; running the team, i.e. adding
members and managing permissions, stays with the lead). Root can deny a lead permissions too.

## Developers

One developer account (`npm run create-dev`) covers every team, working in one at a time with the
lead's powers there (within the team's maximum permissions). Its **View or act as** list has everyone
on every team, grouped by team; picking someone switches to that team and shows the app as they see
it there. In the media app, "Back to developer" / "Stop viewing as" returns to Main Worship.

## Services (what root sees)

Root sees **services** rather than one team's sessions (nav: Services). A service is a worship
team's session on a published roster (its plan and band) plus, for some, the media crew of the same
group serving that day:

| Service | Session | Band | Media crew |
| --- | --- | --- | --- |
| EM Sunday service | yes | yes | Main Media |
| CM Sunday service | yes | yes | no |
| YF Saturday service | yes | yes | Youth Media |
| EM PnP | yes | yes | Main Media |
| CM PnP | yes | yes | no |

Which kinds have a crew is `CREW_KINDS` in `web/src/lib/sessions.ts`. A standard service's crew is
the media team's session of the **same kind** that day (so Youth Media needs a `saturday` session
kind for its crew to join the YF Saturday service).

**Ad hoc services** (`custom` sessions) are linked by hand (`roster_sessions.link_id`,
`web/src/lib/service-links.ts`). Any team can add one first. When a lead adds one on a day where
other teams of the **same group** already have ad hoc services, a popup lists them: pick the one it's
the same service as, or **Do not link**. Linking, changing and unlinking later is in the session's
edit dialog ("Linked service"). Only leads link; one session per team per link. Linked sessions share
the name of whichever was added first; renaming one renames the others, moving one to another day
unlinks it, and deleting one leaves the rest (with the name). A media session that crews no worship
session is shown as a service of its own.

**Same day:** an ad hoc event on a Sunday/Saturday service day is taken to be later in the day, so
people on that day's standard service can still be picked for it (ad hoc picker, roster grid and
generator). Two standard services, or two ad hoc events, on one day still clash. Services lists (root's, the observer's and the
teams' Services pages) show a day's ad hoc services after its standard ones.

**Team Services pages:** a worship lead's Sessions › Services and the media teams' Services show the
team's own services the same way: its standard ones and its own ad hoc ones, plus other teams' ad hoc
services once linked. A lead's cards open the service (`/services/[id]`, `/sessions/services/[id]`):
every team serving at it with its band or crew, the session (songs and sequence), and for an ad hoc
service a broken-chain button (top right) whose popup links, changes or unlinks it. That only changes the lead's own team's
session; a standard service is linked by its kind and date and has no button.

**Link notices:** when a lead links their ad hoc service to another team's, changes or removes the
link, or moves their linked session to another day or deletes it, the other team's lead gets an
inbox update (kinds `service_linked` / `service_unlinked` in `roster_updates`, with `team_id` the
team told). Changing a link tells the old team it was unlinked and the new one it was linked.
Clicking it opens that lead's service page. Nobody else on the team sees these.

**Media Tracking:** a media lead's Services › Tracking is a table of who served at each session
that has happened, by role, from the team's published rosters, with filters, columns and deleting
(which takes a session out of tracking only; the roster keeps it).

## People on more than one team

One email is one person, with one login. Someone on two teams (e.g. Abigail on Main Worship and
Youth Worship) has:

- **Shared** (`profiles`): name, email, gender, password, absences.
- **Per team** (`team_members`, one row per person per team): instruments or roles, EM/CM share,
  "serves at", personal rule, lead or not, plus that team's permission groups and allows/denies.

So she can be worship leader and vocalist on Main Worship but only worship leader on Youth. Each
team's roster generator reads only that team's profile; covers, swaps and band-leader handovers use
the profile on the session's team.

**Logging in and switching:** someone on several teams of one kind lands on the Main team first
(e.g. Main Worship before Youth Worship). Their profile menu then has a **Team** dropdown of every
team they're on (worship or media), which switches straight to the chosen team's home.

**Linking:** when a lead adds a member whose email already has an account on another team, the
form asks whether to link it. "Yes, link" adds them to this team with the instruments/roles and
settings just entered as their profile here (their name, email and gender stay as they are; gender
is only filled in if it was never set). Their other teams' profiles don't change. Removing them from
one team keeps their login while they're still on another.

## Where a team's settings live

Everything that differs between teams is in the team's row in the `teams` table:

- `team_group`: `main` or `youth`
- `kind`: `worship` or `media` (which login page and interface it uses)
- `permission_ceiling`: the most anyone on the team can do (set on the Teams page)
- `config` (JSON): how the team works:

| Key                   | What it does                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sessionKinds`        | The regular sessions a new roster starts with, from the session catalogue. Empty: rosters start empty. Main Media: EM Sunday Service and EM Prayer & Praise. |
| `compositions`        | A team's own parts for its regular sessions, in place of the catalogue's band. Main Media: EM Sunday = 1 Media IC, 1 director, 1 video mixer, 2 roving cams, 1 wide angle cam, 1 close up cam, 1 projectionist, 1 lights; EM PnP = 1 projectionist, 1 lights. The session editor and roster grid show the team's roles ("Crew"), and the generator fills them. |
| `roles`               | What members can play or do on this team, from `ROLE_CATALOGUE` in `team-config.ts`: Main and Youth Worship have the band's instruments; Main Media has Media IC, wide angle, roving and close up cameras, director, video mixer, projectionist and lights; Youth Media has projectionist and soundboard. Media teams call them "roles". |
| `memberFields.ministry` | Members have an EM/CM share. Off: no EM/CM slider, badges, column or filter, and the roster generator ignores EM/CM.                                                                                   |
| `memberFields.serves` | Members choose Sunday services and/or P&P. Off: not shown or saved, and rosters ignore it.                                                                                                             |
| `memberFields.rules`  | Personal rules (parts someone plays but shouldn't be rostered for). On for Main Worship, Youth Worship and Main Media.                                                                                                       |
| `sessionsFrom`        | Media teams: the worship team (slug) whose sessions they work on. Stored for the media pages still to come; not used yet.                                                                              |

The app (`web/src/lib/team-config.ts`) and the roster generator (`worker/.../roster_service.py`)
both read this column, so there's one place to change. Nothing in the code checks a team's slug.

## Common changes

- **Add a role** (e.g. a new media job): add it to `ROLE_CATALOGUE` in `web/src/lib/team-config.ts`
  and to the `team_members_instruments_valid` check in a migration, then list it in the team's
  `roles`.

- **Change a team's settings**: write a migration that updates its `config`, like
  `supabase/migrations/20261116200000_team_config.sql`.
- **Add a kind of regular session** (e.g. a Friday youth service): add it to `SessionKind` and
  `SESSION_TYPES` in `web/src/lib/roster.ts` (name, who can serve, weight, band, schedule, start
  time, rehearsal), add it to the `roster_sessions` kind check in a migration, then list it in a
  team's `sessionKinds`.
- **New team**: create it on the Teams page. Pick its group and kind and it starts from the
  matching preset (`PRESETS` in `web/src/lib/team-config.ts`).
