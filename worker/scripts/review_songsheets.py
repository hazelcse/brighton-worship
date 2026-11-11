"""Review a folder of songsheets: report discrepancies and pick one sheet per song.

    uv run python scripts/review_songsheets.py SOURCE_DIR CONVERTED_DIR REPORT_DIR MOCK_DIR

SOURCE_DIR     the original songsheets (.docx, .doc, ...)
CONVERTED_DIR  .docx copies of the .doc files (LibreOffice output, same base names)
REPORT_DIR     where songsheet-review.md and songsheet-review.csv are written
MOCK_DIR       receives one copy of the best songsheet for each song

The scanner reads only the document. The file name is used here purely to cross-check,
because the existing library encodes key and bpm in its file names.
"""

from __future__ import annotations

import csv
import re
import shutil
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from worship_worker.music import NOTE_TO_PC
from worship_worker.scanner import ScanResult, scan_docx

SEVERITY_RANK = {"error": 0, "warning": 1, "info": 2}


@dataclass
class Sheet:
    name: str  # original file name
    path: Path  # .docx that was scanned (original or converted)
    converted: bool
    result: ScanResult | None
    error: str | None = None


def filename_info(name: str) -> tuple[list[str] | None, float | None]:
    keys = re.findall(r"\(([A-G][#b]?(?:\s*[-,]\s*[A-G][#b]?)*)\)", name)
    bpm = re.search(r"\)\s*-?\s*(\d+(?:\.\d+)?)\s*\.(?:docx?|dot)$", name)
    k = keys[-1] if keys else None
    return ([x.strip() for x in re.split(r"[-,]", k)] if k else None), (float(bpm[1]) if bpm else None)


def pcs(keys: list[str]) -> list[int]:
    return [NOTE_TO_PC[k.rstrip("m")] for k in keys]


def song_key(r: ScanResult) -> str:
    """Group sheets of the same song: title without (subtitles) and punctuation."""
    base = re.sub(r"\(.*?\)", "", r.title or "")
    base = re.sub(r"[^\w\s]", "", base.lower())
    return re.sub(r"\s+", " ", base).strip()


def fmt_bpm(v: float | None) -> str:
    return "—" if v is None else (str(int(v)) if v == int(v) else str(v))


def main(src: Path, converted: Path, report_dir: Path, mock_dir: Path) -> None:
    sheets: list[Sheet] = []
    unsupported: list[str] = []
    for f in sorted(src.iterdir()):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext == ".docx":
            path, conv = f, False
        elif ext == ".doc":
            path, conv = converted / (f.stem + ".docx"), True
            if not path.exists():
                sheets.append(Sheet(f.name, path, True, None, "Couldn't convert this .doc file."))
                continue
        else:
            unsupported.append(f.name)
            continue
        try:
            sheets.append(Sheet(f.name, path, conv, scan_docx(path.read_bytes())))
        except Exception as e:  # noqa: BLE001 - report every failure
            sheets.append(Sheet(f.name, path, conv, None, f"Couldn't read the file: {e}"))

    # --- filename vs sheet ------------------------------------------------------------
    rows = []  # for CSV
    key_diffs, bpm_diffs = [], []
    for s in sheets:
        r = s.result
        fkeys, fbpm = filename_info(s.name)
        found = []
        if r:
            for reg in r.key_regions:
                if not found or found[-1] != reg.key:
                    found.append(reg.key)
        alts = list(r.alternate_keys) if r else []
        key_note = ""
        if r and fkeys and found:
            if pcs(fkeys) == pcs(found) or set(pcs(fkeys)) == set(pcs(found + alts)):
                pass
            elif pcs(fkeys)[0] == pcs(found)[0]:
                key_note = "sheet has a different key change" if len(found) > len(fkeys) or len(fkeys) > 1 else ""
                if len(found) > len(fkeys):
                    key_note = "sheet has a key change not in the file name"
                elif len(fkeys) > len(found):
                    key_note = "file name has a key change the scanner didn't find"
            else:
                key_note = "different key"
            if key_note:
                shown = "→".join(found) + (f" (alt chart: {', '.join(alts)})" if alts else "")
                key_diffs.append((s, "-".join(fkeys), shown, key_note))
        if r and fbpm is not None and r.bpm != fbpm:
            bpm_diffs.append((s, fbpm, r.bpm))
        rows.append({
            "file": s.name,
            "converted_from_doc": s.converted,
            "title": r.title if r else "",
            "filename_key": "-".join(fkeys) if fkeys else "",
            "sheet_key": "→".join(found),
            "alternate_keys": ",".join(alts),
            "key_source": ",".join(sorted({x.source for x in r.key_regions})) if r else "",
            "filename_bpm": fmt_bpm(fbpm) if fbpm else "",
            "sheet_bpm": fmt_bpm(r.bpm) if r else "",
            "issues": " | ".join(f"[{i.severity}] {i.message}" for i in r.issues) if r else (s.error or ""),
        })

    # --- one sheet per song -------------------------------------------------------------
    groups: dict[str, list[Sheet]] = defaultdict(list)
    for s in sheets:
        if s.result and s.result.title and "template" not in s.name.lower():
            groups[song_key(s.result)].append(s)

    def quality(s: Sheet) -> tuple:
        r = s.result
        errors = sum(i.severity == "error" for i in r.issues)
        warnings = sum(i.severity == "warning" for i in r.issues)
        return (errors, warnings, s.converted, -r.confidence, s.name)

    mock_dir.mkdir(parents=True, exist_ok=True)
    for old in mock_dir.glob("*.docx"):
        old.unlink()
    chosen: list[tuple[str, Sheet, int]] = []
    for _, members in sorted(groups.items()):
        best = min(members, key=quality)
        out_name = best.name if not best.converted else Path(best.name).stem + ".docx"
        shutil.copy2(best.path, mock_dir / out_name)
        chosen.append((best.result.title, best, len(members)))

    # --- write report ---------------------------------------------------------------------
    report_dir.mkdir(parents=True, exist_ok=True)
    with open(report_dir / "songsheet-review.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    by_issue: dict[str, list[tuple[Sheet, str, str]]] = defaultdict(list)
    for s in sheets:
        if s.error:
            by_issue["unreadable"].append((s, "error", s.error))
        elif s.result:
            for i in s.result.issues:
                by_issue[i.code].append((s, i.severity, i.message))

    titles = {
        "unreadable": "Files that couldn't be read",
        "no_title": "No song title found",
        "no_chords": "No chords found (key unknown)",
        "written_key_mismatch": "Written key doesn't match the chords",
        "title_key_mismatch": "Key in the song heading doesn't match the chords",
        "low_key_confidence": "Key guessed with low confidence",
        "multiple_tempos": "More than one tempo on the sheet",
        "no_bpm": "No tempo (bpm)",
        "no_sections": "No section headings",
        "broken_youtube_link": "Incomplete YouTube link",
        "no_youtube_link": "No YouTube link",
        "no_artist": "No artist",
    }

    def esc(t: str) -> str:
        return str(t).replace("|", "\\|")

    L: list[str] = []
    L.append("# Songsheet review\n")
    L.append(
        f"Scanned **{len(sheets)}** songsheets ({sum(not s.converted for s in sheets)} .docx, "
        f"{sum(s.converted for s in sheets)} converted from .doc). They cover **{len(groups)}** distinct songs.\n"
    )
    L.append("The scanner reads only what's inside each document. File names were used only to cross-check.\n")
    L.append("## Summary\n")
    L.append("| Check | Sheets |\n|---|---|")
    L.append(f"| Key differs from the file name | {sum(d[3] == 'different key' for d in key_diffs)} |")
    L.append(f"| Key change differs from the file name | {sum(d[3] != 'different key' for d in key_diffs)} |")
    L.append(f"| Tempo differs from the file name | {len(bpm_diffs)} |")
    for code, title in titles.items():
        if by_issue.get(code):
            L.append(f"| {title} | {len(by_issue[code])} |")
    if unsupported:
        L.append(f"| Unsupported file types (not scanned) | {len(unsupported)} |")
    L.append("")

    L.append("## 1. Key: file name vs sheet\n")
    L.append("*Sheet key* is what the scanner found: a key written on the sheet (checked against the chords), "
             "otherwise one worked out from the chords. When they differ, the file name is usually the stale one, "
             "but please check.\n")
    L.append("| File | File name says | Sheet says | Note |\n|---|---|---|---|")
    for s, fk, sk, note in sorted(key_diffs, key=lambda d: (d[3] != "different key", d[0].name.lower())):
        L.append(f"| {esc(s.name)} | {fk} | {sk} | {note} |")
    L.append("")

    L.append("## 2. Tempo: file name vs sheet\n")
    L.append("| File | File name says | Sheet says |\n|---|---|---|")
    for s, fb, sb in sorted(bpm_diffs, key=lambda d: d[0].name.lower()):
        L.append(f"| {esc(s.name)} | {fmt_bpm(fb)} | {fmt_bpm(sb) if sb is not None else 'not on sheet'} |")
    L.append("")

    L.append("## 3. Issues the scanner flagged\n")
    L.append("These are the same messages the app will show on each song.\n")
    for code, title in titles.items():
        items = by_issue.get(code)
        if not items:
            continue
        L.append(f"### {title} ({len(items)})\n")
        if code in ("no_youtube_link", "no_artist"):
            L.append(", ".join(esc(s.name) for s, _, _ in sorted(items, key=lambda x: x[0].name.lower())) + "\n")
            continue
        L.append("| File | Message |\n|---|---|")
        for s, _, msg in sorted(items, key=lambda x: x[0].name.lower()):
            L.append(f"| {esc(s.name)} | {esc(msg)} |")
        L.append("")

    if unsupported:
        L.append("## 4. Not scanned\n")
        L.append("These file types aren't songsheets the scanner can read (.pages, .pdf, Word templates). "
                 "Re-save them as .docx to include them.\n")
        for n in unsupported:
            L.append(f"- {esc(n)}")
        L.append("")

    L.append("## 5. Mock library (one sheet per song)\n")
    L.append(f"Copied to `{mock_dir.name}/`. For each song, the chosen sheet is the one with the fewest scanner "
             "issues, preferring original .docx files over converted .doc files. Template files were left out.\n")
    L.append("| Song | Chosen file | Key | Versions available |\n|---|---|---|---|")
    for title, s, n in sorted(chosen, key=lambda c: c[0].lower()):
        L.append(f"| {esc(title)} | {esc(s.name)}{' (converted)' if s.converted else ''} | {(s.result.key_display or '—') + (' (+' + ', '.join(s.result.alternate_keys) + ')' if s.result.alternate_keys else '')} | {n} |")
    L.append("")

    (report_dir / "songsheet-review.md").write_text("\n".join(L), encoding="utf-8")
    print(f"sheets={len(sheets)} songs={len(groups)} key_diffs={len(key_diffs)} bpm_diffs={len(bpm_diffs)} "
          f"unsupported={len(unsupported)} unreadable={len(by_issue.get('unreadable', []))}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(1)
    main(*(Path(a) for a in sys.argv[1:]))
