"""Transpose a songsheet .docx, keeping its layout.

What changes:
  * every chord (and slash bass note) on chord lines, spelled for the new key
    (flat keys use flats, sharp keys use sharps)
  * written keys: "E Major" headings, "Transpose to E", "Chorus (F# Major):", and the key in
    the song heading, e.g. "ABIDE (E-F#)"
What stays:
  * everything else, including "Original Key: ..." (the recording's key)

Layout:
  * a chord that gets wider/narrower takes or gives back spaces after it, measured in the
    real font, so the next chord stays where it was (tabs absorb changes on their own)
  * if a line would no longer fit its text box, the box is widened (and moved left if it
    would run off the page), so no chord wraps onto the next line. Lines that already
    wrapped in the original are left alone.
  * Word keeps two copies of each text box (modern + legacy); both are changed identically.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field

from lxml import etree

from .fonts import text_width_pt
from .music import NOTE_TO_PC, chords_in_line, inline_chord_spans, parse_chord, parse_key_name, semitones_between
from .scanner import KEY_CHANGE_RE, KEY_HEADER_RE, KEY_IN_TITLE_RE, LABEL_KEY_RE, ORIGINAL_KEY_RE, scan_docx

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
V = "urn:schemas-microsoft-com:vml"
XML = "http://www.w3.org/XML/1998/namespace"
NS = {"w": W, "mc": MC, "wp": WP, "a": A, "wps": WPS, "v": V}


def q(ns: str, tag: str) -> str:
    return f"{{{NS[ns]}}}{tag}"


EMU_PER_PT = 12700
SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
FLAT_KEYS = {"F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"}
TARGET_KEYS = KEY_NAMES  # what the UI offers


# ---------------------------------------------------------------------------
# Key / chord maths
# ---------------------------------------------------------------------------


def transpose_key(key: str, n: int) -> str:
    """'E', +2 -> 'F#'. Minor keys ('C#m') keep the m and use their relative major's spelling."""
    minor = key.endswith("m")
    pc = (NOTE_TO_PC[key.rstrip("m")] + n) % 12
    if minor:
        rel_major = KEY_NAMES[(pc + 3) % 12]
        names = FLAT_NAMES if rel_major in FLAT_KEYS else SHARP_NAMES
        return names[pc] + "m"
    return KEY_NAMES[pc]


LETTERS = "CDEFGAB"
LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# semitones above the tonic -> letter steps above the tonic's letter (b2 b3 #4 b6 b7 convention)
DEGREE_STEPS = {0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6}
ENHARMONIC = {"E#": "F", "B#": "C", "Fb": "E", "Cb": "B"}


def note_name(pc: int, key_context: str) -> str:
    """Spell a note the way a chart in this key would: in C, Bb (not A#) and F# (not Gb)."""
    pc %= 12
    major = key_context
    if key_context.endswith("m"):
        major = KEY_NAMES[(NOTE_TO_PC[key_context.rstrip("m")] + 3) % 12]
    tonic_pc = NOTE_TO_PC[major]
    letter = LETTERS[(LETTERS.index(major[0]) + DEGREE_STEPS[(pc - tonic_pc) % 12]) % 7]
    diff = (pc - LETTER_PC[letter] + 6) % 12 - 6
    if diff not in (-1, 0, 1):  # would need a double sharp/flat: use the plain name
        return (FLAT_NAMES if major in FLAT_KEYS else SHARP_NAMES)[pc]
    name = letter + {0: "", 1: "#", -1: "b"}[diff]
    return ENHARMONIC.get(name, name)


def transpose_chord_text(token: str, n: int, key_context: str) -> str | None:
    c = parse_chord(token)
    if not c:
        return None
    root = note_name(NOTE_TO_PC[c.root] + n, key_context)
    bass = f"/{note_name(NOTE_TO_PC[c.bass] + n, key_context)}" if c.bass else ""
    return f"{root}{c.quality}{bass}"


_KEY_LETTER_RE = re.compile(r"(?<![A-Za-z])([A-Ga-g])([#b♯♭])?(m(?![a-z]))?(?![A-Za-z#])")


def transpose_keys_in(text: str, n: int) -> str:
    """Transpose bare key names inside a short string like '(E-F#)' or 'Key: g-a'."""

    def rep(m: re.Match) -> str:
        letter, acc, minor = m[1], m[2] or "", m[3] or ""
        acc = {"♯": "#", "♭": "b"}.get(acc, acc)
        new = transpose_key(letter.upper() + acc + minor, n)
        return new.lower() if letter.islower() else new

    return _KEY_LETTER_RE.sub(rep, text)


# ---------------------------------------------------------------------------
# Styles: work out each run's font, size and boldness
# ---------------------------------------------------------------------------


# Word draws superscript/subscript at about 2/3 of the font size (LibreOffice ~58%; the larger
# value is used so a line is never measured narrower than it really is).
SCRIPT_SCALE = 0.67


@dataclass(frozen=True)
class RunProps:
    family: str
    size: float
    bold: bool
    italic: bool = False
    small: bool = False  # superscript/subscript: Word draws it smaller than its font size

    @property
    def drawn_size(self) -> float:
        """The size the text is actually drawn at, for width maths (e.g. the superscript "b" in Bb)."""
        return self.size * SCRIPT_SCALE if self.small else self.size


def _on(el: etree._Element | None) -> bool | None:
    if el is None:
        return None
    return el.get(q("w", "val"), "true") not in ("0", "false", "off")


class Styles:
    def __init__(self, styles_xml: bytes | None, theme_xml: bytes | None):
        self.styles: dict[str, etree._Element] = {}
        self.default_para: str | None = None
        self.doc_rpr: etree._Element | None = None
        self.theme = {"minor": "Calibri", "major": "Calibri Light"}
        if theme_xml:
            t = etree.fromstring(theme_xml)
            for kind in ("minor", "major"):
                el = t.find(f".//a:{kind}Font/a:latin", NS)
                if el is not None and el.get("typeface"):
                    self.theme[kind] = el.get("typeface")
        if styles_xml:
            s = etree.fromstring(styles_xml)
            self.doc_rpr = s.find("w:docDefaults/w:rPrDefault/w:rPr", NS)
            self.doc_ppr = s.find("w:docDefaults/w:pPrDefault/w:pPr", NS)
            for st in s.iterfind("w:style", NS):
                sid = st.get(q("w", "styleId"))
                self.styles[sid] = st
                if st.get(q("w", "type")) == "paragraph" and st.get(q("w", "default")) in ("1", "true"):
                    self.default_para = sid

    def _chain(self, sid: str | None) -> list[etree._Element]:
        out, seen = [], set()
        while sid and sid in self.styles and sid not in seen:
            seen.add(sid)
            st = self.styles[sid]
            out.append(st)
            based = st.find("w:basedOn", NS)
            sid = based.get(q("w", "val")) if based is not None else None
        return out

    def _font(self, rpr: etree._Element | None) -> str | None:
        if rpr is None:
            return None
        f = rpr.find("w:rFonts", NS)
        if f is None:
            return None
        for attr in ("ascii", "hAnsi"):
            if f.get(q("w", attr)):
                return f.get(q("w", attr))
        theme = f.get(q("w", "asciiTheme")) or f.get(q("w", "hAnsiTheme"))
        if theme:
            return self.theme["major" if theme.startswith("major") else "minor"]
        return None

    def run_props(self, run: etree._Element, para: etree._Element) -> RunProps:
        layers: list[etree._Element | None] = [run.find("w:rPr", NS)]
        rstyle = run.find("w:rPr/w:rStyle", NS)
        if rstyle is not None:
            layers += [st.find("w:rPr", NS) for st in self._chain(rstyle.get(q("w", "val")))]
        pstyle = para.find("w:pPr/w:pStyle", NS)
        psid = pstyle.get(q("w", "val")) if pstyle is not None else self.default_para
        layers += [st.find("w:rPr", NS) for st in self._chain(psid)]
        layers.append(self.doc_rpr)

        family = next((f for f in (self._font(l) for l in layers) if f), "Times New Roman")
        size = next((float(sz.get(q("w", "val"))) / 2 for l in layers if l is not None
                     for sz in [l.find("w:sz", NS)] if sz is not None), 10.0)
        bold = next((b for b in (_on(l.find("w:b", NS)) if l is not None else None for l in layers) if b is not None), False)
        italic = next((i for i in (_on(l.find("w:i", NS)) if l is not None else None for l in layers) if i is not None), False)
        va = next((v.get(q("w", "val")) for l in layers if l is not None
                   for v in [l.find("w:vertAlign", NS)] if v is not None), "baseline")
        return RunProps(family, size, bold, italic, va in ("superscript", "subscript"))

    def para_layout(self, para: etree._Element) -> tuple[float, float, list[float]]:
        """(left indent pt, first-line offset pt, custom left tab stops pt)."""
        pprs = [para.find("w:pPr", NS)]
        pstyle = para.find("w:pPr/w:pStyle", NS)
        psid = pstyle.get(q("w", "val")) if pstyle is not None else self.default_para
        pprs += [st.find("w:pPr", NS) for st in self._chain(psid)]
        left = first = None
        stops: dict[float, bool] = {}
        for ppr in reversed([p for p in pprs if p is not None]):  # base styles first
            ind = ppr.find("w:ind", NS)
            if ind is not None:
                for attr in ("left", "start"):
                    if ind.get(q("w", attr)) is not None:
                        left = int(ind.get(q("w", attr))) / 20
                if ind.get(q("w", "firstLine")) is not None:
                    first = int(ind.get(q("w", "firstLine"))) / 20
                if ind.get(q("w", "hanging")) is not None:
                    first = -int(ind.get(q("w", "hanging"))) / 20
            for tab in ppr.iterfind("w:tabs/w:tab", NS):
                pos = int(tab.get(q("w", "pos"), "0")) / 20
                stops[pos] = tab.get(q("w", "val")) != "clear"
        return left or 0.0, first or 0.0, sorted(p for p, keep in stops.items() if keep)


# ---------------------------------------------------------------------------
# Paragraph text as editable pieces
# ---------------------------------------------------------------------------


@dataclass
class Piece:
    el: etree._Element  # w:t, w:tab or w:br
    kind: str  # "t" | "tab" | "br"
    props: RunProps
    text: str


def _owned_runs(p: etree._Element) -> list[etree._Element]:
    """Runs that belong to this paragraph (not to a text box nested inside it)."""
    out = []
    for r in p.iter(q("w", "r")):
        anc = r.getparent()
        ok = True
        while anc is not None and anc is not p:
            if anc.tag in (q("w", "txbxContent"), q("w", "p")):
                ok = False
                break
            anc = anc.getparent()
        if ok:
            out.append(r)
    return out


def paragraph_pieces(p: etree._Element, styles: Styles) -> list[Piece]:
    pieces: list[Piece] = []
    for r in _owned_runs(p):
        props = styles.run_props(r, p)
        for child in r:
            if child.tag == q("w", "t"):
                pieces.append(Piece(child, "t", props, child.text or ""))
            elif child.tag == q("w", "tab"):
                pieces.append(Piece(child, "tab", props, "\t"))
            elif child.tag in (q("w", "br"), q("w", "cr")):
                pieces.append(Piece(child, "br", props, "\n"))
    return pieces


def apply_edits(pieces: list[Piece], edits: list[tuple[int, int, str]]) -> None:
    """Replace [start, end) ranges of the joined paragraph text, across runs, keeping formatting.

    Replacement text goes into the run where the range starts.
    """
    for start, end, new in sorted(edits, key=lambda e: e[0], reverse=True):
        pos = 0
        placed = False
        for pc in pieces:
            p_start, p_end = pos, pos + len(pc.text)
            pos = p_end
            if p_end <= start or p_start >= end:
                if not (p_start == start == end and pc.kind == "t" and not placed):
                    continue
            if pc.kind != "t":
                continue
            lo, hi = max(start, p_start) - p_start, min(end, p_end) - p_start
            if not placed:
                pc.text = pc.text[:lo] + new + pc.text[hi:]
                placed = True
            else:
                pc.text = pc.text[:lo] + pc.text[hi:]
        # Positions after this edit are no longer valid, but we go right-to-left.
    for pc in pieces:
        if pc.kind == "t" and pc.el.text != pc.text:
            pc.el.text = pc.text
            pc.el.set(f"{{{XML}}}space", "preserve")


def _simulate(pieces: list[Piece], styles_layout: tuple[float, float, list[float]], default_tab: float) -> tuple[list[float], list[float]]:
    """Lay the paragraph out like Word: (width of each line, x position each tab jumps to)."""
    left, first, stops = styles_layout
    widths: list[float] = []
    landings: list[float] = []
    x = left + first
    for pc in pieces:
        if pc.kind == "br":
            widths.append(x)
            x = left
        elif pc.kind == "tab":
            nxt = next((s for s in stops if s > x + 0.01), None)
            if nxt is None:
                base = max(stops) if stops and max(stops) > x else 0
                nxt = (int(max(x, base) / default_tab) + 1) * default_tab
            x = nxt
            landings.append(x)
        else:
            x += text_width_pt(pc.text, pc.props.family, pc.props.drawn_size, pc.props.bold, pc.props.italic)
    widths.append(x)
    return widths, landings


def line_widths(pieces: list[Piece], styles_layout: tuple[float, float, list[float]], default_tab: float) -> list[float]:
    """Width of each line of the paragraph in points, following tab stops like Word."""
    return _simulate(pieces, styles_layout, default_tab)[0]


def fit_tab_columns(pieces: list[Piece], styles_layout, default_tab: float, original_landings: list[float]) -> int:
    """Keep chord columns on their original tab stops.

    If a longer chord pushes a column past its tab stop (so every later column would jump to
    the next stop), take spare spaces out of that column until it fits again. Returns the
    number of spaces removed.
    """
    removed = 0
    for k in range(len(original_landings)):
        for _ in range(60):
            _, landings = _simulate(pieces, styles_layout, default_tab)
            if k >= len(landings) or landings[k] <= original_landings[k] + 0.01:
                break
            # Text pieces in column k (between tab k-1 and tab k).
            tab_idx = [i for i, pc in enumerate(pieces) if pc.kind == "tab"]
            lo = tab_idx[k - 1] + 1 if k > 0 else 0
            hi = tab_idx[k]
            best = None  # (run length, piece, start)
            for pc in pieces[lo:hi]:
                if pc.kind != "t":
                    continue
                for m in re.finditer(r" {2,}", pc.text):
                    if best is None or len(m.group(0)) > best[0]:
                        best = (len(m.group(0)), pc, m.start())
            if best is None:
                break  # nothing left to take out (handled below)
            _, pc, at = best
            pc.text = pc.text[:at] + pc.text[at + 1:]
            removed += 1
    for pc in pieces:
        if pc.kind == "t" and pc.el.text != pc.text:
            pc.el.text = pc.text
            pc.el.set(f"{{{XML}}}space", "preserve")
    return removed


# pPr children that must come after <w:tabs> (schema order).
_AFTER_TABS = {
    q("w", t) for t in (
        "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE",
        "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing",
        "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap",
        "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange",
    )
}


def add_column_tab_stops(p: etree._Element, pieces: list[Piece], styles: "Styles", default_tab: float,
                         original_landings: list[float]) -> bool:
    """For a chord column that is now wider than its tab stop even with single spaces, give the
    line its own tab stops just past each column, instead of letting every later column jump a
    whole default stop (which would double the line's width). Returns True if stops were added.
    """
    layout = styles.para_layout(p)
    _, landings = _simulate(pieces, layout, default_tab)
    if all(l <= o + 0.01 for l, o in zip(landings, original_landings)):
        return False

    gap = 4.0  # a little space before the bar line
    left, first, stops = layout
    new_stops: list[float] = []
    x = left + first
    k = 0
    for pc in pieces:
        if pc.kind == "br":
            x = left
        elif pc.kind == "tab":
            orig = original_landings[k] if k < len(original_landings) else x + gap
            stop = max(orig, x + gap, (new_stops[-1] + gap) if new_stops else 0)
            new_stops.append(stop)
            x = stop
            k += 1
        else:
            x += text_width_pt(pc.text, pc.props.family, pc.props.drawn_size, pc.props.bold, pc.props.italic)

    ppr = p.find("w:pPr", NS)
    if ppr is None:
        ppr = etree.SubElement(p, q("w", "pPr"))
        p.remove(ppr)
        p.insert(0, ppr)
    tabs = ppr.find("w:tabs", NS)
    if tabs is None:
        tabs = etree.Element(q("w", "tabs"))
        after = next((c for c in ppr if c.tag in _AFTER_TABS), None)
        if after is not None:
            after.addprevious(tabs)
        else:
            ppr.append(tabs)
    for s in new_stops:
        t = etree.SubElement(tabs, q("w", "tab"))
        t.set(q("w", "val"), "left")
        t.set(q("w", "pos"), str(int(round(s * 20))))
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


@dataclass
class TransposeReport:
    from_key: str | None
    to_key: str | None
    semitones: int
    chords_changed: int = 0
    keys_changed: int = 0
    boxes_widened: list[float] = field(default_factory=list)  # pt added per box
    lines_tightened: int = 0
    lines_shrunk: int = 0  # lines set slightly smaller to fit
    warnings: list[str] = field(default_factory=list)


_TOKEN_RE = re.compile(r"[^\s|]+")
_STRIP = "():.,"


def _chord_edits(text: str, lo: int, hi: int, pieces: list[Piece], n: int, key_ctx: str) -> list[tuple[int, int, str]]:
    """Replacements for every chord on the chord line text[lo:hi], with space compensation."""
    # Props for each character position (for width maths).
    char_props: list[RunProps] = []
    for pc in pieces:
        char_props.extend([pc.props] * len(pc.text))

    edits = []
    for m in _TOKEN_RE.finditer(text, lo, hi):
        raw = m.group(0)
        lead = len(raw) - len(raw.lstrip(_STRIP))
        core = raw.strip(_STRIP)
        # "B/ D#" is written with a space after the slash: transpose "B" and keep the "/".
        if core.endswith("/") and len(core) > 1:
            core = core[:-1]
        if not core:
            continue
        new = transpose_chord_text(core, n, key_ctx)
        if new is None or new == core:
            continue
        start = m.start() + lead
        end = start + len(core)
        props = char_props[start] if start < len(char_props) else pieces[0].props
        delta = text_width_pt(new, props.family, props.drawn_size, props.bold) - text_width_pt(
            core, props.family, props.drawn_size, props.bold
        )
        space = text_width_pt(" ", props.family, props.drawn_size, props.bold) or 3.0

        # Spaces right after the chord (not counting what was already in the raw token).
        after = end + (len(raw) - lead - len(core))
        j = after
        while j < hi and text[j] == " ":
            j += 1
        n_spaces = j - after
        followed_by_content = j < hi and text[j] not in "\t\n"
        replacement, edit_end = new, end
        if followed_by_content and n_spaces > 0 and after == end:
            shift = round(delta / space)
            if shift > 0:  # chord got wider: give back spaces, keep at least one
                remove = min(shift, n_spaces - 1)
                edit_end = end + remove
            elif shift < 0:  # chord got narrower: pad so the next chord stays put
                replacement = new + " " * (-shift)
        edits.append((start, edit_end, replacement))
    return edits


def _box_inner_width(wsp: etree._Element) -> float | None:
    ext = wsp.find("wps:spPr/a:xfrm/a:ext", NS)
    if ext is None:
        return None
    body = wsp.find("wps:bodyPr", NS)
    l_ins = int(body.get("lIns", 91440)) if body is not None else 91440
    r_ins = int(body.get("rIns", 91440)) if body is not None else 91440
    return (int(ext.get("cx")) - l_ins - r_ins) / EMU_PER_PT


def _widen_box(alt: etree._Element, add_pt: float, page_w_pt: float, margin_left_pt: float,
               left_limit_pt: float) -> float:
    """Widen a text box by up to add_pt. Grows to the right until a quarter inch from the page
    edge, then moves left, but never over the lyrics column (left_limit_pt). Returns the points
    actually added (both stored copies of the box get the same change)."""
    choice = alt.find("mc:Choice", NS)
    if choice is None:
        return 0.0
    anchor = next(choice.iter(q("wp", "anchor"), q("wp", "inline")), None)
    ext = anchor.find("wp:extent", NS) if anchor is not None else None
    if ext is None:
        return 0.0

    granted_pt, shift_pt = add_pt, 0.0
    ph = anchor.find("wp:positionH", NS)
    off = ph.find("wp:posOffset", NS) if ph is not None else None
    if off is not None:
        base = 0.0 if ph.get("relativeFrom") == "page" else margin_left_pt
        left = base + int(off.text) / EMU_PER_PT
        right = left + int(ext.get("cx")) / EMU_PER_PT
        room_right = max(0.0, (page_w_pt - 18) - right)
        room_left = max(0.0, left - left_limit_pt)
        granted_pt = min(add_pt, room_right + room_left)
        shift_pt = max(0.0, granted_pt - room_right)
        off.text = str(int(off.text) - int(round(shift_pt * EMU_PER_PT)))
    if granted_pt <= 0:
        return 0.0

    add = int(round(granted_pt * EMU_PER_PT))
    ext.set("cx", str(int(ext.get("cx")) + add))
    for xf in choice.iter(q("a", "ext")):
        if xf.getparent().tag == q("a", "xfrm"):
            xf.set("cx", str(int(xf.get("cx")) + add))
    fallback = alt.find("mc:Fallback", NS)
    if fallback is not None:
        for shape in fallback.iter(q("v", "shape"), q("v", "rect")):
            style = shape.get("style", "")

            def bump(m: re.Match, by: float) -> str:
                return f"{m[1]}{float(m[2]) + by:.2f}pt"

            style = re.sub(r"(width:)([\d.]+)pt", lambda m: bump(m, granted_pt), style)
            if shift_pt:
                style = re.sub(r"(margin-left:)(-?[\d.]+)pt", lambda m: bump(m, -shift_pt), style)
            shape.set("style", style)
    return granted_pt


# rPr children that come after <w:sz> (schema order).
_AFTER_SZ = {
    q("w", t) for t in (
        "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em",
        "lang", "eastAsianLayout", "specVanish", "oMath",
    )
}


def _set_run_size(run: etree._Element, size_pt: float) -> None:
    rpr = run.find("w:rPr", NS)
    if rpr is None:
        rpr = etree.Element(q("w", "rPr"))
        run.insert(0, rpr)
    val = str(int(round(size_pt * 2)))
    for tag in ("sz", "szCs"):
        el = rpr.find(f"w:{tag}", NS)
        if el is None:
            el = etree.Element(q("w", tag))
            if tag == "sz":
                after = next((c for c in rpr if c.tag in _AFTER_SZ), None)
                after.addprevious(el) if after is not None else rpr.append(el)
            else:
                sz = rpr.find("w:sz", NS)
                sz.addnext(el)
        el.set(q("w", "val"), val)


def shrink_to_fit(p: etree._Element, pieces: list[Piece], styles: "Styles", default_tab: float, limit: float) -> float | None:
    """Last resort: make a line's text a little smaller (down to 80%) until it fits. Returns the new size."""
    layout = styles.para_layout(p)
    original = [pc.props for pc in pieces]
    scale = 1.0

    def half(v: float) -> float:
        return max(1.0, round(v * 2) / 2)  # Word sizes are in half points

    while max(line_widths(pieces, layout, default_tab)) > limit and scale > 0.8:
        scale = round(scale - 0.04, 2)
        for pc, orig in zip(pieces, original):
            pc.props = RunProps(orig.family, half(orig.size * scale), orig.bold, orig.italic, orig.small)
    if scale == 1.0:
        return None
    # Every run keeps its size relative to the others (small notes stay smaller).
    for pc in pieces:
        _set_run_size(pc.el.getparent(), pc.props.size)
    return max(pc.props.size for pc in pieces)


def transpose_docx(data: bytes, target_key: str | None = None, semitones: int | None = None,
                   from_key: str | None = None) -> tuple[bytes, TransposeReport]:
    """Transpose to target_key or by a number of semitones.

    from_key: the key the sheet is really in, when an editor has confirmed it. Otherwise the
    scanner's answer is used.
    """
    scan = scan_docx(data)
    scanned_key = scan.key_regions[0].key if scan.key_regions else None
    if from_key:
        parsed = parse_key_name(from_key)
        if not parsed:
            raise ValueError(f"'{from_key}' isn't a key.")
        from_key = parsed
    else:
        from_key = scanned_key
    # Only trust the scanner's fixes for out-of-date written keys if its key agrees with the real one.
    scanner_agrees = bool(scanned_key and from_key and NOTE_TO_PC[scanned_key.rstrip("m")] == NOTE_TO_PC[from_key.rstrip("m")])
    if target_key:
        if not from_key:
            raise ValueError("The key of this songsheet couldn't be worked out, so choose a number of semitones instead.")
        target = parse_key_name(target_key)
        if not target:
            raise ValueError(f"'{target_key}' isn't a key.")
        n = semitones_between(from_key, target)
        to_key = target_key
    elif semitones is not None:
        n = ((semitones + 6) % 12) - 6 if abs(semitones) > 11 else semitones
        to_key = transpose_key(from_key, n) if from_key else None
    else:
        raise ValueError("Choose a key or a number of semitones.")
    report = TransposeReport(from_key, to_key, n)
    if n % 12 == 0:
        return data, report

    zin = zipfile.ZipFile(io.BytesIO(data))
    names = zin.namelist()
    doc = etree.fromstring(zin.read("word/document.xml"))
    styles = Styles(
        zin.read("word/styles.xml") if "word/styles.xml" in names else None,
        zin.read("word/theme/theme1.xml") if "word/theme/theme1.xml" in names else None,
    )
    default_tab = 36.0
    if "word/settings.xml" in names:
        st = etree.fromstring(zin.read("word/settings.xml")).find("w:defaultTabStop", NS)
        if st is not None:
            default_tab = int(st.get(q("w", "val"))) / 20 or 36.0

    body = doc.find("w:body", NS)
    sect = body.find("w:sectPr", NS)
    page_w, margin_l, text_w = 612.0, 72.0, 468.0
    if sect is not None:
        pg = sect.find("w:pgSz", NS)
        mar = sect.find("w:pgMar", NS)
        cols = sect.find("w:cols", NS)
        if pg is not None:
            page_w = int(pg.get(q("w", "w"))) / 20
        if mar is not None:
            margin_l = int(mar.get(q("w", "left"), 1440)) / 20
            text_w = page_w - margin_l - int(mar.get(q("w", "right"), 1440)) / 20
        if cols is not None and int(cols.get(q("w", "num"), "1")) > 1:
            num = int(cols.get(q("w", "num")))
            text_w = (text_w - (num - 1) * int(cols.get(q("w", "space"), "720")) / 20) / num

    start_ctx = to_key or "C"
    title_done = False
    # Written keys the scanner found to be out of date ("says Bb major, but the chords look like E").
    corrections: dict[str, str] = {}
    for issue in scan.issues:
        cm = re.search(r"says (\S+) major, but the chords look like (\S+)\.", issue.message)
        if issue.code == "written_key_mismatch" and cm:
            corrections[cm[1]] = cm[2]
    title_key_wrong = any(i.code == "title_key_mismatch" for i in scan.issues)
    if not scanner_agrees:
        # An editor said the scanner got the key wrong, so don't "fix" the sheet using its guess.
        corrections, title_key_wrong = {}, False
    main_keys: list[str] = []
    for r in scan.key_regions:
        if not main_keys or main_keys[-1] != r.key:
            main_keys.append(r.key)
    if main_keys and from_key:
        main_keys[0] = from_key
    new_key_display = "-".join(transpose_key(k, n) for k in main_keys) if main_keys else None
    if title_key_wrong and target_key and main_keys:
        new_key_display = "-".join([target_key] + [transpose_key(k, n) for k in main_keys[1:]])
    if corrections:
        report.warnings.append("Some keys written on the original sheet didn't match its chords; they've been corrected.")
    changed_paras: dict[etree._Element, tuple[list[float], list[Piece]]] = {}

    def process(p: etree._Element, ctx: list[str], in_box: bool) -> None:
        nonlocal title_done
        pieces = paragraph_pieces(p, styles)
        text = "".join(pc.text for pc in pieces)
        stripped = text.strip()
        if not stripped:
            return
        layout = styles.para_layout(p)
        before, before_tabs = _simulate(pieces, layout, default_tab)
        edits: list[tuple[int, int, str]] = []
        pos = 0
        for idx, line in enumerate(text.split("\n")):  # a paragraph can hold several lines
            lo, hi = pos, pos + len(line)
            pos = hi + 1
            line_s = line.strip()
            if not line_s:
                continue
            off = lo + line.index(line_s)
            if ORIGINAL_KEY_RE.search(line_s):
                continue  # the recording's key stays as it is
            km = KEY_HEADER_RE.match(line_s) or KEY_CHANGE_RE.match(line_s)
            if km:
                written = parse_key_name(km[1]) or km[1]
                # If the scanner found this written key was out of date, fix it while we're here.
                new = transpose_key(corrections.get(written, written), n)
                edits.append((off + km.start(1), off + km.end(1), new))
                ctx[0] = new
                report.keys_changed += 1
                continue
            if not in_box and not title_done:
                title_done = True  # the song heading is the first line of the page body
                m = KEY_IN_TITLE_RE.search(line_s)
                if m:
                    if title_key_wrong and new_key_display:
                        # The heading's key didn't match the chords: write the real new key.
                        inner = re.sub(r"[A-Ga-g][#b]?m?(?:\s*[-–—,/→]+\s*[A-Ga-g][#b]?m?)*", new_key_display.replace("→", "-"),
                                       m.group(0), count=1)
                        edits.append((off + m.start(), off + m.end(), inner))
                    else:
                        edits.append((off + m.start(), off + m.end(), transpose_keys_in(m.group(0), n)))
                    report.keys_changed += 1
                    continue
            if chords_in_line(line_s):
                line_edits = _chord_edits(text, lo, hi, pieces, n, ctx[0])
                report.chords_changed += len(line_edits)
                edits.extend(line_edits)
                continue
            # "Band Notes : D E D E" - a short label, then notes/chords only.
            label, colon, rest = line.rpartition(":")
            if colon and rest.strip() and len(label.split()) <= 4 and chords_in_line(rest):
                line_edits = _chord_edits(text, lo + len(label) + 1, hi, pieces, n, ctx[0])
                report.chords_changed += len(line_edits)
                edits.extend(line_edits)
                continue
            # Chords inside a note: "(Repeat one bar of A to go to Verse)", "can also play | Em7 F#7 |".
            spans = inline_chord_spans(line)
            if spans:
                for a, b in spans:
                    line_edits = _chord_edits(text, lo + a, lo + b, pieces, n, ctx[0])
                    report.chords_changed += len(line_edits)
                    edits.extend(line_edits)
                continue
            lk = LABEL_KEY_RE.search(line_s)
            if lk and line_s.endswith(":"):
                new = transpose_key(parse_key_name(lk[1]) or lk[1], n)
                edits.append((off + lk.start(1), off + lk.end(1), new))
                ctx[0] = new
                report.keys_changed += 1
        if edits:
            apply_edits(pieces, edits)
            if before_tabs:
                report.lines_tightened += fit_tab_columns(pieces, layout, default_tab, before_tabs) > 0
                add_column_tab_stops(p, pieces, styles, default_tab, before_tabs)
            changed_paras[p] = (before, pieces)

    def walk(container: etree._Element, ctx: list[str], in_box: bool) -> None:
        for p in container.iter(q("w", "p")):
            # Only paragraphs directly in this container (boxes are walked separately).
            anc = p.getparent()
            nested = False
            while anc is not None and anc is not container:
                if anc.tag == q("w", "txbxContent"):
                    nested = True
                    break
                anc = anc.getparent()
            if nested:
                continue
            process(p, ctx, in_box)
            for box in p.iter(q("w", "txbxContent")):
                parent_box = box.getparent()
                while parent_box is not None and parent_box is not p and parent_box.tag != q("w", "txbxContent"):
                    parent_box = parent_box.getparent()
                if parent_box is p:
                    walk(box, [ctx[0]], True)  # each box starts from the key in force where it sits

    walk(body, [start_ctx], False)

    # --- keep every line on one line ------------------------------------------
    def para_fits(p: etree._Element, limit: float) -> tuple[float, float]:
        before, pieces = changed_paras[p]
        after = line_widths(pieces, styles.para_layout(p), default_tab)
        over_after = max((a - limit for a, b in zip(after, before) if b <= limit + 0.5), default=0.0)
        return over_after, max(after)

    # Right edge of the lyrics column: boxes may not be moved over it.
    lyrics_right = margin_l
    seen_title = False
    for p in body.iter(q("w", "p")):
        if any(a.tag == q("w", "txbxContent") for a in p.iterancestors()):
            continue
        pcs = paragraph_pieces(p, styles)
        if not "".join(x.text for x in pcs).strip():
            continue
        if not seen_title:
            seen_title = True  # the heading usually sits above the box
            continue
        lyrics_right = max(lyrics_right, margin_l + max(line_widths(pcs, styles.para_layout(p), default_tab)) + 8)

    handled: set[etree._Element] = set()
    for alt in doc.iter(q("mc", "AlternateContent")):
        choice = alt.find("mc:Choice", NS)
        if choice is None:
            continue
        wsp = next(choice.iter(q("wps", "wsp")), None)
        if wsp is None or wsp.find("wps:txbx", NS) is None:
            continue
        inner = _box_inner_width(wsp)
        box_paras = list(alt.iter(q("w", "p")))
        handled.update(box_paras)
        if inner is None:
            continue
        need = 0.0
        for p in box_paras:
            if p in changed_paras:
                over, _ = para_fits(p, inner)
                need = max(need, over)
        if need > 0:
            add = need + 1.5  # a little breathing room
            granted = _widen_box(alt, add, page_w, margin_l, lyrics_right)
            if granted > 0:
                report.boxes_widened.append(round(granted, 1))
            if granted < add - 0.01:
                # Not enough room beside the lyrics: make just the overflowing lines a bit smaller.
                limit = inner + granted
                for p in box_paras:
                    if p in changed_paras and para_fits(p, limit)[0] > 0:
                        size = shrink_to_fit(p, changed_paras[p][1], styles, default_tab, limit)
                        if size and p in choice.iter(q("w", "p")):
                            report.lines_shrunk += 1
                        if para_fits(p, limit)[0] > 0 and p in list(choice.iter(q("w", "p"))):
                            report.warnings.append(
                                "A chord line is still too wide for its box and may wrap: "
                                + "".join(x.text for x in changed_paras[p][1]).strip()[:60]
                            )

    for p, (before, pieces) in changed_paras.items():
        if p in handled:
            continue
        # Body text can't be widened: tighten long runs of spaces until it fits.
        over, _ = para_fits(p, text_w)
        guard = 0
        while over > 0 and guard < 40:
            guard += 1
            best = None
            for pc in pieces:
                if pc.kind == "t":
                    for m in re.finditer(r" {3,}", pc.text):
                        if best is None or len(m.group(0)) > best[2]:
                            best = (pc, m.start(), len(m.group(0)))
            if best is None:
                report.warnings.append(f"A chord line is wider than the page and may wrap: {''.join(x.text for x in pieces).strip()[:60]}")
                break
            pc, at, _ = best
            pc.text = pc.text[:at] + pc.text[at + 1:]
            pc.el.text = pc.text
            report.lines_tightened += 1
            over, _ = para_fits(p, text_w)

    # --- write the new file -------------------------------------------------------
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename == "word/document.xml":
                zout.writestr(item, etree.tostring(doc, xml_declaration=True, encoding="UTF-8", standalone=True))
            else:
                zout.writestr(item, zin.read(item.filename))
    return out.getvalue(), report


def transposed_file_name(name: str, from_key: str | None, n: int, to_key: str | None) -> str:
    """'Abide (E-F#) 74.docx' -> 'Abide (G-A) 74.docx'.

    The key in the file name is only reused if it matches the sheet's actual key (file names
    are sometimes out of date); otherwise it's dropped and the new key is added at the end.
    """
    stem = name.rsplit(".", 1)[0] if "." in name else name
    matches = list(re.finditer(r"\s*\((\s*[A-Ga-g][#b]?m?(?:\s*[-,]\s*[A-Ga-g][#b]?m?)*\s*)\)", stem))
    if matches:
        m = matches[-1]
        first = parse_key_name(re.split(r"[-,]", m.group(1))[0].strip())
        if first and from_key and NOTE_TO_PC[first.rstrip("m")] == NOTE_TO_PC[from_key.rstrip("m")]:
            return f"{stem[: m.start()]} ({transpose_keys_in(m.group(1).strip(), n)}){stem[m.end():]}.docx"
        stem = (stem[: m.start()] + stem[m.end():]).strip()
    return f"{stem} ({to_key}).docx" if to_key else f"{stem}.docx"
