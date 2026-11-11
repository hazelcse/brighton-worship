"""Scan a songsheet .docx and pull out the song's details.

Reads the document's content only; the file name is never used.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

from .docx_text import DocText, extract
from collections import Counter

from .music import NOTE_TO_PC, Chord, chords_in_line, estimate_key, key_scores, parse_key_name, spell_key

SCANNER_VERSION = 2  # 2: Chinese sheets (Key: lines, full-width punctuation, Sequence boxes, bilingual titles)

# ---------------------------------------------------------------------------
# Line patterns
# ---------------------------------------------------------------------------

SECTION_WORDS = (
    r"intro|verse|pre[\s-]?chorus|post[\s-]?chorus|chorus|bridge|tag|outro|interlude|instrumental|"
    r"music|vamp|ending|outtro|refrain|turnaround|breakdown|coda|hook|channel|solo|spontaneous|"
    r"last\s+line|to\s+\w+|link|riff|notes|melody|lead\s+line|chords"
)
SECTION_RE = re.compile(rf"^\s*(?P<name>(?:{SECTION_WORDS})\b[^:]{{0,50}}?)\s*:\s*(?P<rest>.*)$", re.IGNORECASE)
# One or more labels on a line of their own: "Verse 2", "Intro / Music", "Verse 1, 2", "[Verse 1]".
_LABEL = rf"(?:{SECTION_WORDS})(?:\s*\d+)?"
SECTION_BARE_RE = re.compile(
    rf"^\s*\[?\s*(?P<name>{_LABEL}(?:\s*[/,&+]\s*(?:{_LABEL}|\d+))*)\s*\]?\s*$", re.IGNORECASE
)
# "Key: G | ♩ = 73 | 4/4 | Artist | https://…": a key with the song's other details after it.
KEY_LINE_RE = re.compile(
    r"^\s*key\s*(?:of)?\s*[:=]\s*([A-G][#b♯♭]?)\s*(major|minor|maj|min)?\b\.?\s*(?:\([^)]*\))?\s*(?:\|(?P<rest>.*))?$",
    re.IGNORECASE,
)
# "Sequence:" heads the song's order (Intro, Verse x2, Chorus (half time), ...).
SEQUENCE_HEAD_RE = re.compile(r"^\s*(?:song\s*)?(?:sequence|order|flow)\s*:?\s*$", re.IGNORECASE)
KEY_HEADER_RE = re.compile(
    r"^\s*(?:key\s*(?:of)?\s*:?\s*)?([A-G][#b♯♭]?)\s*(major|minor|maj|min)\b\.?\s*(?:\(.*\))?\s*:?\s*$", re.IGNORECASE
)
KEY_CHANGE_RE = re.compile(
    r"^\s*(?:transpose|modulate|key\s*change|change\s*key|change|up|down)\s*(?:\w+\s*)?(?:to|:)\s*([A-G][#b♯♭]?)(?:\s*(?:major|maj))?\s*:?\s*$",
    re.IGNORECASE,
)
TEMPO_RE = re.compile(r"(?:tempo|bpm)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)|(\d{2,3}(?:\.\d+)?)\s*bpm", re.IGNORECASE)
TIME_SIG_RE = re.compile(r"time\s*sig(?:nature)?\s*[:=]?\s*(\d{1,2}\s*/\s*\d{1,2})", re.IGNORECASE)
ORIGINAL_KEY_RE = re.compile(r"original\s*key\s*[:=]?\s*(.+)", re.IGNORECASE)
ARTIST_RE = re.compile(r"^\s*(?:artist|by)\s*[:=]\s*(.+)", re.IGNORECASE)
YOUTUBE_RE = re.compile(r"https?://(?:www\.|m\.)?(?:youtube\.com/[^\s<>\"']+|youtu\.be/[^\s<>\"']+)", re.IGNORECASE)
METADATA_RE = re.compile(r"^\s*(tempo|time\s*sig|original\s*key|artist|youtube|link\s*:|bpm)", re.IGNORECASE)
KEY_IN_TITLE_RE = re.compile(
    r"\s*\(\s*(?:key\s*(?:of)?\s*:?\s*)?(?:[A-Ga-g][#b]?m?(?:\s*[-–—,/→>]+\s*[A-Ga-g][#b]?m?)*|nns)\s*\)",
    re.IGNORECASE,
)
YOUTUBE_VIDEO_RE = re.compile(r"(?:[?&]v=|youtu\.be/|/shorts/|/live/|/embed/|[?&]list=)[\w-]{6,}", re.IGNORECASE)
LABEL_KEY_RE = re.compile(r"\(\s*([A-G][#b♯♭]?)\s*(?:major|maj)?\s*\)", re.IGNORECASE)
MELODY_LABEL_RE = re.compile(r"riff|notes|melody|lead", re.IGNORECASE)
# Full-width punctuation from Chinese input methods, as the ASCII the patterns expect.
_FULLWIDTH = str.maketrans({"｜": "|", "／": "/", "（": "(", "）": ")", "：": ":", "［": "[", "］": "]", "＃": "#"})
TITLE_TAG_RE = re.compile(r"\s*【[^】]*】")  # "【Youtube】"
SCRIPTURE_RE = re.compile(r"\d+\s*:\s*\d+")
BARE_TEMPO_RE = re.compile(r"^\W*=\s*(\d{2,3}(?:\.\d+)?)\s*$")  # "♩ = 73" (the note is often a symbol Word drops)
TIME_SIG_FIELD_RE = re.compile(r"^\s*(\d{1,2}\s*/\s*\d{1,2})\s*$")
CJK_RE = re.compile(r"[㐀-鿿豈-﫿]")

SECTION_ORDER = [
    "Intro", "Verse", "Pre-Chorus", "Chorus", "Post-Chorus", "Bridge", "Interlude", "Instrumental",
    "Music", "Solo", "Breakdown", "Vamp", "Refrain", "Hook", "Spontaneous", "Tag", "Turnaround",
    "Outro", "Ending", "Coda", "Channel",
]
_CANON = {re.sub(r"[\s-]", "", s.lower()): s for s in SECTION_ORDER} | {"outtro": "Outro"}


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


@dataclass
class KeyRegion:
    key: str
    source: str  # "explicit" (written on the sheet) | "estimated" (from chords)
    confidence: float
    first_section: str | None = None


@dataclass
class Issue:
    """Something on the sheet that needs a human to check. Shown in the UI."""

    code: str
    severity: str  # "error" (key/title unusable) | "warning" (probably wrong) | "info" (missing extra)
    message: str


@dataclass
class ScanResult:
    scanner_version: int
    title: str | None
    artist: str | None
    original_key: str | None
    bpm: float | None
    time_signature: str | None
    key_regions: list[KeyRegion]
    key_display: str | None  # e.g. "E→F#" (a key change within the song)
    alternate_keys: list[str]  # the same chart written out again in another key, e.g. male/female
    sections: list[str]
    chart_sequence: list[str]  # order of the chord chart headers (right-hand side)
    lyric_sequence: list[str]  # order of the lyric section headers
    sequence: list[str]  # the order written in a "Sequence" box, e.g. Intro, Verse, Verse, Chorus
    youtube_links: list[str]
    language: str  # "en" | "zh"
    suggested_type: str | None  # "praise" | "worship" | "praise_worship"
    confidence: float
    issues: list[Issue] = field(default_factory=list)
    lyrics: str = ""  # the lyric lines as plain text, one per line (for searching the library)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Section names
# ---------------------------------------------------------------------------


def _canonical_section(word: str) -> str | None:
    return _CANON.get(re.sub(r"[\s-]", "", word.lower()))


def expand_section_label(label: str) -> list[str]:
    """'Intro / Verse 1 / 2 / 3' -> ['Intro', 'Verse 1', 'Verse 2', 'Verse 3'].

    Transitions like 'Chorus to Verse' return [] (they are not sections).
    """
    label = re.sub(r"\(.*?\)", "", label)  # drop '(When Repeat)', '(Piano)', '(Cont..)'
    label = label.strip(" .:-")
    if re.search(r"(^|\s)to\s", label, re.IGNORECASE) or re.match(r"last\s+line", label, re.IGNORECASE):
        return []
    out: list[str] = []
    current: str | None = None
    for part in re.split(r"\s*[/,&+]\s*|\s+and\s+", label):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^([A-Za-z][A-Za-z\s-]*?)\s*(\d+)?$", part)
        if m:
            canon = _canonical_section(m[1])
            if canon:
                current = canon
                out.append(f"{canon} {m[2]}" if m[2] else canon)
                continue
        if part.isdigit() and current:
            out.append(f"{current} {part}")
    return out


def _section_sort_key(name: str) -> tuple[int, int]:
    base, _, num = name.partition(" ")
    idx = SECTION_ORDER.index(base) if base in SECTION_ORDER else len(SECTION_ORDER)
    return idx, int(num) if num.isdigit() else 0


def _dedupe(seq: list[str]) -> list[str]:
    seen: set[str] = set()
    return [s for s in seq if not (s in seen or seen.add(s))]


# ---------------------------------------------------------------------------
# Title
# ---------------------------------------------------------------------------

_SMALL_WORDS = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"}


_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’]*")
# Leftovers that aren't part of a song's name.
_TITLE_NOISE = [
    re.compile(r"\s*[\(\[]\s*lyrics?\s*[\)\]]", re.IGNORECASE),
    re.compile(r"\s*[\(\[]\s*live\s*[\)\]]", re.IGNORECASE),
    re.compile(r"\s*[-–—]\s*live\s*$", re.IGNORECASE),
    re.compile(r"\s*[-–—,]?\s*key\s*(?:of)?\s*:?\s*[A-G][#b]?m?(?:\s*[-–—,/]\s*[A-G][#b]?m?)*", re.IGNORECASE),
]


def _title_case(text: str) -> str:
    """Consistent Title Case, keeping short acronyms in brackets like (CHC)."""

    def fix(m: re.Match) -> str:
        word = m.group(0)
        start = m.start()
        before = text[:start].rstrip()
        in_brackets = text.count("(", 0, start) > text.count(")", 0, start)
        if in_brackets and word.isupper() and len(word) <= 4:
            return word  # acronym, e.g. CHC
        lw = word.lower()
        starts_phrase = not before or before[-1] in "(-–—/:"
        if lw in _SMALL_WORDS and not starts_phrase and m.end() != len(text.rstrip(" )")):
            return lw
        return lw[:1].upper() + lw[1:]

    return _WORD_RE.sub(fix, text)


def clean_title(raw: str) -> tuple[str, str | None]:
    """Remove a key like '(E-F#)' or '(Key: G-A)', strip noise, and use consistent Title Case.

    Returns (title, key text that was removed).
    """
    text = raw.strip().strip("\t")
    key_text = None
    m = KEY_IN_TITLE_RE.search(text)
    if m:
        key_text = m.group(0).strip(" ()")
        text = (text[: m.start()] + text[m.end():]).strip()
    for noise in _TITLE_NOISE:
        nm = noise.search(text)
        if nm and key_text is None and "key" in nm.group(0).lower():
            key_text = nm.group(0).strip(" -–—,")
        text = noise.sub("", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" -–—")
    return _title_case(text), key_text


# ---------------------------------------------------------------------------
# Main scan
# ---------------------------------------------------------------------------


@dataclass
class _ChartSection:
    label: str
    names: list[str]
    chords: list[Chord] = field(default_factory=list)
    explicit_key: str | None = None
    group: int = 0  # parallel charts / key regions get separate groups


def scan_text(doc: DocText) -> ScanResult:
    issues: list[Issue] = []

    def flag(code: str, severity: str, message: str) -> None:
        issues.append(Issue(code, severity, message))

    lines_all = [_normalise(l) for l in doc.all_lines()]
    text_all = "\n".join(lines_all)

    # --- metadata -----------------------------------------------------------
    # "Key: G | 80 BPM | 4/4 | Artist | link": the details after the key, one per field.
    meta_tempos: list[str] = []
    meta_time_sig: str | None = None
    meta_artist: str | None = None
    for line in lines_all:
        km = KEY_LINE_RE.match(line)
        for f in (km["rest"] or "").split("|") if km else []:
            f = f.strip()
            if not f or YOUTUBE_RE.search(f) or re.fullmatch(r"(?i)link|youtube", f):
                continue
            if TEMPO_RE.search(f):
                continue  # "80 BPM" is picked up below
            if bm := BARE_TEMPO_RE.match(f):
                meta_tempos.append(str(float(bm[1])))
            elif tm := TIME_SIG_FIELD_RE.match(f):
                meta_time_sig = meta_time_sig or re.sub(r"\s", "", tm[1])
            elif not SCRIPTURE_RE.search(f) and meta_artist is None and re.search(r"[A-Za-z]|" + CJK_RE.pattern, f):
                # "赞美之泉11 - 宝贵十架" is the artist's album 11: keep the artist.
                meta_artist = re.sub(r"\s*\d+\s*[-–—]\s*.*$", "", f).strip() or f

    tempos = _dedupe([str(float(m[1] or m[2])) for line in lines_all for m in TEMPO_RE.finditer(line)] + meta_tempos)
    bpm = float(tempos[0]) if tempos else None
    if len(tempos) > 1:
        flag("multiple_tempos", "warning",
             f"The sheet lists more than one tempo ({', '.join(t.removesuffix('.0') for t in tempos)} bpm). Using the first.")
    time_sig = next((re.sub(r"\s", "", m[1]) for l in lines_all if (m := TIME_SIG_RE.search(l))), None) or meta_time_sig
    original_key = next((m[1].strip() for l in lines_all if (m := ORIGINAL_KEY_RE.search(l))), None)
    artist = next((m[1].strip().rstrip(",;&") .strip() for l in lines_all if (m := ARTIST_RE.match(l))), None) or meta_artist
    found_links = _dedupe(
        [u.rstrip(".,)") for u in YOUTUBE_RE.findall(text_all)] + [h for h in doc.hyperlinks if YOUTUBE_RE.match(h)]
    )
    links = [u for u in found_links if YOUTUBE_VIDEO_RE.search(u)]
    broken = [u for u in found_links if u not in links]
    if broken:
        flag("broken_youtube_link", "warning", f"YouTube link is incomplete (no video in it): {broken[0]}")
    elif not links:
        flag("no_youtube_link", "info", "No YouTube reference link on the sheet.")

    # --- walk every block: title, lyric sections, chord chart ---------------
    title_raw: str | None = None
    lyric_sequence: list[str] = []
    lyric_text: list[str] = []
    chart: list[_ChartSection] = []
    current_key: str | None = None
    any_explicit_key = False

    group = 0
    group_first: str | None = None  # first section label of the current chart group

    def new_chart(label: str, names: list[str], chords: list[Chord]) -> _ChartSection:
        nonlocal group, group_first
        first = names[0] if names else None
        # The chart starts over from its first section: a second, parallel chart.
        if first and group_first and first == group_first and any(c.group == group for c in chart):
            group += 1
            group_first = None
        if group_first is None:
            group_first = first
        section = _ChartSection(label, names, chords, current_key, group)
        chart.append(section)
        return section

    sequence: list[str] = []
    body_lines: list[str] = []  # every body line after the title, for a medley's or bilingual sheet's other title
    body_key_seen = False

    for block in doc.blocks:
        current_chart: _ChartSection | None = None
        pending_label: tuple[str, list[str]] | None = None
        in_sequence = False
        keep_sequence = False
        for raw in block.lines:
            line = _normalise(raw).strip()
            if not line:
                continue
            if block.kind == "body" and title_raw is not None:
                body_lines.append(line)

            # A "Sequence" list: the song's order, not lyrics. It runs until a line that isn't part of it.
            # A sheet written out again in other keys repeats it: keep the first.
            if SEQUENCE_HEAD_RE.match(line):
                in_sequence, current_chart, pending_label = True, None, None
                keep_sequence = not sequence
                continue
            if in_sequence:
                steps = _sequence_steps(line)
                if steps is not None:
                    if keep_sequence:
                        sequence.extend(steps)
                    continue
                in_sequence = False

            km = KEY_HEADER_RE.match(line) or KEY_CHANGE_RE.match(line) or KEY_LINE_RE.match(line)
            if km and km.re is KEY_LINE_RE and block.kind == "body":
                # The heading's "Key: A | …". Another one further down the body heads a page with
                # the chart written out in another key; those charts' keys come from their chords.
                if body_key_seen:
                    continue
                body_key_seen = True
            if km:
                quality = km[2] if km.re is not KEY_CHANGE_RE else "major"
                current_key = parse_key_name(km[1] + " " + (quality or "major"))
                any_explicit_key = True
                group += 1
                group_first = None
                current_chart = None
                continue

            if METADATA_RE.match(line):
                continue

            sm = SECTION_RE.match(line) or SECTION_BARE_RE.match(line)
            if sm:
                label = sm["name"].strip()
                names = expand_section_label(label)
                # A key written in the label, e.g. "Chorus (F# Major):"
                lk = LABEL_KEY_RE.search(label)
                if lk:
                    current_key = parse_key_name(lk[1])
                    any_explicit_key = True
                    group += 1
                    group_first = None
                rest = (sm.groupdict().get("rest") or "").strip()
                if re.fullmatch(r"\(.*\)", rest):
                    rest = ""  # "Intro: (EG)": a note on who plays it
                pending_label = (label, names)
                current_chart = None
                if rest:
                    chords = chords_in_line(rest)
                    if chords:
                        current_chart = new_chart(label, names, list(chords))
                        pending_label = None
                    else:
                        lyric_sequence.extend(names)
                        lyric_text.append(rest)
                        pending_label = None
                continue

            chords = chords_in_line(line)
            if chords and _is_melody_line(line, chords):
                continue  # single notes of a riff, not chords
            if chords and pending_label and MELODY_LABEL_RE.search(pending_label[0]):
                continue
            if chords and current_chart is not None and MELODY_LABEL_RE.search(current_chart.label):
                continue
            if chords:
                if current_chart is None:
                    label, names = pending_label or ("", [])
                    current_chart = new_chart(label, names, [])
                    pending_label = None
                current_chart.chords.extend(chords)
                continue

            # A lyric (or title) line.
            if title_raw is None and block.kind == "body":
                title_raw = line
                continue
            if pending_label:
                lyric_sequence.extend(pending_label[1])
                pending_label = None
            lyric_text.append(line)

    # --- title ----------------------------------------------------------------
    title = None
    title_key_text = None
    if title_raw:
        title, title_key_text = clean_title(TITLE_TAG_RE.sub("", title_raw))
    # Chinese sheets put the artist after the title: "求主充滿我 (赞美之泉)".
    if title and CJK_RE.search(title) and (tm := re.fullmatch(r"(.+?)\s*\(([^()]+)\)", title)):
        title, from_title = tm[1].strip(), tm[2].strip()
        artist = artist or from_title
        # A medley names its next song the same way further down: "十字架 (赞美之泉)".
        for line in body_lines:
            nm = re.fullmatch(r"(.+?)\s*\(\s*" + re.escape(from_title) + r"\s*\)", line)
            if nm and CJK_RE.search(nm[1]) and nm[1].strip() not in title:
                title += " / " + nm[1].strip()
    # A bilingual sheet starts the song again in its other language under that language's title:
    # "我的盼望" then "Verse 1:" again. Named Chinese first: "我的盼望 - Living Hope".
    if title and lyric_sequence:
        other = _other_language_title(title, body_lines, lyric_sequence[0])
        if other:
            zh, en = (title, other) if CJK_RE.search(title) else (other, title)
            title = f"{zh} - {_title_case(en.lower())}"
    if not title:
        flag("no_title", "error", "Couldn't find the song title.")
    if not artist:
        flag("no_artist", "info", "No artist on the sheet.")

    # --- keys -----------------------------------------------------------------
    regions, alternate_keys = _key_regions(chart, any_explicit_key, flag)
    title_keys = [k for k in (parse_key_name(p.strip()) for p in re.split(r"[-–—,/→>]+", title_key_text or "")) if k]
    if not regions and title_keys:
        # A lyric sheet with no chords: the key in the heading, e.g. "LIVING HOPE (G)", is all there is.
        regions = [KeyRegion(k, "explicit", 1.0) for k in _dedupe_consecutive(title_keys)]
        flag("no_chords", "warning", f"No chords on the sheet, so the key ({title_key_text}) comes from the heading.")
        title_key_text = None  # nothing to check it against
    key_display = "→".join(_dedupe_consecutive([r.key for r in regions])) or None
    if not regions:
        flag("no_chords", "error", "No chords found, so the key couldn't be worked out.")
    elif any(r.source == "estimated" and r.confidence < 0.5 for r in regions):
        flag("low_key_confidence", "warning", "The key was guessed from the chords with low confidence. Please check it.")

    # The heading often repeats the key, e.g. "ABIDE (E-F#)". Check it agrees with the chords.
    if title_key_text and regions:
        written = _keys_in_text(title_key_text)
        main = [NOTE_TO_PC[k.rstrip("m")] for k in _dedupe_consecutive([r.key for r in regions])]
        anywhere = set(main) | {NOTE_TO_PC[k.rstrip("m")] for k in alternate_keys}
        # A heading usually names just the starting key, so only flag a different
        # starting key, or a key that appears nowhere on the sheet.
        if written and (written[0] != main[0] or not set(written) <= anywhere):
            shown = key_display + (f" (also written out in {', '.join(alternate_keys)})" if alternate_keys else "")
            flag("title_key_mismatch", "warning",
                 f"The heading says ({title_key_text}) but the chords are in {shown}.")

    if bpm is None:
        flag("no_bpm", "warning", "No tempo (bpm) found.")

    # --- sections ---------------------------------------------------------------
    chart_sequence = _dedupe([n for c in chart for n in c.names])
    lyric_sequence = _dedupe_consecutive(lyric_sequence)
    sections = _drop_bare_duplicates(sorted(_dedupe(chart_sequence + lyric_sequence), key=_section_sort_key))

    # --- language and type ------------------------------------------------------
    # Chinese sheets often have a pinyin line under each line, so count lines, not letters.
    cjk_lines = sum(1 for t in lyric_text if CJK_RE.search(t))
    # A bilingual sheet (Chinese, then the English) is a Chinese sheet too.
    language = "zh" if lyric_text and (cjk_lines / len(lyric_text) > 0.25 or cjk_lines >= 8) else "en"

    suggested_type = None
    if bpm is not None:
        suggested_type = "worship" if bpm < 78 else "praise_worship" if bpm <= 100 else "praise"

    # --- confidence -------------------------------------------------------------
    score = 1.0
    if not title:
        score -= 0.3
    if bpm is None:
        score -= 0.15
    if not regions:
        score -= 0.35
    else:
        score -= 0.3 * (1 - min(r.confidence for r in regions))
    if not sections:
        score -= 0.1
        flag("no_sections", "warning", "No section headings (Verse, Chorus…) found.")

    return ScanResult(
        scanner_version=SCANNER_VERSION,
        title=title,
        artist=artist,
        original_key=original_key,
        bpm=bpm,
        time_signature=time_sig,
        key_regions=regions,
        key_display=key_display,
        alternate_keys=alternate_keys,
        sections=sections,
        chart_sequence=chart_sequence,
        lyric_sequence=lyric_sequence,
        sequence=sequence,
        youtube_links=links,
        language=language,
        suggested_type=suggested_type,
        confidence=round(max(0.0, score), 2),
        issues=issues,
        lyrics="\n".join(lyric_text),
    )


def _normalise(line: str) -> str:
    return line.translate(_FULLWIDTH)


def _other_language_title(title: str, body_lines: list[str], first_section: str) -> str | None:
    """On a bilingual sheet, the song's title in its other language, if the sheet gives one.

    It's a line on its own just before the song starts over (the first lyric section again), in
    the other script: a short Chinese line with no spaces or punctuation, or an English line in
    capitals like the heading.
    """
    want_cjk = not CJK_RE.search(title)
    # Its own "Key: G | 80 BPM" line can come between.
    lines = [l for l in body_lines if not (KEY_LINE_RE.match(l) or METADATA_RE.match(l))]
    for line, nxt in zip(lines, lines[1:]):
        sm = SECTION_RE.match(nxt) or SECTION_BARE_RE.match(nxt)
        if not sm or first_section not in expand_section_label(sm["name"].strip()):
            continue
        cand = line.strip()
        if want_cjk:
            if re.fullmatch(r"[㐀-鿿豈-﫿]{2,12}", cand):
                return cand
        elif not CJK_RE.search(cand) and cand.isupper() and re.fullmatch(r"[A-Z][A-Z' ]{2,40}", cand):
            return cand
    return None


# "L2L", "LL", "Last Chorus": shorthand worship leaders use in a sequence.
_SEQ_EXTRA_RE = re.compile(r"^(?:L\d?L|last\s+(?:chorus|line|verse)|end(?:ing)?)$", re.IGNORECASE)


def _sequence_steps(line: str) -> list[str] | None:
    """One line of a "Sequence" list as the steps it stands for, or None if it isn't one.

    "Verse x2" -> [Verse, Verse]; "Chorus (half time)" -> [Chorus]; "(last line half-time)" -> []
    (a note on the step before); "Intro / Verse 1" -> [Intro, Verse 1]; "L2L" -> [L2L].
    """
    if re.fullmatch(r"\(.*\)|\[.*\]", line):
        return []
    if re.fullmatch(r"[^:|]{1,30}:", line) and not SECTION_RE.match(line):
        return []  # a heading within the list, e.g. "Straight Feel:"
    text = re.sub(r"\(.*?\)", "", line).strip(" .:-")
    times = 1
    if m := re.search(r"\s*[x×*]\s*(\d{1,2})\s*$", text, re.IGNORECASE):
        times, text = int(m[1]), text[: m.start()].strip()
    text = re.sub(r"(?i)^([a-z-]+?)(\d+)$", r"\1 \2", text)  # "Verse1" -> "Verse 1"
    names = expand_section_label(text) if text else []
    if not names:
        if not _SEQ_EXTRA_RE.match(text):
            return None
        names = [text[0].upper() + text[1:] if not text[:2].isupper() else text]
    return names * min(times, 8)


def _keys_in_text(text: str) -> list[int]:
    """Pitch classes of the keys in 'E-F#', 'Key: G-A', 'Em' (as its relative major). 'NNS' -> []."""
    text = re.sub(r"(?i)^key\s*(of)?\s*:?", "", text)
    keys: list[int] = []
    for part in re.split(r"[-–—,/→>]+", text):
        k = parse_key_name(part.strip())
        if k:
            pc = NOTE_TO_PC[k.rstrip("m")]
            keys.append((pc + 3) % 12 if k.endswith("m") else pc)  # minor -> relative major
    return keys


def _drop_bare_duplicates(sections: list[str]) -> list[str]:
    """Drop 'Verse' when 'Verse 1', 'Verse 2' are also listed."""
    numbered = {s.split(" ")[0] for s in sections if " " in s}
    return [s for s in sections if " " in s or s not in numbered]


def _is_melody_line(line: str, chords: list[Chord]) -> bool:
    """'B B C# C# E (x2)' is a riff written as note names, not a chord progression."""
    if "|" in line or len(chords) < 4:
        return False
    plain = all(not c.quality and not c.bass for c in chords)
    repeats = any(a == b for a, b in zip(chords, chords[1:]))
    return plain and repeats


def _dedupe_consecutive(seq: list[str]) -> list[str]:
    out: list[str] = []
    for s in seq:
        if not out or out[-1] != s:
            out.append(s)
    return out


def _non_diatonic(chords: list[Chord], tonic: int) -> int:
    """How many chords don't belong to the major key on this tonic."""
    from .music import _chord_fit

    return sum(1 for c in chords if _chord_fit(c, tonic) < 0)


def _is_transposed_copy(a: list[Chord], b: list[Chord]) -> int | None:
    """If chart b is chart a moved to another key, return the shift in semitones."""
    if not a or not b or abs(len(a) - len(b)) > 0.25 * max(len(a), len(b)):
        return None
    shifts = Counter((y.root_pc - x.root_pc) % 12 for x, y in zip(a, b))
    shift, n = shifts.most_common(1)[0]
    if shift == 0 or n < 0.7 * min(len(a), len(b)):
        return None
    return shift


def _key_regions(chart: list[_ChartSection], any_explicit: bool, flag) -> tuple[list[KeyRegion], list[str]]:
    """Work out the key of each part of the chart, in order.

    Returns (key regions of the main chart, keys of alternate copies of the chart).
    """
    with_chords = [c for c in chart if c.chords]
    if not with_chords:
        return [], []

    # Charts that are a transposed copy of an earlier chart are alternates, not key changes.
    group_ids = sorted({c.group for c in with_chords})
    group_chords = {g: [ch for c in with_chords if c.group == g for ch in c.chords] for g in group_ids}
    alternates: dict[int, int] = {}  # group -> group it copies
    for i, g in enumerate(group_ids):
        for prev in group_ids[:i]:
            if prev not in alternates and _is_transposed_copy(group_chords[prev], group_chords[g]) is not None:
                alternates[g] = prev
                break
    alt_sections = [c for c in with_chords if c.group in alternates]
    with_chords = [c for c in with_chords if c.group not in alternates]

    regions: list[KeyRegion] = []

    def add(key: str, source: str, conf: float, section: _ChartSection):
        first = section.names[0] if section.names else None
        if regions and regions[-1].key == key:
            if source == "estimated" and regions[-1].source == "estimated":
                regions[-1].confidence = min(regions[-1].confidence, conf)
            return
        regions.append(KeyRegion(key, source, conf, first))

    if any_explicit:
        # Group sections by the written key they sit under, and check each written
        # key against its chords: sheets are sometimes transposed without updating it.
        groups: list[tuple[str | None, list[_ChartSection]]] = []
        for c in with_chords:
            if groups and groups[-1][0] == c.explicit_key:
                groups[-1][1].append(c)
            else:
                groups.append((c.explicit_key, [c]))
        for written, sections in groups:
            chords = [ch for c in sections for ch in c.chords]
            est, conf = estimate_key(chords)
            if written is None:
                if est:
                    add(est, "estimated", conf, sections[0])
                continue
            scores = dict((t, sc) for sc, t in key_scores(chords))
            written_tonic = NOTE_TO_PC[written.rstrip("m")]
            best_score, best_tonic = key_scores(chords)[0]
            if (
                best_tonic != written_tonic
                and best_score - scores[written_tonic] > 1.0
                and _non_diatonic(chords, written_tonic) >= 2
            ):
                flag("written_key_mismatch", "warning",
                     f"The sheet says {written} major, but the chords look like {est}. Using {est}.")
                add(est, "estimated", conf, sections[0])
            else:
                add(written, "explicit", 1.0, sections[0])
        return regions, _alternate_keys(alt_sections, regions)

    # No written key: estimate each chart group, then look for sections that
    # clearly sit in a different key (a modulation, e.g. a last chorus up a tone).
    for g in sorted({c.group for c in with_chords}):
        _estimate_group([c for c in with_chords if c.group == g], add)
    return regions, _alternate_keys(alt_sections, regions)


def _alternate_keys(sections: list[_ChartSection], regions: list[KeyRegion]) -> list[str]:
    main = {r.key for r in regions}
    keys: list[str] = []
    for g in sorted({c.group for c in sections}):
        group = [c for c in sections if c.group == g]
        # A copy in another key can't be in the main chart's key: if it says it is, that's the key
        # written once at the top of the sheet carrying over, so go by its chords.
        key = group[0].explicit_key
        if not key or key in main:
            key = estimate_key([ch for c in group for ch in c.chords])[0]
        if key and key not in main and key not in keys:
            keys.append(key)
    return keys


def _estimate_group(with_chords: list[_ChartSection], add) -> None:
    all_chords = [ch for c in with_chords for ch in c.chords]
    global_key, global_conf = estimate_key(all_chords)
    global_tonic = key_scores(all_chords)[0][1]
    for c in with_chords:
        scores = key_scores(c.chords)
        best_score, best_tonic = scores[0]
        global_score = next(s for s, t in scores if t == global_tonic)
        if (
            best_tonic != global_tonic
            and len(c.chords) >= 4
            and best_score - global_score > 1.2
            and _non_diatonic(c.chords, global_tonic) >= 2
        ):
            add(spell_key(best_tonic, c.chords), "estimated", min(0.8, global_conf), c)
        else:
            add(global_key, "estimated", global_conf, c)


def scan_docx(docx_bytes: bytes) -> ScanResult:
    return scan_text(extract(docx_bytes))
