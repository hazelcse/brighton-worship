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
| `DEV_EMAIL`, `DEV_PASSWORD`, `DEV_NAME` | optional developer account (root's powers + "View as") |
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
- Developer accounts (profiles.is_developer) have root's powers plus "View as" in the account menu
  (root or any permission group; a cookie the server only honours for developers). A badge next to
  the avatar shows the current view.
- Hand edits (root, drafts): on the generated page, click a cell (the whole cell, not a
  name) to change, add or remove who fills that part and who also does BL/TB. People already in the
  part are greyed out in the other pickers. If someone doing BL/TB leaves the part, it has to stay
  covered: ticked on someone in the part who can do it, or handed to a bandmate who can (checked
  again by editCell on the server). Generating saves a snapshot (rosters.generated_assignments); each edit
  is re-scored by the worker (POST /rosters/{id}/evaluate, same engine with the assignment
  pinned) and saved in rosters.check. Hard problems (empty places, wrong skill/ministry, clashes,
  broken hard rules) show in a red box that can't be closed and stays after publishing; soft
  warnings (score 5%+ worse, a soft rule missed more, more back-to-back weeks) can be closed.
  "Reset to generated" restores the snapshot.
- Session weight and band can be set per session, or for every session of one kind at once in
  the "Session defaults" popup on the planning page.
- Stops once within 2% of the best possible (usually a second or two).

## Team

The Team page is a gallery of every member (uid, name, instruments, EM/CM), filterable by
instrument. Only root can create, edit or delete members, and only root sees emails and the
**Manage permissions** button (`/team/permissions`). Names are unique; passwords live only in
Supabase Auth as a bcrypt hash.

Members were created from `members.json` (repo root; not committed):

```bash
cd web && npm run import-members
```

Re-running updates members by uid. Shared/placeholder emails get a unique
`…@placeholder.invalid` address, flagged on the card for root to replace.

Permission groups: **admin** (view, upload, edit, review and delete songs; transpose) and
**member** (view songs and transpose). Everyone starts as a member.

## Accounts and permissions

Modelled on AWS IAM:

- **Root**: exactly one user (`profiles.is_root`), always has every permission, can't be edited.
- **Permissions**: named strings like `songs.create`, listed in `public.permissions` and mirrored in
  `web/src/lib/permissions.ts`. Add new ones in a migration and in that file.
- **Security groups**: hold default permissions. `core` exists from the start with no permissions.
- **User overrides**: per user, *Allow* adds a permission, *Deny* removes it even if a group grants it.
- **Effective permissions** = group permissions + allows − denies (`public.effective_permissions`).

Rules enforced on the server (`web/src/app/(app)/admin/actions.ts`):

- Every write calls `requirePermission(...)` first.
- Non-root admins can only grant permissions they hold themselves, and can't edit their own access.
- Deactivating a user blocks them from logging in.
- Every admin change is written to `public.audit_log`.

Public sign-up is disabled. Accounts are created by root or anyone with `users.manage` under the
account menu → **Manage permissions** (root only).

## Deploying (later)

- Create a Supabase project, run `npx supabase link` then `npx supabase db push`.
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
  `db push`), then prod. Prod only gets migrations that already worked on staging.
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
