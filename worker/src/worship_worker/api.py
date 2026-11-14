"""HTTP API for the songsheet worker. Only the website's server calls it."""

from __future__ import annotations

import base64
import hmac
import json
import os
from dataclasses import asdict
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Form, Header, HTTPException, Response, UploadFile

from . import drive_sync, ingest
from .scanner import SCANNER_VERSION, scan_docx
from .preview import docx_to_pdf
from .transpose import transpose_docx, transposed_file_name

load_dotenv()

app = FastAPI(title="Brighton Worship songsheet worker")


@app.on_event("startup")
def warm_up_fonts() -> None:
    """Load the common fonts now so the first transpose request isn't slow."""
    from .fonts import text_width_pt

    for family in ("Arial", "Times New Roman", "Calibri", "Courier New", "Cambria"):
        for bold in (False, True):
            for italic in (False, True):
                text_width_pt("C#m7", family, 11, bold, italic)

@app.on_event("startup")
def start_drive_schedule() -> None:
    """Sync the songsheet library from Google Drive every DRIVE_SYNC_MINUTES, if set."""
    from . import drive_sync

    drive_sync.start_schedule()


MAX_UPLOAD = 10 * 1024 * 1024
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def require_token(authorization: str = Header(default="")) -> None:
    expected = os.environ.get("WORKER_TOKEN", "")
    given = authorization.removeprefix("Bearer ").strip()
    if not expected or not hmac.compare_digest(given, expected):
        raise HTTPException(status_code=401, detail="Invalid worker token")


def _read_docx(file: UploadFile) -> bytes:
    data = file.file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="Songsheets must be 10 MB or smaller.")
    if not ingest.is_docx(file.filename or "", data):
        raise HTTPException(status_code=400, detail=ingest.NOT_DOCX)
    return data


@app.get("/health")
def health() -> dict:
    return {"ok": True, "scanner_version": SCANNER_VERSION}


# ---------------------------------------------------------------------------
# Library
# ---------------------------------------------------------------------------


@app.post("/upload", dependencies=[Depends(require_token)])
def upload(  # sync so FastAPI runs it in a thread pool (scanning is CPU work)
    file: UploadFile,
    uploaded_by: str | None = Form(default=None),
    replace_song_id: str | None = Form(default=None),
) -> dict:
    """Add a new song from its songsheet, or replace an existing song's songsheet."""
    data = _read_docx(file)
    db = ingest.client()
    version_id, existed = ingest.create_version(db, file.filename or "songsheet.docx", data, uploaded_by)
    if existed:
        row = db.table("song_versions").select("song_id").eq("id", version_id).single().execute().data
        return {"version_id": version_id, "song_id": row["song_id"], "status": "duplicate", "file_name": file.filename}
    result = ingest.process_version(db, version_id, replace_song_id)
    if replace_song_id and result.get("status") == "done":
        # Keep Google Drive the same as the app: the new songsheet goes there too.
        result["drive"] = drive_sync.write_back(db, replace_song_id, data)
    return {**result, "file_name": file.filename}


@app.post("/versions/{version_id}/process", dependencies=[Depends(require_token)])
def process_version(version_id: str) -> dict:
    return ingest.process_version(ingest.client(), version_id)


@app.post("/process-pending", dependencies=[Depends(require_token)])
def process_pending(limit: int = 50) -> dict:
    results = ingest.process_pending(ingest.client(), limit)
    return {"processed": len(results), "failed": sum(r["status"] == "failed" for r in results)}


@app.post("/versions/{version_id}/preview", dependencies=[Depends(require_token)])
def make_preview(version_id: str) -> dict:
    """Make the preview if it doesn't exist yet. Returns {"pages": n}."""
    return ingest.ensure_preview(ingest.client(), version_id)


@app.post("/previews/backfill", dependencies=[Depends(require_token)])
def backfill_previews(limit: int = 1000) -> dict:
    return ingest.backfill_previews(ingest.client(), limit)


@app.post("/lyrics/backfill", dependencies=[Depends(require_token)])
def backfill_lyrics(limit: int = 1000) -> dict:
    """Fill in the lyrics of songs scanned before lyrics were kept."""
    return ingest.backfill_lyrics(ingest.client(), limit)


# ---------------------------------------------------------------------------
# Transposing
# ---------------------------------------------------------------------------


def _parse_target(target_key: str | None, semitones: str | None) -> tuple[str | None, int | None]:
    if target_key:
        return target_key, None
    if semitones not in (None, ""):
        try:
            n = int(semitones)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="Semitones must be a whole number.") from e
        if not -11 <= n <= 11:
            raise HTTPException(status_code=400, detail="Choose between -11 and +11 semitones.")
        return None, n
    raise HTTPException(status_code=400, detail="Choose a key or a number of semitones.")


def _transposed_response(data: bytes, file_name: str, target_key: str | None, semitones: int | None,
                         from_key: str | None = None, fmt: str | None = "docx") -> Response:
    """The transposed sheet as .docx, or as a PDF (fmt="pdf") drawn from that .docx."""
    try:
        out, report = transpose_docx(data, target_key=target_key, semitones=semitones, from_key=from_key or None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    name = transposed_file_name(file_name, report.from_key, report.semitones, report.to_key)
    media = DOCX_MIME
    if fmt == "pdf":
        try:
            out = docx_to_pdf(out)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=500, detail="The PDF couldn't be made. Try downloading the .docx instead.") from e
        name = name.rsplit(".", 1)[0] + ".pdf"
        media = "application/pdf"
    return Response(
        content=out,
        media_type=media,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
            "X-File-Name": quote(name),
            "X-Transpose-Report": json.dumps(asdict(report)),
        },
    )


@app.post("/analyze", dependencies=[Depends(require_token)])
def analyze(file: UploadFile) -> dict:
    """Work out the key of an uploaded sheet (not stored), before choosing a new key."""
    r = scan_docx(_read_docx(file))
    return {
        "title": r.title,
        "key": r.key_regions[0].key if r.key_regions else None,
        "key_display": r.key_display,
        "alternate_keys": r.alternate_keys,
        "confidence": min((k.confidence for k in r.key_regions), default=0),
        "issues": [i for i in r.to_dict()["issues"] if i["severity"] != "info"],
    }


@app.post("/transpose/upload", dependencies=[Depends(require_token)])
def transpose_upload(
    file: UploadFile,
    target_key: str | None = Form(default=None),
    semitones: str | None = Form(default=None),
    from_key: str | None = Form(default=None),
    format: str | None = Form(default="docx"),  # noqa: A002 - "docx" or "pdf"
) -> Response:
    """Transpose an uploaded sheet (not stored). from_key overrides the detected key."""
    tk, n = _parse_target(target_key, semitones)
    return _transposed_response(_read_docx(file), file.filename or "songsheet.docx", tk, n, from_key, format)


@app.post("/transpose/song/{song_id}", dependencies=[Depends(require_token)])
def transpose_song(
    song_id: str,
    target_key: str | None = Form(default=None),
    semitones: str | None = Form(default=None),
    format: str | None = Form(default="docx"),  # noqa: A002 - "docx" or "pdf"
) -> Response:
    """Transpose a library song's base copy."""
    tk, n = _parse_target(target_key, semitones)
    try:
        data, name, confirmed_key = ingest.songsheet_bytes(ingest.client(), song_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _transposed_response(data, name, tk, n, confirmed_key, format)


@app.post("/session-sheet", dependencies=[Depends(require_token)])
def session_sheet(file: UploadFile) -> dict:
    """A worship leader's own songsheet for one session (not stored, not added to the library):
    what the scanner reads from it, to fill in the song's details, and the sheet as a PDF for the
    band to read (base64)."""
    data = _read_docx(file)
    r = scan_docx(data)
    try:
        pdf = docx_to_pdf(data)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail="This songsheet couldn't be turned into a PDF. Try saving it as a PDF and uploading that.") from e
    return {
        "title": r.title,
        "artist": r.artist,
        "key": r.key_regions[0].key if r.key_regions else r.original_key,
        "key_display": r.key_display,
        "bpm": r.bpm,
        "type": r.suggested_type,
        "sections": r.sections,
        "sequence": r.sequence or r.chart_sequence or r.lyric_sequence,
        "youtube_links": r.youtube_links,
        "pdf_base64": base64.b64encode(pdf).decode("ascii"),
    }


# ---------------------------------------------------------------------------
# Rosters
# ---------------------------------------------------------------------------


@app.post("/rosters/{roster_id}/generate", dependencies=[Depends(require_token)])
def generate_roster(roster_id: str, time_limit: float = 45.0) -> dict:
    """Build the optimal roster for a draft (MILP) and save it to the draft."""
    from . import roster_service

    try:
        return roster_service.generate(ingest.client(), roster_id, min(max(time_limit, 5.0), 120.0))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.post("/rosters/{roster_id}/evaluate", dependencies=[Depends(require_token)])
def evaluate_roster(roster_id: str, full: bool = False) -> dict:
    """Score a draft's hand-edited assignments against what was generated; saves rosters.check.
    `full`: check it even when nothing differs from the baseline (a republished roster, whose
    baseline is reset to the line-up as republished, hand edits and all)."""
    from . import roster_service

    return {"check": roster_service.evaluate(ingest.client(), roster_id, full=full)}


# ---------------------------------------------------------------------------
# Google Drive sync
# ---------------------------------------------------------------------------


@app.post("/drive/sync", dependencies=[Depends(require_token)])
def drive_sync_now(started_by: str | None = None) -> dict:
    """Pull new and changed songsheets from the shared Drive folder into the library."""
    from . import drive_sync

    try:
        return drive_sync.sync(ingest.client(), trigger="manual", started_by=started_by)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/drive/status", dependencies=[Depends(require_token)])
def drive_status() -> dict:
    """Is Drive set up, how often it syncs, and the latest run."""
    import os

    from . import drive_sync

    db = ingest.client()
    last = (db.table("drive_sync_runs").select("*").not_.is_("finished_at", "null")
            .order("started_at", desc=True).limit(1).execute().data)
    return {
        "configured": drive_sync.configured(),
        "every_minutes": float(os.environ.get("DRIVE_SYNC_MINUTES") or 0),
        "last_run": last[0] if last else None,  # the latest finished run
        "running": drive_sync.running(),
    }
