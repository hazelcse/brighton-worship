"""Bulk-import a folder of songsheets into the library.

    uv run python scripts/import_songsheets.py "path/to/songsheets"

Files already in the library (same content) are skipped, so it is safe to re-run.
Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from worker/.env.
"""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

from worship_worker import ingest

load_dotenv()


def main(folder: Path) -> None:
    db = ingest.client()
    for other in sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() != ".docx"):
        print(f"SKIPPED {other.name}: only .docx songsheets are supported")
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() == ".docx")
    added = skipped = failed = flagged = 0
    for i, f in enumerate(files, 1):
        version_id, existed = ingest.create_version(db, f.name, f.read_bytes())
        if existed:
            skipped += 1
            continue
        result = ingest.process_version(db, version_id)
        if result["status"] == "failed":
            failed += 1
            print(f"[{i}/{len(files)}] FAILED {f.name}: {result['error']}")
            continue
        if result["status"] == "exists":
            skipped += 1  # same song already in the library (one songsheet per song)
            continue
        added += 1
        if any(x["severity"] in ("error", "warning") for x in result["issues"]):
            flagged += 1
        if i % 25 == 0:
            print(f"[{i}/{len(files)}] ...")
    print(f"Imported {added}, skipped {skipped} already in library, failed {failed}. {flagged} need review.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(Path(sys.argv[1]))
