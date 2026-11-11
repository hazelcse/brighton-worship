# Running Brighton Worship on your own computer

This guide sets the whole app up **locally**, on one Windows or macOS computer. Nothing here
deploys anything to the internet: your copy has its own database, its own accounts and its own
songsheet library. The one exception is the optional Google Drive sync, which reads from (and can
write to) the team's shared songsheet folder; see [step 4.5](#45-optional-set-up-google-drive-sync).

- [1. What you are setting up](#1-what-you-are-setting-up)
- [2. What you need before you start](#2-what-you-need-before-you-start)
- [3. What to download](#3-what-to-download)
- [4. First-time setup, step by step](#4-first-time-setup-step-by-step)
- [5. Running it again after the first time](#5-running-it-again-after-the-first-time)
- [6. Troubleshooting](#6-troubleshooting)

**How to read the commands.** Every command is run from the `worship` folder (the one holding
`web`, `worker` and `supabase`) unless the step says otherwise.

- **PowerShell** = Windows PowerShell or Windows Terminal on Windows.
- **Bash** = the Terminal app on macOS (zsh is fine too), or Git Bash on Windows. Where Git Bash
  on Windows needs something different from macOS, both are shown.
- When a command is the same everywhere it is shown once, as `bash`, and works in PowerShell too.

---

## 1. What you are setting up

Brighton Worship is a web app for a church worship team: rostering (who plays when), session
planning, and a library of songsheets (Word `.docx` chord charts) that it can scan, transpose to
another key and preview.

Locally it is **three things running side by side**:

| Part | What it does | Runs as | Address |
|---|---|---|---|
| **Supabase** | The database (Postgres), logins, and file storage for songsheets | About a dozen Docker containers, managed by the Supabase CLI | API: http://127.0.0.1:54321 · Studio (database browser): http://127.0.0.1:54323 |
| **Songsheet worker** (`worship-worker`) | A Python service that scans, transposes and previews songsheets, generates rosters, and (optionally) syncs songsheets from Google Drive | One Docker container you build from the `worker` folder | http://127.0.0.1:8000 |
| **Website** | The Next.js app you use in the browser | `npm run dev` in the `web` folder (Node.js, not Docker) | http://localhost:3000 |

How they talk to each other:

```
 Browser ──▶ Website (localhost:3000) ──▶ Supabase (127.0.0.1:54321)
                     │                          ▲
                     └──▶ Worker (127.0.0.1:8000) ┘  (the worker reaches Supabase through
                                                     host.docker.internal:54321)
```

The folders:

```
worship/
├── web/          The website (Next.js). Settings go in web/.env.local
├── worker/       The songsheet worker (Python, built into a Docker image). Settings go in worker/.env
│   └── secrets/  Google service-account key, only if you use the Drive sync (never committed)
├── supabase/     Database structure (migrations) and local Supabase settings
└── documentation/
```

---

## 2. What you need before you start

### A computer that can run Docker

- **Windows 10/11** (64-bit) with virtualisation turned on, or **macOS** (Intel or Apple Silicon).
- **About 10 GB of free disk space.** Supabase's images are a few GB, and the worker image is
  large because it contains LibreOffice and Chinese/English fonts.
- **8 GB of RAM or more** is comfortable.
- These ports free on your computer: **3000**, **8000**, and **54320–54329**.

### Files you create yourself

None of these come with the code (they hold secrets, so they are git-ignored). You make them
during setup.

#### `web/.env.local` (settings for the website) — required

Made by copying `web/.env.example`.

| Setting | What it is | Where the value comes from |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Address of your local Supabase | Leave as `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase's public key (safe for the browser) | Printed by `npx supabase start` as **anon** / **publishable** key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase's admin key. **Server-only, keep private** | Printed by `npx supabase start` as **service_role** / **secret** key |
| `ROOT_EMAIL` | Email of the owner ("root") account | You choose. It doesn't need to be real; nothing is emailed |
| `ROOT_PASSWORD` | Password for the root account | You choose |
| `ROOT_NAME` | Display name for the root account | You choose |
| `DEV_EMAIL`, `DEV_PASSWORD`, `DEV_NAME` | Optional developer account: root's powers plus a "View or act as" switch for seeing the app as other roles or acting as one person | You choose, or leave blank to skip |
| `WORKER_URL` | Where the website finds the worker | Leave as `http://127.0.0.1:8000` |
| `WORKER_TOKEN` | A shared password between the website and the worker | A random string you generate (step 4.6). Must match `worker/.env` |
| `DEFAULT_MEMBER_PASSWORD` | The password every imported team member starts with (they must change it on first login) | You choose |

#### `worker/.env` (settings for the worker) — required

Made by copying `worker/.env.example`.

| Setting | What it is | Where the value comes from |
|---|---|---|
| `SUPABASE_URL` | Address of Supabase | Leave as `http://127.0.0.1:54321`. (The Docker container is given a different address on the command line; this value is used by the import scripts you run outside Docker) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase's admin key | The **same** service_role key as in `web/.env.local` |
| `WORKER_TOKEN` | Shared password with the website | The **same** token as in `web/.env.local` |
| `DRIVE_FOLDER_ID` | *Optional.* The Google Drive folder to sync songsheets from | The long ID at the end of the folder's URL, e.g. `https://drive.google.com/drive/folders/`**`1AbC...xyz`** (ask Hazel) |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | *Optional.* Path to the Google key file | `secrets/google-service-account.json` (ask Hazel) |
| `DRIVE_SYNC_MINUTES` | *Optional.* How often to sync automatically | A number of minutes, e.g. `10`. `0` = only when you press the button |

#### `worker/secrets/google-service-account.json` — optional (Drive sync only)

The key for the service account that can read the team's shared songsheet folder on Google Drive.
Get it, and the folder ID, from Hazel (don't create your own folder or service account). Without
it the app works fully; only the **Sync from Drive** button on the Songs page is hidden. Where to
put it is in [step 4.5](#45-optional-set-up-google-drive-sync).

> This key gives access to the team's real songsheets. Keep it private: don't send it on, and
> never commit it (`worker/secrets/` is git-ignored, but it would still end up in a zip of the
> folder).

#### `members.json` — optional (team list)

The team list, used to create everyone's accounts in one go. It is in the `resources` folder Hazel
gives you: copy `members.json` from there into the `worship` folder (next to `web` and `worker`).
Passwords in it are ignored; every account starts on `DEFAULT_MEMBER_PASSWORD`.

#### Songsheets — optional

`.docx` chord charts to load into the library. The team's songsheets are **not** part of the code:
use the Drive sync, upload sheets in the app, or import a folder of your own `.docx` files.

---

## 3. What to download

| Tool | Why | Windows | macOS |
|---|---|---|---|
| **Git** | To get the code | https://git-scm.com/download/win (also gives you Git Bash) | Run `xcode-select --install` in Terminal, or https://git-scm.com/download/mac |
| **Docker Desktop** | Runs Supabase and the worker | https://www.docker.com/products/docker-desktop/ (needs WSL 2, see below) | https://www.docker.com/products/docker-desktop/ (pick **Apple Silicon** or **Intel** to match your Mac) |
| **Node.js 20 LTS or newer** | Runs the website; includes `npm` and `npx` | https://nodejs.org/ (LTS installer) | https://nodejs.org/ (LTS installer) |
| **uv** *(optional)* | Runs the worker's Python scripts (bulk songsheet import, tests). Installs Python 3.13 by itself | https://docs.astral.sh/uv/getting-started/installation/ | https://docs.astral.sh/uv/getting-started/installation/ |
| A code editor *(optional)* | For editing the env files | https://code.visualstudio.com/ | https://code.visualstudio.com/ |

You do **not** need to install Python, Postgres or the Supabase CLI yourself: Python lives inside
the worker image (and uv fetches its own), Postgres runs inside Supabase's containers, and the
Supabase CLI is fetched by `npx` the first time you use it.

**Windows only, WSL 2:** Docker Desktop needs the Windows Subsystem for Linux. The Docker
installer usually sets it up; if it asks you to, open PowerShell **as Administrator** and run the
command below, then restart your computer:

```powershell
wsl --install
```

**Installing uv from the command line** (instead of the website):

PowerShell:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Bash (macOS):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Close and reopen your terminal after installing anything, so it picks up the new commands.

---

## 4. First-time setup, step by step

### 4.1 Check the tools are installed

```bash
git --version
```

```bash
node --version
```

This should print `v20` or higher.

```bash
docker --version
```

```bash
uv --version
```

(Only needed if you installed uv.)

### 4.2 Get the code

Clone the repository (use the link the project owner gave you), then go into the folder:

```bash
git clone <repository-link> worship
```

```bash
cd worship
```

If you were given a zip instead, unzip it and open a terminal in the `worship` folder.

### 4.3 Start Docker Desktop

Open **Docker Desktop** (Start menu on Windows, Applications on macOS). The first time, accept its
terms and skip signing in if you like. Wait until it shows **Engine running**. Check it from the
terminal:

```bash
docker info
```

If this prints an error mentioning the Docker daemon, `docker_engine` or a pipe, Docker isn't
ready yet. Wait a little and try again.

### 4.4 Start Supabase (the database)

```bash
npx supabase start
```

- The first time, `npx` asks `Ok to proceed? (y)` to download the Supabase CLI: type `y`.
- It then downloads Supabase's Docker images (a few GB, several minutes the first time), creates
  the database and applies everything in `supabase/migrations`, including the private
  `songsheets` storage bucket.

When it finishes it prints a block of URLs and keys. **Keep this terminal output open**; you need
two of the keys next:

- **anon key** (newer CLI versions call it **Publishable key**)
- **service_role key** (newer CLI versions call it **Secret key**)

To print them again at any time:

```bash
npx supabase status
```

You can now open Supabase Studio, a database browser, at http://127.0.0.1:54323.

### 4.5 (Optional) Set up Google Drive sync

Skip this if you don't want the Drive sync. Otherwise, get the `.json` key file and the Drive
folder ID from Hazel, then:

1. Make the `worker/secrets` folder:

   PowerShell:

   ```powershell
   New-Item -ItemType Directory -Force worker\secrets
   ```

   Bash:

   ```bash
   mkdir -p worker/secrets
   ```

2. Put the key file in it, named exactly `google-service-account.json`, so it is at
   `worship/worker/secrets/google-service-account.json`.
3. Keep the folder ID for `worker/.env` in the next step.

> **The sync uses the team's real Drive folder.** Syncing only reads from it, but **replacing a
> song's songsheet in the app writes the new file back over that song's file in Drive**. While
> Drive sync is set up, only use **Replace** if you mean to change the real songsheet. Uploading
> new songs, transposing and previews don't touch Drive.

### 4.6 Create the env files

Create the `worker/secrets` folder if you didn't in step 4.5 (the worker container expects it,
even if it stays empty):

PowerShell:

```powershell
New-Item -ItemType Directory -Force worker\secrets
```

Bash:

```bash
mkdir -p worker/secrets
```

Copy the two example files:

PowerShell:

```powershell
Copy-Item web\.env.example web\.env.local
```

```powershell
Copy-Item worker\.env.example worker\.env
```

Bash:

```bash
cp web/.env.example web/.env.local
```

```bash
cp worker/.env.example worker/.env
```

Generate a random worker token (works in both shells). Copy what it prints:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Open the files in a text editor and fill them in. Note: the files start with a dot, so on macOS
Finder hides them; press **Cmd+Shift+.** to show hidden files, or open the folder in VS Code.

PowerShell:

```powershell
notepad web\.env.local
```

Bash (macOS):

```bash
open -e web/.env.local
```

**`web/.env.local`** should end up like this (your keys and token will differ):

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key from step 4.4>
SUPABASE_SERVICE_ROLE_KEY=<service_role / secret key from step 4.4>

ROOT_EMAIL=root@example.com
ROOT_PASSWORD=<a password you choose>
ROOT_NAME=Root

DEV_EMAIL=dev@example.com
DEV_PASSWORD=<a password you choose>
DEV_NAME=Dev

WORKER_URL=http://127.0.0.1:8000
WORKER_TOKEN=<the token you generated>

DEFAULT_MEMBER_PASSWORD=<a starting password for team members>
```

**`worker/.env`**:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<the same service_role key>
WORKER_TOKEN=<the same token as in web/.env.local>
```

If you did step 4.5, add these three lines to `worker/.env` too:

```
DRIVE_FOLDER_ID=<the folder ID from Hazel>
GOOGLE_SERVICE_ACCOUNT_FILE=secrets/google-service-account.json
DRIVE_SYNC_MINUTES=10
```

Don't put quotes around the values, and don't leave spaces around `=`.

### 4.7 Build the worker image

The first build takes several minutes (it installs LibreOffice and fonts). Same in every shell:

```bash
docker build -t worship-worker worker
```

### 4.8 Start the worker container

This creates a container called `worship-worker` that starts again by itself whenever Docker
Desktop starts. It reaches Supabase on your computer through `host.docker.internal`, and reads
the Google key (if any) from `worker/secrets`. Pick the line for your shell; each is one single
line.

PowerShell (Windows):

```powershell
docker run -d --name worship-worker --restart unless-stopped -p 8000:8000 --env-file worker/.env -e SUPABASE_URL=http://host.docker.internal:54321 --add-host host.docker.internal:host-gateway -v "${PWD}\worker\secrets:/app/secrets:ro" worship-worker
```

Bash on macOS:

```bash
docker run -d --name worship-worker --restart unless-stopped -p 8000:8000 --env-file worker/.env -e SUPABASE_URL=http://host.docker.internal:54321 --add-host host.docker.internal:host-gateway -v "$PWD/worker/secrets:/app/secrets:ro" worship-worker
```

Git Bash on Windows (`MSYS_NO_PATHCONV=1` stops Git Bash from rewriting the folder path, which
would otherwise leave the worker without the Google key):

```bash
MSYS_NO_PATHCONV=1 docker run -d --name worship-worker --restart unless-stopped -p 8000:8000 --env-file worker/.env -e SUPABASE_URL=http://host.docker.internal:54321 --add-host host.docker.internal:host-gateway -v "$(pwd -W)/worker/secrets:/app/secrets:ro" worship-worker
```

Check it's up. It should print `{"ok":true,"scanner_version":2}`:

PowerShell (`curl.exe`, because plain `curl` in PowerShell is a different command):

```powershell
curl.exe http://127.0.0.1:8000/health
```

Bash:

```bash
curl http://127.0.0.1:8000/health
```

You can also just open http://127.0.0.1:8000/health in a browser.

### 4.9 Install the website and create accounts

Go into the `web` folder and install its packages (a minute or two):

```bash
cd web
```

```bash
npm install
```

Create the root (owner) account from `ROOT_*` in `web/.env.local`:

```bash
npm run create-root
```

Optional: create the developer account from `DEV_*`:

```bash
npm run create-dev
```

Optional: create the team from `members.json` (copied into the `worship` folder from the
`resources` folder, see [section 2](#membersjson--optional-team-list)). Everyone starts on
`DEFAULT_MEMBER_PASSWORD` and has to change it when they first log in:

```bash
npm run import-members
```

If your `members.json` is somewhere else, give its path after `--`:

```bash
npm run import-members -- path/to/members.json
```

### 4.10 (Optional) Load songsheets

The library starts empty. Three ways to fill it:

- **In the app:** once the site is running, upload `.docx` files on the **Songs** page.
- **Google Drive:** if you did step 4.5, press **Sync from Drive** on the Songs page.
- **A whole folder at once** (needs uv). From the `worship` folder, go into `worker` and point the
  import script at a folder of `.docx` files. The first run sets up Python for you:

  ```bash
  cd worker
  ```

  ```bash
  uv run python scripts/import_songsheets.py "path/to/your/songsheets"
  ```

  Re-running is safe: songsheets already in the library are skipped.

Each songsheet's preview is made the first time someone opens it. To make all of them now (the
worker must be running; replace `<WORKER_TOKEN>` with your token):

PowerShell:

```powershell
curl.exe -X POST -H "Authorization: Bearer <WORKER_TOKEN>" http://127.0.0.1:8000/previews/backfill
```

Bash:

```bash
curl -X POST -H "Authorization: Bearer <WORKER_TOKEN>" http://127.0.0.1:8000/previews/backfill
```

### 4.11 Start the website

From the `web` folder:

```bash
npm run dev
```

Leave this terminal open (the site stops when you close it). Open **http://localhost:3000** and log
in with the root email and password from `web/.env.local`.

Setup is done. 🎉

---

## 5. Running it again after the first time

Your database, accounts and songsheets are kept between restarts. You don't need to rebuild or
reinstall anything unless the code changed (see [After getting new code](#after-getting-new-code)).

### Starting up

1. **Open Docker Desktop** and wait for **Engine running**. Check with:

   ```bash
   docker info
   ```

2. **Start Supabase**, from the `worship` folder:

   ```bash
   npx supabase start
   ```

3. **Start the worker.** It usually comes back by itself with Docker Desktop; running this anyway
   is harmless:

   ```bash
   docker start worship-worker
   ```

4. **Start the website**, from the `web` folder:

   ```bash
   cd web
   ```

   ```bash
   npm run dev
   ```

5. Open **http://localhost:3000**.

To check what's running:

```bash
docker ps
```

You should see `worship-worker` and several containers whose names end in `_worship`
(Supabase's).

### Shutting down

1. In the terminal running `npm run dev`, press **Ctrl+C** (on macOS too, not Cmd+C).
2. From the `worship` folder, stop Supabase (your data is kept):

   ```bash
   npx supabase stop
   ```

3. Stop the worker:

   ```bash
   docker stop worship-worker
   ```

4. Quit Docker Desktop if you like.

### After getting new code

After `git pull` (or a new zip), check what changed and do only what applies:

- **New files in `supabase/migrations`:** apply them to your database (keeps your data). From the
  `worship` folder:

  ```bash
  npx supabase migration up
  ```

- **`web/package.json` changed:** reinstall the website's packages, from the `web` folder:

  ```bash
  npm install
  ```

- **Anything in `worker/` changed:** rebuild the image and recreate the container. From the
  `worship` folder, remove the old container:

  ```bash
  docker rm -f worship-worker
  ```

  Rebuild:

  ```bash
  docker build -t worship-worker worker
  ```

  Then run the `docker run` line for your shell from [step 4.8](#48-start-the-worker-container)
  again.

- **New settings in `web/.env.example` or `worker/.env.example`:** copy the new lines into your
  `web/.env.local` / `worker/.env` and fill them in. If you changed `worker/.env`, recreate the
  worker container (remove it and run step 4.8 again); it only reads that file when it's created.

### Starting the database from scratch

This **deletes everything** in your local database (accounts, songs, rosters) and rebuilds it
from the migrations. From the `worship` folder:

```bash
npx supabase db reset
```

Afterwards, redo [step 4.9](#49-install-the-website-and-create-accounts) (create-root and
friends) and, if you want songsheets, [step 4.10](#410-optional-load-songsheets).

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `docker` errors about the daemon, `docker_engine` or a pipe | Docker Desktop isn't running yet. Open it and wait for **Engine running** |
| PowerShell says *"running scripts is disabled on this system"* when you run `npm` or `npx` | Run `npm.cmd` / `npx.cmd` instead, or allow local scripts for your user once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `npx supabase start` says a port is already in use | Another Supabase project (or something else) is using ports 54320–54329. Stop it, e.g. `npx supabase stop --project-id <its id>`, or quit the other app |
| "Port 3000 is in use" / the site opens on port 3001 | Another `npm run dev` is already running. Use that one, or close its terminal |
| The app says the songsheet worker isn't configured or isn't reachable | Check `docker ps` lists `worship-worker`. Check `WORKER_TOKEN` is identical in `web/.env.local` and `worker/.env` (then recreate the container, step 4.8). See the worker's log: `docker logs --tail 50 worship-worker` |
| `docker run` says the name `worship-worker` is already in use | The container already exists. Start it with `docker start worship-worker`, or remove it with `docker rm -f worship-worker` and run step 4.8 again |
| The worker log shows it can't reach the database | Supabase isn't running (`npx supabase start`), or the container was started without `-e SUPABASE_URL=http://host.docker.internal:54321`. Recreate it with the step 4.8 line |
| No **Sync from Drive** button on the Songs page | Check `DRIVE_FOLDER_ID` is in `worker/.env`, then check the key is visible inside the container: `docker exec worship-worker ls /app/secrets` should list `google-service-account.json`. If not, recreate the container with the step 4.8 line for **your** shell |
| Drive sync runs but finds nothing, or fails | Check `DRIVE_FOLDER_ID` is exactly the ID Hazel gave you and the key file is the right one. If both are right, ask Hazel: the folder's sharing or the Google project may need fixing |
| Login fails right after `npx supabase db reset` | The reset deleted the accounts. Run `npm run create-root` again in `web` |
| `npm run create-root` says to set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`... | Run it from the `web` folder, and check `web/.env.local` exists (not `.env.local.txt`; Notepad can add `.txt`) and has those values |
| Changes to `worker/.env` have no effect | The container reads it only when created. `docker rm -f worship-worker`, then step 4.8 again |
| Docker is using too much disk | `docker system df` shows usage. Removing everything Supabase made (**deletes your data**): `npx supabase stop --no-backup` |

Useful addresses while it's running:

- Website: http://localhost:3000
- Supabase Studio (browse tables, users and storage): http://127.0.0.1:54323
- Worker health check: http://127.0.0.1:8000/health
