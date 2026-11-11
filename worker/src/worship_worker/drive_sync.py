"""Google Drive -> songsheet library sync (one way: Drive is the source, the app follows).

Setup (see README): a Google Cloud service account with the Drive API enabled, its JSON key at
GOOGLE_SERVICE_ACCOUNT_FILE (default: secrets/google-service-account.json) or pasted whole into
GOOGLE_SERVICE_ACCOUNT_JSON (hosted, e.g. Railway; wins when both are set), and the songsheet
folder shared with the service account's email. DRIVE_FOLDER_ID is the folder's id.

What a sync does, for every .docx and Google Doc in the folder (and its subfolders):
  * unchanged since last time            -> skipped
  * new                                   -> stored and scanned like an upload; becomes a song
                                             (or replaces the sheet of a song with the same title)
  * changed                               -> replaces the sheet of the song it became before
  * gone from the folder                  -> marked "removed" (the song is kept); a song with no
                                             file left in the folder is flagged "missing from Drive"

New songs, replaced sheets (edited in Drive, or deleted and added back with the same name, even
the very same file) and scanner issues are logged as song library updates (song_events).
"""

from __future__ import annotations

import io
import os
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from supabase import Client

from . import ingest

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
GDOC_MIME = "application/vnd.google-apps.document"
FOLDER_MIME = "application/vnd.google-apps.folder"
REUPLOAD_DAYS = 7  # a file deleted in Drive and added back within this many days counts as re-uploaded

_lock = threading.Lock()  # one sync at a time (manual and scheduled)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def running() -> bool:
    """Is a sync happening right now?"""
    return _lock.locked()


def configured() -> bool:
    return bool(os.environ.get("DRIVE_FOLDER_ID")) and (_key_json() is not None or _key_file().exists())


def _key_file() -> Path:
    return Path(os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "secrets/google-service-account.json"))


def _key_json() -> dict | None:
    """The key pasted whole into GOOGLE_SERVICE_ACCOUNT_JSON (for hosts that can't hold a file).

    Wins over GOOGLE_SERVICE_ACCOUNT_FILE when set.
    """
    import json

    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        return None
    try:
        info = json.loads(raw)
    except json.JSONDecodeError:
        print("GOOGLE_SERVICE_ACCOUNT_JSON isn't valid JSON; paste the whole key file's contents.", flush=True)
        return None
    return info if isinstance(info, dict) else None


def _drive():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    # Read the folder, and write back songsheets replaced in the app (see write_back).
    scopes = ["https://www.googleapis.com/auth/drive"]
    info = _key_json()
    if info is not None:
        creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
    else:
        creds = service_account.Credentials.from_service_account_file(str(_key_file()), scopes=scopes)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _list_folder(drive, folder_id: str) -> list[dict]:
    """Every .docx / Google Doc under the folder, including subfolders."""
    out: list[dict] = []
    stack = [folder_id]
    while stack:
        parent = stack.pop()
        token = None
        while True:
            resp = drive.files().list(
                q=f"'{parent}' in parents and trashed=false",
                fields="nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime)",
                pageSize=1000,
                pageToken=token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            ).execute()
            for f in resp.get("files", []):
                if f["mimeType"] == FOLDER_MIME:
                    stack.append(f["id"])
                elif f["mimeType"] == GDOC_MIME or (f["mimeType"] == DOCX_MIME or f["name"].lower().endswith(".docx")):
                    out.append(f)
            token = resp.get("nextPageToken")
            if not token:
                break
    return out


def _download(drive, f: dict) -> tuple[str, bytes]:
    from googleapiclient.http import MediaIoBaseDownload

    if f["mimeType"] == GDOC_MIME:
        req = drive.files().export_media(fileId=f["id"], mimeType=DOCX_MIME)
        name = f["name"] if f["name"].lower().endswith(".docx") else f"{f['name']}.docx"
    else:
        req = drive.files().get_media(fileId=f["id"], supportsAllDrives=True)
        name = f["name"]
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = dl.next_chunk()
    return name, buf.getvalue()


def _fingerprint(f: dict) -> str:
    return f.get("md5Checksum") or f"modified:{f.get('modifiedTime')}"


def _song_exists(db: Client, song_id: str | None) -> bool:
    return bool(song_id) and bool(db.table("songs").select("id").eq("id", song_id).limit(1).execute().data)


def _import(db: Client, name: str, data: bytes, song_id: str | None, how: str | None = None) -> dict:
    """Store + scan one file; replace song_id's sheet if given. Returns the ingest result."""
    version_id, existed = ingest.create_version(db, name, data, None)
    if existed:  # exactly this file is already in the library
        row = db.table("song_versions").select("song_id").eq("id", version_id).single().execute().data
        return {"status": "unchanged", "song_id": row["song_id"]}
    result = ingest.process_version(db, version_id, song_id, source="drive", how=how)
    if result["status"] == "exists":
        # A song with this title is already in the library: Drive is now its source, so its sheet is replaced.
        version_id, _ = ingest.create_version(db, name, data, None)
        result = ingest.process_version(db, version_id, result["song_id"], source="drive",
                                        how=how or "added to Drive for an existing song")
        if result["status"] == "done":
            result["status"] = "replaced"
    return result


def write_back(db: Client, song_id: str, data: bytes) -> dict:
    """A songsheet replaced in the app: put the new file in Drive too, over the song's Drive file.

    The Drive file keeps its name and place; Drive keeps the old one in its version history.
    Returns {"status": updated | not_in_drive | not_configured | failed, "message": ...}.
    """
    from googleapiclient.http import MediaIoBaseUpload

    if not configured():
        return {"status": "not_configured", "message": "Google Drive isn't set up."}
    rows = (db.table("drive_files").select("*").eq("song_id", song_id).neq("status", "removed")
            .order("updated_at", desc=True).execute().data)
    if not rows:
        return {"status": "not_in_drive", "message": "This song isn't in the Google Drive folder, so only the app's copy changed."}
    # Wait for a running sync so it can't read the file half-way through.
    if not _lock.acquire(timeout=120):
        return {"status": "failed", "message": "A Drive sync is taking a long time. Try again in a few minutes."}
    try:
        drive = _drive()
        done = []
        for rec in rows:
            # A Google Doc is converted from the .docx; a .docx file is simply replaced.
            media = MediaIoBaseUpload(io.BytesIO(data), mimetype=DOCX_MIME, resumable=False)
            f = drive.files().update(
                fileId=rec["drive_file_id"], media_body=media, supportsAllDrives=True,
                fields="id, name, mimeType, md5Checksum, modifiedTime",
            ).execute()
            # Remember the new version, so the next sync doesn't import it all over again.
            db.table("drive_files").update({
                "fingerprint": _fingerprint(f), "modified_time": f.get("modifiedTime"), "status": "synced",
                "error": None, "last_synced_at": _now(), "updated_at": _now(), "missing_since": None,
            }).eq("drive_file_id", rec["drive_file_id"]).execute()
            done.append(f["name"])
        return {"status": "updated", "message": f"Google Drive updated too ({', '.join(done)}).", "files": done}
    except Exception as e:  # noqa: BLE001 - the app's copy is already replaced; just report it
        text = str(e)
        if "insufficientFilePermissions" in text or "403" in text:
            text = "the service account can only view the Drive folder. Give it Editor access to update Drive."
        return {"status": "failed", "message": f"The app's copy was replaced, but Google Drive wasn't: {text[:300]}"}
    finally:
        _lock.release()


def _update_missing_flags(db: Client, lost_songs: set[str]) -> None:
    """Flag songs that no longer have any file in the Drive folder; unflag ones that have one again.

    The app keeps its own copy of every songsheet, so a flagged song still works.
    """
    active = {r["song_id"] for r in db.table("drive_files").select("song_id").neq("status", "removed").execute().data
              if r["song_id"]}
    for song_id in lost_songs - active:
        rows = db.table("songs").select("title, missing_from_drive_at").eq("id", song_id).limit(1).execute().data
        if not rows or rows[0]["missing_from_drive_at"]:
            continue
        db.table("songs").update({"missing_from_drive_at": _now()}).eq("id", song_id).execute()
        ingest.log_event(db, "songsheet_missing", song_id, rows[0]["title"], "drive")
    flagged = db.table("songs").select("id").not_.is_("missing_from_drive_at", "null").execute().data
    back = [r["id"] for r in flagged if r["id"] in active]
    if back:
        db.table("songs").update({"missing_from_drive_at": None}).in_("id", back).execute()


def sync(db: Client, trigger: str = "manual", started_by: str | None = None) -> dict:
    """Run one sync. Returns a summary; also saved in drive_sync_runs."""
    if not configured():
        raise RuntimeError("Google Drive isn't set up: DRIVE_FOLDER_ID and the service-account key are needed.")
    if not _lock.acquire(blocking=False):
        return {"busy": True}
    run = db.table("drive_sync_runs").insert({"trigger": trigger, "started_by": started_by}).execute().data[0]
    summary = {"files": 0, "added": 0, "updated": 0, "replaced": 0, "unchanged": 0, "failed": 0, "removed": 0, "items": []}
    try:
        drive = _drive()
        files = _list_folder(drive, os.environ["DRIVE_FOLDER_ID"])
        summary["files"] = len(files)
        known = {r["drive_file_id"]: r for r in db.table("drive_files").select("*").execute().data}
        # A file deleted and added back in Drive comes back with a new id. Spot it by name: a known
        # file of that name that disappeared in this sync, or went missing in the last few days.
        seen_ids = {f["id"] for f in files}
        recent = datetime.now(UTC) - timedelta(days=REUPLOAD_DAYS)
        gone_names = {
            r["name"] for fid, r in known.items()
            if fid not in seen_ids and (
                r["status"] != "removed"
                or (r.get("missing_since") and datetime.fromisoformat(r["missing_since"]) >= recent)
            )
        }

        for f in files:
            rec = known.get(f["id"])
            fp = _fingerprint(f)
            base = {
                "drive_file_id": f["id"],
                "name": f["name"],
                "mime_type": f["mimeType"],
                "modified_time": f.get("modifiedTime"),
                "missing_since": None,
                "updated_at": _now(),
            }
            if rec and rec["status"] == "synced" and rec["fingerprint"] == fp and _song_exists(db, rec["song_id"]):
                summary["unchanged"] += 1
                if rec.get("missing_since") or rec["name"] != f["name"]:
                    db.table("drive_files").update(base).eq("drive_file_id", f["id"]).execute()
                continue
            try:
                name, data = _download(drive, f)
                song_id = rec["song_id"] if rec and _song_exists(db, rec["song_id"]) else None
                back = not rec and f["name"] in gone_names
                how = "edited in Drive" if rec else ("deleted and added back in Drive" if back else None)
                result = _import(db, name, data, song_id, how)
                if result["status"] == "unchanged" and back:
                    # The exact same file came back: nothing to scan, but it's still worth knowing.
                    title = db.table("songs").select("title").eq("id", result["song_id"]).single().execute().data["title"]
                    ingest.log_event(db, "songsheet_reuploaded", result["song_id"], title, "drive", None,
                                     {"file": f["name"], "how": "deleted and added back in Drive (same file)"})
                if result["status"] == "failed":
                    raise RuntimeError(result.get("error") or "The scanner couldn't read this songsheet.")
                kind = {"done": "updated" if song_id else "added", "replaced": "replaced", "unchanged": "unchanged"}[result["status"]]
                summary[kind] += 1
                summary["items"].append({"name": f["name"], "result": kind, "song_id": result.get("song_id"), "title": result.get("title")})
                db.table("drive_files").upsert({
                    **base, "fingerprint": fp, "song_id": result.get("song_id"), "status": "synced",
                    "error": None, "last_synced_at": _now(),
                }).execute()
            except Exception as e:  # noqa: BLE001 - one bad file never stops the sync
                summary["failed"] += 1
                summary["items"].append({"name": f["name"], "result": "failed", "error": str(e)[:300]})
                db.table("drive_files").upsert({**base, "status": "failed", "error": str(e)[:500]}).execute()

        # Files we knew about that are no longer in the folder: flag them, keep their songs.
        seen = {f["id"] for f in files}
        lost_songs: set[str] = set()
        for fid, rec in known.items():
            if fid not in seen and rec["status"] != "removed":
                db.table("drive_files").update({"status": "removed", "missing_since": _now(), "updated_at": _now()}).eq("drive_file_id", fid).execute()
                summary["removed"] += 1
                summary["items"].append({"name": rec["name"], "result": "removed", "song_id": rec["song_id"]})
                if rec["song_id"]:
                    lost_songs.add(rec["song_id"])
        _update_missing_flags(db, lost_songs)

        db.table("drive_sync_runs").update({"finished_at": _now(), "summary": summary}).eq("id", run["id"]).execute()
        return summary
    except Exception as e:
        db.table("drive_sync_runs").update({"finished_at": _now(), "summary": summary, "error": str(e)[:500]}).eq("id", run["id"]).execute()
        raise
    finally:
        _lock.release()


def start_schedule() -> None:
    """Sync every DRIVE_SYNC_MINUTES (0 or unset = only when someone presses the button)."""
    minutes = float(os.environ.get("DRIVE_SYNC_MINUTES") or 0)
    if minutes <= 0 or not configured():
        return

    def loop() -> None:
        while True:
            try:
                sync(ingest.client(), trigger="schedule")
            except Exception:  # noqa: BLE001 - keep the schedule alive; the run row has the error
                pass
            time.sleep(minutes * 60)

    threading.Thread(target=loop, name="drive-sync", daemon=True).start()
