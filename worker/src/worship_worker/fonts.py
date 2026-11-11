"""Text width measurement, so transposed lines can be checked against their box width.

Word isn't available on the server, but the common Office fonts have free, metric-compatible
twins (same character widths): Liberation Sans = Arial, Liberation Serif = Times New Roman,
Liberation Mono = Courier New, Carlito = Calibri, Caladea = Cambria. On Windows the real
fonts are used.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from fontTools.ttLib import TTFont

FONT_DIRS = [
    Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts",
    Path("/usr/share/fonts"),
    Path("/usr/local/share/fonts"),
]

# family -> {style: candidate file names}; the first file found wins.
FAMILIES: dict[str, dict[str, list[str]]] = {
    "arial": {
        "r": ["arial.ttf", "LiberationSans-Regular.ttf"], "b": ["arialbd.ttf", "LiberationSans-Bold.ttf"],
        "i": ["ariali.ttf", "LiberationSans-Italic.ttf"], "bi": ["arialbi.ttf", "LiberationSans-BoldItalic.ttf"],
    },
    "times new roman": {
        "r": ["times.ttf", "LiberationSerif-Regular.ttf"], "b": ["timesbd.ttf", "LiberationSerif-Bold.ttf"],
        "i": ["timesi.ttf", "LiberationSerif-Italic.ttf"], "bi": ["timesbi.ttf", "LiberationSerif-BoldItalic.ttf"],
    },
    "courier new": {
        "r": ["cour.ttf", "LiberationMono-Regular.ttf"], "b": ["courbd.ttf", "LiberationMono-Bold.ttf"],
        "i": ["couri.ttf", "LiberationMono-Italic.ttf"], "bi": ["courbi.ttf", "LiberationMono-BoldItalic.ttf"],
    },
    "calibri": {
        "r": ["calibri.ttf", "Carlito-Regular.ttf"], "b": ["calibrib.ttf", "Carlito-Bold.ttf"],
        "i": ["calibrii.ttf", "Carlito-Italic.ttf"], "bi": ["calibriz.ttf", "Carlito-BoldItalic.ttf"],
    },
    "cambria": {
        "r": ["cambria.ttc", "Caladea-Regular.ttf"], "b": ["cambriab.ttf", "Caladea-Bold.ttf"],
        "i": ["cambriai.ttf", "Caladea-Italic.ttf"], "bi": ["cambriaz.ttf", "Caladea-BoldItalic.ttf"],
    },
    "tahoma": {"r": ["tahoma.ttf", "DejaVuSans.ttf"], "b": ["tahomabd.ttf", "DejaVuSans-Bold.ttf"]},
    "verdana": {
        "r": ["verdana.ttf", "DejaVuSans.ttf"], "b": ["verdanab.ttf", "DejaVuSans-Bold.ttf"],
        "i": ["verdanai.ttf", "DejaVuSans-Oblique.ttf"], "bi": ["verdanaz.ttf", "DejaVuSans-BoldOblique.ttf"],
    },
}
ALIASES = {
    "liberation sans": "arial", "arimo": "arial", "helvetica": "arial", "helvetica neue": "arial",
    "arial unicode ms": "arial", "liberation serif": "times new roman", "tinos": "times new roman",
    "times": "times new roman", "liberation mono": "courier new", "carlito": "calibri", "caladea": "cambria",
}
DEFAULT_FAMILY = "arial"


@lru_cache(maxsize=None)
def _find(name: str) -> Path | None:
    for d in FONT_DIRS:
        if not d.exists():
            continue
        direct = d / name
        if direct.exists():
            return direct
        for p in d.rglob(name):
            return p
    return None


@lru_cache(maxsize=None)
def _metrics(path: Path) -> tuple[dict[int, int], int, int]:
    """(codepoint -> advance width, unitsPerEm, fallback width) for a font file."""
    font = TTFont(str(path), fontNumber=0, lazy=True)
    cmap = font.getBestCmap() or {}
    hmtx = font["hmtx"].metrics
    upm = font["head"].unitsPerEm
    widths = {cp: hmtx[glyph][0] for cp, glyph in cmap.items() if glyph in hmtx}
    fallback = widths.get(ord("n"), upm // 2)
    return widths, upm, fallback


@lru_cache(maxsize=None)
def _font_file(family: str, bold: bool, italic: bool = False) -> Path | None:
    fam = family.strip().lower().split(";")[0].strip()
    fam = ALIASES.get(fam, fam)
    styles = FAMILIES.get(fam, FAMILIES[DEFAULT_FAMILY])
    order = {(False, False): ["r"], (True, False): ["b", "r"], (False, True): ["i", "r"],
             (True, True): ["bi", "b", "i", "r"]}[(bold, italic)]
    for style in order:
        for name in styles.get(style, []):
            p = _find(name)
            if p:
                return p
    if fam != DEFAULT_FAMILY:
        return _font_file(DEFAULT_FAMILY, bold, italic)
    return None


def text_width_pt(text: str, family: str, size_pt: float, bold: bool, italic: bool = False) -> float:
    """Width of text in points (no kerning, as Word lays out by default)."""
    path = _font_file(family, bold, italic)
    if path is None:
        return len(text) * size_pt * 0.55  # rough fallback if no fonts are installed
    widths, upm, fallback = _metrics(path)
    total = 0
    for ch in text:
        cp = ord(ch)
        if 0x2E80 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF:
            total += upm  # CJK characters are full width
        else:
            total += widths.get(cp, fallback)
    return total * size_pt / upm
