# Brighton Worship

Rostering, session planning and songsheets for the Brighton worship team.

```
worship/
├── web/                      Next.js 16 app (UI, server actions, permission checks)
├── worker/                   Python service in Docker: scans, transposes and previews songsheets,
│                             generates rosters, syncs songsheets from Google Drive
├── supabase/                 Database migrations + local Supabase config
└── members.json              Team list for importing members (not committed)
```

Three things run locally:

| What | Where | Started with |
|---|---|---|
| Supabase (database, logins, file storage) | Docker containers, http://127.0.0.1:54321 | `npx supabase start` |
| Songsheet worker | Docker container `worship-worker`, http://127.0.0.1:8000 | `docker start worship-worker` |
| Website | Node, http://localhost:3000 | `npm run dev` in `web/` |

## Run it locally from scratch

For a computer that has never run it: Docker Desktop closed, no containers, no env files.
Commands are run from the `worship` folder unless a step says otherwise. They work in PowerShell
and Git Bash; where they differ, both are given. In Windows PowerShell, type `curl.exe` wherever
it says `curl` (plain `curl` there is a different command).

### 1. Install the tools (once)

- **Docker Desktop**: https://www.docker.com/products/docker-desktop/
- **Node.js 20 or newer**: https://nodejs.org/ (includes `npm` and `npx`)
- **uv** (runs the worker's Python scripts and tests; it installs Python 3.13 itself):
  https://docs.astral.sh/uv/getting-started/installation/

Check them:

```bash
node --version
```

```bash
uv --version
```

### 2. Start Docker Desktop

Open Docker Desktop from the Start menu and wait until it says **Engine running** (the whale
icon in the taskbar stops animating). This checks it's ready:

```bash
docker info
```

If that prints an error about the Docker daemon or a pipe, Docker isn't running yet: wait and try
again.

### 3. Start Supabase

```bash
npx supabase start
```

The first time, this downloads Supabase's images (a few GB, several minutes). It then creates the
database and applies everything in `supabase/migrations`, including the private `songsheets`
storage bucket. When it finishes it prints the local URLs and keys; you need two of them in the
next step. To see them again later:

```bash
npx supabase status
```

- **anon key** (also called "publishable"): goes in `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role key** (also called "secret"): goes in `SUPABASE_SERVICE_ROLE_KEY`

Supabase Studio (a database browser) is then at http://127.0.0.1:54323.

### 4. Create the env files

```bash
cp web/.env.example web/.env.local
```

```bash
cp worker/.env.example worker/.env
```

Make one random token that the website and the worker share:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Fill in **`web/.env.local`**:

| Setting | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | leave as `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key from step 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key from step 3 |
| `ROOT_EMAIL`, `ROOT_PASSWORD`, `ROOT_NAME` | the root (owner) account to create |
| `DEV_EMAIL`, `DEV_PASSWORD`, `DEV_NAME` | optional developer account (root's powers + "View or act as") |
| `WORKER_URL` | leave as `http://127.0.0.1:8000` |
| `WORKER_TOKEN` | the token you just made |
| `DEFAULT_MEMBER_PASSWORD` | the password every imported member starts with |

Fill in **`worker/.env`**:

| Setting | Value |
|---|---|
| `SUPABASE_URL` | leave as `http://127.0.0.1:54321` (the container is pointed elsewhere in step 6) |
| `SUPABASE_SERVICE_ROLE_KEY` | the same service_role key |
| `WORKER_TOKEN` | the same token as in `web/.env.local` |
| `DRIVE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_FILE`, `DRIVE_SYNC_MINUTES` | only for the Google Drive sync, see step 5 |

### 5. Google Drive sync (optional)

Skip this to run without it; the "Sync from Drive" button on the Songs page is then hidden. To use
it, put the service account's JSON key at `worker/secrets/google-service-account.json` and add to
`worker/.env`:

```
DRIVE_FOLDER_ID=<the id at the end of the shared folder's URL>
GOOGLE_SERVICE_ACCOUNT_FILE=secrets/google-service-account.json
DRIVE_SYNC_MINUTES=10
```

`DRIVE_SYNC_MINUTES=0` means it only syncs when someone presses the button. Setting up the Google
side (project, service account, sharing the folder) is in [Google Drive](#google-drive-songsheet-library-sync).

### 6. Build and start the worker

Build the image. The first build takes several minutes (it installs LibreOffice and fonts):

```bash
docker build -t worship-worker worker
```

Start it. It talks to Supabase on your computer through `host.docker.internal`, and reads the
Google key from `worker/secrets`.

PowerShell:

```powershell
docker run -d --name worship-worker --restart unless-stopped -p 8000:8000 --env-file worker/.env -e SUPABASE_URL=http://host.docker.internal:54321 --add-host host.docker.internal:host-gateway -v "${PWD}\worker\secrets:/app/secrets:ro" worship-worker
```

Git Bash (the `MSYS_NO_PATHCONV=1` stops Git Bash rewriting the folder path, which would leave the
worker without the Google key and hide the Drive button):

```bash
MSYS_NO_PATHCONV=1 docker run -d --name worship-worker --restart unless-stopped -p 8000:8000 --env-file worker/.env -e SUPABASE_URL=http://host.docker.internal:54321 --add-host host.docker.internal:host-gateway -v "$(pwd -W)/worker/secrets:/app/secrets:ro" worship-worker
```

(On a Mac or Linux, use the Git Bash line without `MSYS_NO_PATHCONV=1` and with `$PWD` instead of
`$(pwd -W)`.)

Check it's up. It should print `{"ok":true,"scanner_version":2}`:

```bash
curl http://127.0.0.1:8000/health
```

### 7. Install the website and create accounts

```bash
cd web
```

```bash
npm install
```

Create the root account (from `ROOT_*` in `web/.env.local`):

```bash
npm run create-root
```

Optional: the developer account (from `DEV_*`):

```bash
npm run create-dev
```

Optional: the team, from `members.json` in the `worship` folder. Everyone starts on
`DEFAULT_MEMBER_PASSWORD` and must change it when they first log in:

```bash
npm run import-members
```

### 8. Add songsheets (optional)

The library starts empty. Either upload songsheets on the Songs page once the site is running, use
the Drive sync (step 5), or import a whole folder of `.docx` songsheets at once. Run these from the
`worker` folder; the import reads `worker/.env`, and the first run sets up Python for you:

```bash
cd worker
```

```bash
uv run python scripts/import_songsheets.py "path/to/your/songsheets"
```

Re-running is safe: songsheets already in the library are skipped. Each sheet's preview is made the
first time someone opens it. To make them all now instead (the worker must be running; use your
`WORKER_TOKEN`):

```bash
curl -X POST -H "Authorization: Bearer <WORKER_TOKEN>" http://127.0.0.1:8000/previews/backfill
```

### 9. Start the website

From the `web` folder:

```bash
npm run dev
```

Open http://localhost:3000 and log in with the root (or developer) account.

## Day to day

**Starting again** (after a restart, or with Docker Desktop closed):

1. Open Docker Desktop and wait for **Engine running**.
2. Start Supabase (your data is kept between restarts):

   ```bash
   npx supabase start
   ```

3. Start the worker. It was started with `--restart unless-stopped`, so it usually comes back by
   itself with Docker Desktop; this is harmless if it already has:

   ```bash
   docker start worship-worker
   ```

4. Start the website, from the `web` folder:

   ```bash
   npm run dev
   ```

**Stopping:** press Ctrl+C in the terminal running `npm run dev`, then:

```bash
npx supabase stop
```

```bash
docker stop worship-worker
```

**After pulling changes:**

- New files in `supabase/migrations`: apply them (keeps your data):

  ```bash
  npx supabase migration up
  ```

- Changes in `web/package.json`: run `npm install` in `web`.
- Changes in `worker/`: rebuild the image and recreate the container (step 6). Remove the old one
  first:

  ```bash
  docker rm -f worship-worker
  ```

**Starting the database over** (deletes all data, then re-applies every migration; afterwards
redo steps 7 and 8):

```bash
npx supabase db reset
```

## Troubleshooting

- **`docker` errors about the daemon or a pipe**: Docker Desktop isn't running (step 2).
- **"Port 3000 is in use" / the site opens on 3001**: another `npm run dev` is already running.
  Use that one, or close it.
- **"The songsheet worker isn't configured / isn't reachable"**: the worker isn't running
  (`docker ps` should list `worship-worker`), or `WORKER_TOKEN` differs between `web/.env.local`
  and `worker/.env`. See its log with `docker logs --tail 50 worship-worker`.
- **No "Sync from Drive" button on the Songs page**: the worker can't see the Drive settings.
  Check `DRIVE_FOLDER_ID` in `worker/.env`, and that the key is mounted:
  `docker exec worship-worker ls /app/secrets` should list `google-service-account.json`. If it
  doesn't, recreate the container with the step 6 command for your shell.
- **The worker can't reach the database**: `SUPABASE_URL` inside the container must be
  `http://host.docker.internal:54321` (step 6 sets it), not `127.0.0.1`.
- **Logging in fails straight after a reset**: `npx supabase db reset` deletes the accounts too;
  run `npm run create-root` again.

## Songsheet worker

Songsheets are **.docx only**, and each song has **one songsheet: its base copy**. Other keys
are generated by the transposer on demand. The one exception is session songsheets: when a
session plan is published, each song's sheet is made as a PDF in the session's key and kept
(`transposed/<sha256>/<key>.pdf`, listed in `transposed_songsheets`), so every session in that
key reuses it. A sheet already in the session's key is just its preview PDF.

The website sends every upload to the worker, which stores the file in the private
`songsheets` bucket, scans it and creates the song. Uploading a song that's already in the
library is refused with a link to it; to swap a song's sheet use **Replace** on the song page.
The same file is never stored or scanned twice (SHA-256), and anything stored but not yet
scanned is scanned the next time someone opens the song library.

**Transposer** (`worker/src/worship_worker/transpose.py`): picks a library song or an uploaded
sheet, works out its key, and writes a new .docx in the chosen key (or shifted by semitones):

- chords and slash bass notes are respelled for the new key (Bb not A# in C; F# in D, etc.)
- written keys are updated ("E Major", "Chorus (F# Major)", "(E-F#)" in the heading); keys the
  scanner found to be out of date are corrected; "Original Key" is left alone
- layout is kept: spacing is adjusted using real font widths, columns stay on their tab stops,
  and the chord box is widened (never over the lyrics) so no chord moves to the next line; as a
  last resort an overflowing line is set slightly smaller

**Confirmed keys**: if the scanner gets a key wrong, an editor can confirm or correct it on the
song's Songsheet card (start key, later key changes, keys the chart is also written out in).
A confirmed key is used everywhere (badge, filters, transposer), survives rescans, settles the
scanner's key warnings, and resets when the songsheet is replaced.

**Previews**: each songsheet gets a read-only preview (a PDF plus one image per page, so it
works on phones), made once when it's uploaded and stored under `previews/<sha256>/`. Shown on
the song page and from the eye button on each song card. LibreOffice is in the worker image only
for this. To make missing previews (e.g. after an import), call the worker's
`POST /previews/backfill`.

The worker image includes metric-compatible fonts (Liberation, Carlito, Caladea) so lines are
measured exactly as Word lays them out.

Running it, rebuilding it after code changes and importing songsheets are covered in
[Run it locally from scratch](#run-it-locally-from-scratch). Scanner tests:
`cd worker && uv run pytest`.

## Roster

**Roster page**: this quarter's published roster, Updates (top) and Requests (bottom). Admins
(`roster.edit`) get **View past rosters** and **+ New roster**.

**Planning** (`/roster/<id>/plan`): pick a quarter and every EM/CM Sunday service (weight 1) and
EM/CM Prayer & Praise (4th Thu / 4th Wed, weight 0.6) is added. Edit or remove weeks, add one-off
sessions with their own band and EM/CM restriction, manage the shared rule library, then generate.

**Engine** (`worker/src/worship_worker/roster_engine.py`): an integer linear programme solved with
OR-Tools CP-SAT. One yes/no variable per person × session × role they can do.
- Built-in hard: fill every place; one main role per person per session (WL and vocalists are
  different people); band leader / talkback (one job, one person) only for someone playing an instrument there; at most
  one session per person per date.
- User rules: how often (per month/quarter; a person's own rule overrides group rules for the same
  period), same date, breaks between services, must/must-not serve on a date. Hard rules and
  unfillable places are penalised so heavily they're only broken when impossible, and then
  reported as "impossible" with the reason.
- Built-in soft: share the load fairly (sum of squared loads), worked out separately for main
  services and for P&Ps (sessions of kind `*_pnp`; custom sessions count as main services), so
  nobody does only P&Ps. Its weight is the permanent "Share the load fairly" rule. Also split
  EM/CM for people who serve both by their EM percentage (uses weighted load across everything).
- Rules are either Default (roster_id null: used by every roster, including new ones) or for
  one roster only. Tick "Default rule" in the rule form, or click the badge on a rule, to switch.
  The permanent fairness rule is always a default.
- Built-in soft: space out each person's services (permanent "Space out services" rule; root sets
  the weight, 0 switches it off). Any extra service inside a 1-, 2- or 3-week window costs, so
  back-to-back weeks cost the most. The generated page reports back-to-back and 2-week pairs.
- Each member serves at Sunday services and P&P by default; root can set "Sunday services only"
  or "P&P only" on the member's page (profiles.serves). The roster only uses them there.
- "Serve less": on the "Share the load fairly" rule, root can give members a share below 1
  (params.reduced). Their squared load costs 1/share^2 as much, so 0.5 is about half as often.
- Team → member page shows admins the roster rules that single that member out (personal,
  ministry group, instrument, exceptions, serve less), with whether each is a default.
- Built-in soft: mix up the teams (permanent "Mix up the teams" rule). Counting every pair of
  people in every session makes the model too slow to solve in one go, so it runs as a second
  pass: keep the main score within 5% x weight of the first answer, start from it, and spend up to
  20s cutting repeat pairings. Scoring a hand-edited roster just counts the repeats.
- Built-in soft: balance the singers (permanent "Balance the singers" rule, default weight 0.5).
  In each band with 2+ singers (WL + vocalists), at most half of them (rounded up) should be one
  gender, from the member's gender; unset counts for neither side. Each extra singer of one gender
  is one miss. Unlike the other permanent rules it's listed with the soft rules on the generated
  page, so clicking its badge highlights the singers in unbalanced bands.
- Each team has its own permanent rules. The worship teams have all five; the media teams (Main
  and Youth Media) have the three that suit a crew: share the load fairly, space out services and
  mix up the teams (singer balance and band leader backup are band-only). Media crews fill any
  media role in a session's parts (worker `MEDIA_ROLES`), and get no rehearsal dates.
- Developer accounts (profiles.is_developer) have root's powers plus "View as" in the account menu
  (a button in the media app's header): pick Main/Youth, then one of that group's teams (a
  dropdown, so new teams appear on their own), and a Standard (their own full access) or Observer
  account, in any combination, or act as one person, whose identity it then uses. Choices are a
  draft until Apply is pressed. An observer view starts from the group's real observer settings (managing
  permissions, seeing absences), which "Can" toggles change for that view only (the observer
  account isn't touched), and, like a real observer, always gets the worship app's pages. The account
  type is a cookie the server only honours for developers. A badge next to the avatar shows the
  current view.
- Hand edits (root, drafts): on the generated page, click a cell (the whole cell, not a
  name) to change, add or remove who fills that part and who also does BL/TB. People already in the
  part are greyed out in the other pickers. If someone doing BL/TB leaves the part, it has to stay
  covered: ticked on someone in the part who can do it, or handed to a bandmate who can (checked
  again by editCell on the server). Generating saves a snapshot (rosters.generated_assignments); each edit
  is checked by the worker for hard problems only (POST /rosters/{id}/evaluate, same engine with
  the assignment pinned and only hard rules, about 0.2s; no re-scoring of soft rules, fairness or
  spacing) and saved in rosters.check. Hard problems (empty places, wrong skill/ministry, clashes,
  broken hard rules) show in a red box that can't be closed and stays after publishing. More people
  in a part than it needs isn't flagged. The side panels' soft results stay as generated.
  "Reset to generated" restores the snapshot.
- Session weight and band can be set per session, or for every session of one kind at once in
  the "Session defaults" popup on the planning page.
- Stops once within 2% of the best possible (usually a second or two).

## Team

The Team page is a gallery of the current team's members (uid, name, instruments or roles, EM/CM),
filterable by instrument. Only the team's lead (and root and developers, who have lead powers in
every team) can add, edit, link or remove members and reset passwords, and only they see emails,
permission groups and the **Manage permissions** button (`/team/permissions`). Names are unique;
passwords live only in Supabase Auth as a bcrypt hash. Teams, linking someone onto a second team
and observers are covered in [TEAMS.md](TEAMS.md).

Members can be imported from `members.json` (repo root; not committed) into Main Worship, or into
another team with `TEAM=<slug>`:

```bash
cd web && npm run import-members
```

Re-running updates members by uid. New members join the team's **member** permission group.
Shared/placeholder emails get a unique `…@placeholder.invalid` address, flagged on the card for
the lead to replace.

## Accounts and permissions

Modelled on AWS IAM, per team (code: `web/src/lib/auth.ts`; full detail in [TEAMS.md](TEAMS.md)).

**Accounts** (`profiles`):

- **Root**: exactly one account (`profiles.is_root`, `npm run create-root`), on no team. It has the
  lead's powers in every team, creates and edits teams, sets each team's maximum permissions,
  chooses a team's lead and creates observers. It can't be denied anything. From either login
  title it lands on **Brighton Serving**, its own view outside every team, which draws on all of
  them (worship and media): Home, Roster, Absences, Services, Tracking and the inbox cover every
  team. To work in one team (its members, permissions, rosters) it opens it from Team; the bar then
  shows "Root · team name", and the name "Brighton Serving" (or "Back to Brighton Serving" in the
  profile menu) leaves it. A page about one team opened with no team chosen asks which team.
- **Developer** (`profiles.is_developer`, `npm run create-dev`): on no team, root's powers plus
  **View or act as** (see the Roster section).
- **Observer** (`profiles.observer_group`, one each for Main and Youth): on no team, read-only
  over its group's teams. Root can let it see absences and manage permissions. Like root, it lands
  on Brighton Serving (limited to its group) and opens one of its group's teams to look inside it.
- **Members**: everyone else, on one or more teams (`team_members`), with a separate profile and
  separate permissions on each team.

**Within a team:**

- **Lead** (`team_members.is_lead`, at most one per team): every permission the team may have,
  and the only member who can manage members and permissions. Root, developers or a
  permission-managing observer can deny the lead permissions.
- **Permissions**: named strings like `songs.create`, listed in `public.permissions` and mirrored in
  `web/src/lib/permissions.ts`. Add new ones in a migration and in that file.
- **Permission groups**: belong to one team and hold its default permissions. Every team has a
  **member** group; Main Worship also has **admin**.
- **User overrides**: per person per team, *Allow* adds a permission and *Deny* removes it, even
  if a group grants it.
- **Team ceiling** (`teams.permission_ceiling`): the most anyone on the team can have, the lead
  included (null = every permission).
- **Effective permissions** = (group permissions + allows − denies), capped by the ceiling
  (`public.team_permissions`).

Some access comes from serving rather than permissions: a session's confirmed worship leaders
edit its plan, and everyone serving on it sees the plan once it's published (`sessionAccess` in
`web/src/lib/sessions.ts`).

Rules enforced on the server (`web/src/lib/auth.ts`, `web/src/app/(app)/team/permissions/actions.ts`):

- Every write calls `requirePermission(...)`, `requireLead()`, `requirePermissionsManager()` or
  `requireRoot()` first.
- Anyone other than the lead (or a permission-managing observer) can only grant permissions they
  hold themselves, and can't edit their own access.
- Handing over the lead needs the current lead's (or root's) password.
- Deactivating a user blocks them from logging in.
- Every access change is written to `public.audit_log`.

Public sign-up is disabled. Members are added by their team's lead (Team page or **Manage
permissions**); root creates teams and observers on the Teams page.

## Notifications

Everything is in-app: there are no emails or push notifications. Each user sees only what
belongs to the team they're signed into. The worship app has five places notifications show up;
media teams share the nav bar, so they get the roster Inbox (Main Media also has the Roster and Absences pages); the rest are worship-only for now.

| Where | What it is | Code |
|---|---|---|
| **Inbox** (nav, left of the account icon) | Roster updates from the last 14 days, with an unread count. Opening it marks them all read (`profiles.updates_seen_at`). | `loadUpdates` in `web/src/lib/serving.ts`, `components/inbox.tsx` |
| **Notices box** (home page) | Things to act on: plans to publish, sessions to confirm, plans published, band changes. | `app/(app)/home/page.tsx` |
| **Broadcasts** (home page) | Messages from the team's lead. | `web/src/lib/broadcasts.ts` |
| **Requests / Actionables** (Roster page) | Requests waiting on the viewer. | `loadRequestsBoard` in `web/src/lib/serving.ts` |
| **Nav badges** | Counts on **Songs** (new song library updates) and **Sessions** (plans published, plans due). | `app/(app)/layout.tsx` |

### Inbox: roster updates

Saved as rows in `roster_updates`. Who sees each kind (`updatesFor` in `serving.ts`):

| Update | Logged when | Member (not lead) sees it if… | Team lead | Root |
|---|---|---|---|---|
| `declined`: "X cannot serve …" | Someone says they can't serve, adds an absence that clashes, or is away for a moved rehearsal | They made it, or they're in that session's band. The reason is shown only to the person and the lead. | Yes, with reason | Yes, with reason |
| `asked`, `refused`, `cancelled`: asking someone to cover, turning it down, withdrawing | A cover request is sent, refused or withdrawn | They're the asker or the person asked | Yes | Yes |
| `taken`: "X took over … from Y" | A cover is accepted | Involved, or in that session's band | Yes | Yes |
| `swap_proposed`, `swap_declined` | A swap is offered or turned down | They're one of the two people | Only if one of the two | No |
| `swapped` | A swap is accepted | Involved, or in the band of either session | Yes | No |
| `band_role_asked`, `band_role_refused`: band leader / talkback handover | A bandmate is asked to take over BL/TB, or says no | They're one of the two people | Yes | Yes |
| `band_role_taken` | A BL/TB handover is accepted | Involved, or in that session's band | Yes | Yes |
| `band_role_missing`: "… has no band leader" | Someone steps out and nobody left in the band can do their BL/TB | They caused it, or they're in the team's **admin** group | Yes | Yes |
| `session_updated`: "Session for … has been updated" | A published session plan is published again with changes | They're in that session's band | Yes | Yes |
| `roster_added`, `roster_removed`, `roster_part_changed`, `roster_session_changed` | An edited roster is republished | It's about them | Yes, folded into one "changed the band" line per session | Yes, as for the lead |
| `roster_band_changed`: "X changed the band for …" | An edited roster is republished | They're in the band whose line-up changed (not whoever made the edit) | Only for their own band | Only for its own band |
| `member_added`, `member_removed` | A lead adds or removes someone (on any team) | No | No | Yes, from every team |

Nobody's inbox counts their own actions as unread. Developers see what a lead sees, or what the
person they're acting as sees. Observers have no inbox, and neither does anyone without
`roster.view`.

### Home page notices

The box under the countdown, refreshed every 30 seconds. Top to bottom:

- **Not confirmed yet**: their next session is still waiting for "I can serve" (link to their
  requests).
- **Plan due**: a session they're a confirmed worship leader of is two weeks away or less and its
  plan isn't published (`loadPublishDue`). It stays until the plan is published.
- **Plan published / updated**: a session they're rostered on had its plan published, or
  published again, by someone else since they last opened Sessions (`loadNewlyPublished`,
  `profiles.sessions_seen_at`). If they haven't confirmed yet, it sends them to confirm first.
- **Band changes**: someone else changed the band of an upcoming session they're on (added,
  removed, part changed, cover taken, swap, BL/TB taken over). Shown on **one visit only**
  (`profiles.home_band_seen_at`), with a link to the inbox.

Observers' home pages show their group's services instead, with no notices or broadcasts. Root's
home page shows the services plus its own notices and broadcasts.

### Broadcasts

A team's lead (or root, or a developer, in that team) sends a message from the Roster page's **New** menu
to everyone on the team. It shows at the top of each member's home page until they dismiss it. If it
**requires acknowledgement**, it can only be closed by ticking the acknowledgement, and the lead
sees who has and hasn't acknowledged under **Actionables** on the Roster page. The sender doesn't
receive their own broadcast. Developers don't receive broadcasts unless they're acting as someone.

### Requests board (Roster page)

Called **Requests** for members and **Actionables** for the lead. It lists only what's waiting on
the viewer:

- sessions on a newly published roster they haven't confirmed ("I can serve" / can't)
- people asking them directly to cover a session, and swap proposals with them
- bandmates asking them to take over band leader / talkback
- their own requests still waiting, or turned down
- sessions they're rostered on while away, with nobody asked to cover yet

A request only appears for the person it's addressed to. Leads also see the broadcast
acknowledgement lists here.

### Nav badges

- **Songs**: new song library events from the last 60 days that the user hasn't seen
  (`profiles.song_updates_seen_at`). Which events depends on permissions (`updateKindsFor` in
  `web/src/lib/song-updates.ts`):
  - `songs.library_updates`: new songs, re-uploaded songsheets, scanner issues, songsheets missing
    from Drive.
  - `songs.issue_reports`: issues someone raises on a song.

  Issue events drop out once someone marks the song as reviewed. By default only Main Worship's
  **admin** group has these two permissions (and leads, root and developers get everything their
  team allows).
- **Sessions**: plans published for them to see plus their own plans due (the same items as the
  home page notices).

- Create a Supabase project, run `npx supabase link` then `npx supabase db push --remote` (without `--remote` the CLI targets your local database). Full steps: [documentation/DEPLOY.md](documentation/DEPLOY.md).
- Deploy `web/` to Vercel with the same env vars (service-role key as a secret, never `NEXT_PUBLIC_`).
  Vercel caps each request at 4.5 MB, so the upload dialog sends songsheets one file per request
  and refuses files over 4 MB.
- Deploy the worker (e.g. Railway, from `worker/Dockerfile`) with `SUPABASE_URL` set to the hosted
  project, its own `WORKER_TOKEN`, and the Drive key in `GOOGLE_SERVICE_ACCOUNT_JSON`.
- In Supabase → Authentication, turn off sign-ups and set the site URL to the live domain.

### Environments: dev, staging, prod

Only **dev** exists today (everything local). Staging is optional for a team this size; local dev
plus prod is a reasonable minimum.

| | Dev | Staging (optional) | Prod |
|---|---|---|---|
| Purpose | Building and breaking things | Final check before release | The worship team's real data |
| Supabase | `npx supabase start` (`127.0.0.1:54321`) | Own hosted Supabase project | Own hosted Supabase project |
| Web | `npm run dev` | Vercel preview / staging deployment | Vercel production deployment |
| Worker | Local `worship-worker` container | Hosted container, own `WORKER_TOKEN` | Hosted container, own `WORKER_TOKEN` |
| Env vars | `web/.env.local`, `worker/.env` | Set in Vercel / host (staging keys) | Set in Vercel / host (prod keys) |
| Songsheets | Test sheets in local bucket | Test sheets or a test Drive folder | Real Drive folder via service account |
| Accounts | `members.json` (throwaway), `npm run create-dev` | Test accounts | Real members; sign-up off; site URL set |

Rules:

- Never point staging at the prod Supabase project. Use different `SUPABASE_SERVICE_ROLE_KEY`,
  `WORKER_TOKEN` and `DEFAULT_MEMBER_PASSWORD` in every environment.
- Apply migrations in order: dev (`npx supabase db reset`), then staging (`npx supabase link` +
  `db push --remote`), then prod. Prod only gets migrations that already worked on staging.
- Keep the Google service-account key out of dev and staging, so a non-prod sync can't touch the
  real songsheets. Use a test Drive folder there.
- Don't run `npm run create-dev` in prod unless you want the hidden root-power dev account there.
- Only `NEXT_PUBLIC_*` values reach the browser; the service-role key stays server-only everywhere.


## Google Drive (songsheet library sync)

One way: the shared Drive folder is the source; the library follows it.

1. Google Cloud project with the **Google Drive API** enabled, and a **service account**.
2. Save its JSON key as `worker/secrets/google-service-account.json` (git-ignored; mounted into
   the worker container read-only by the `docker run` line in step 6 of the setup).
3. Share the songsheet folder with the service account's email as **Editor**. Viewer is enough
   for syncing, but replacing a song's sheet in the app also writes the new file back over the
   song's Drive file, and that needs Editor.
4. In `worker/.env`: `DRIVE_FOLDER_ID` (from the folder URL), `GOOGLE_SERVICE_ACCOUNT_FILE`
   (default `secrets/google-service-account.json`) and `DRIVE_SYNC_MINUTES` (0 = button only).
   On a host that can't hold the key as a file (e.g. Railway), paste the key file's whole contents
   into `GOOGLE_SERVICE_ACCOUNT_JSON` instead; when set, it's used instead of the file.

Each sync looks at every `.docx` and Google Doc in the folder and its subfolders:
unchanged files are skipped; new ones are stored and scanned like uploads; changed ones replace
their song's sheet; a file whose title matches a song uploaded by hand replaces that song's
sheet; files gone from Drive are marked "removed" in `drive_files` (the song is kept). Runs are
logged in `drive_sync_runs`. "Sync from Drive" on the Songs page runs one now.
