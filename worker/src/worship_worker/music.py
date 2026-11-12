"""Chord parsing, key estimation and transposition maths."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

NOTE_TO_PC = {
    "C": 0, "B#": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4, "E#": 5,
    "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11,
}
SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Conventional spelling of major keys (and the accidentals used inside them).
MAJOR_KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
FLAT_KEYS = {"F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"}

# Root, then quality/extensions, then an optional slash bass.
CHORD_RE = re.compile(
    r"""^
    (?P<root>[A-G](?:\#|b)?)
    (?P<quality>
        (?:maj|ma|M|min|mi|m|dim|aug|sus|add|\+|°|ø|o)?
        [0-9]*
        (?:\((?:[^)]*)\))?
        (?:(?:sus|add|maj|ma|no|b|\#|\+|-|,)?[0-9]+|sus)*
    )
    (?:/(?P<bass>[A-G](?:\#|b)?))?
    $""",
    re.VERBOSE,
)

# Tokens that may appear in a chord line without being chords.
NON_CHORD_TOKENS = re.compile(
    r"""^(
        \|+:?|:?\|+|\|\|:|:\|\||          # bar lines and repeats
        [~\-–—.%/\\]+|                    # holds, dashes, slashes
        x\d+|\d+x|\(x\d+\)|               # repeat counts
        \d+\.|                            # numbered endings: "1." "2."
        \d+/\d+|                          # time signature changes
        N\.?C\.?|\(.*\)                   # no chord, parenthetical notes
    )$""",
    re.VERBOSE | re.IGNORECASE,
)


@dataclass(frozen=True)
class Chord:
    root: str
    quality: str
    bass: str | None

    @property
    def root_pc(self) -> int:
        return NOTE_TO_PC[self.root]

    @property
    def is_minor(self) -> bool:
        q = self.quality
        return (q.startswith("m") and not q.startswith(("maj", "ma"))) or q.startswith(("mi", "min"))

    @property
    def is_diminished(self) -> bool:
        return self.quality.startswith(("dim", "°", "o", "ø"))

    def __str__(self) -> str:
        return f"{self.root}{self.quality}{'/' + self.bass if self.bass else ''}"


def parse_chord(token: str) -> Chord | None:
    m = CHORD_RE.match(token.strip())
    if not m:
        return None
    return Chord(m["root"], m["quality"] or "", m["bass"])


def tokenize_chord_line(line: str) -> list[str]:
    """Split a chart line into tokens, separating bar lines from chords."""
    line = line.replace(" ", " ")
    line = re.sub(r"(?<=[A-Za-z0-9#])/\s+(?=[A-G])", "/", line)  # "Bb/ F" -> "Bb/F"
    line = re.sub(r"(\|\|:|:\|\||\|\||\|)", r" \1 ", line)
    return [t for t in re.split(r"[\s\t]+", line) if t]


def chords_in_line(line: str) -> list[Chord] | None:
    """Chords in a line if it is a chord line, else None.

    A chord line is made only of chords and chart symbols, with at least one chord.
    """
    # Notes in brackets, e.g. "(Half Time)" or "(to transpose to F#)", don't decide what the line is.
    tokens = tokenize_chord_line(re.sub(r"\([^)]*\)", " ", line))
    chords: list[Chord] = []
    other_words = 0
    for t in tokens:
        c = parse_chord(t.strip("().,;:") if len(t) > 1 else t)
        if c:
            chords.append(c)
        elif NON_CHORD_TOKENS.match(t):
            continue
        else:
            other_words += 1
    if not chords:
        return None
    has_bars = "|" in line
    if other_words == 0 or (has_bars and other_words <= 3 and len(chords) >= other_words):
        return chords
    return None


_BAR_OF_RE = re.compile(
    r"\b(?i:bars?|beats?|measures?)\s+of\s+"
    r"(?P<chords>[A-G][^\s,;)]*(?:\s*(?:,|-|–|and|&|then|to)\s*[A-G][^\s,;)]*)*)"
)
_BAR_GROUP_RE = re.compile(r"\|([^|]+)(?=\|)")


def inline_chord_spans(line: str) -> list[tuple[int, int]]:
    """Chords written inside a prose line, as (start, end) spans of the line.

    Catches notes like "(Repeat one bar of A to go to Verse)" and
    "can also play | Em7/C#  F#7 |", where the line as a whole isn't a chord line.
    """
    spans: list[tuple[int, int]] = []
    for m in _BAR_OF_RE.finditer(line):
        base = m.start("chords")
        for t in re.finditer(r"[^\s,;)]+", m["chords"]):
            if parse_chord(t.group(0)):
                spans.append((base + t.start(), base + t.end()))
    for m in _BAR_GROUP_RE.finditer(line):
        tokens = m[1].split()
        if tokens and all(parse_chord(t) or NON_CHORD_TOKENS.match(t) for t in tokens) and any(
            parse_chord(t) for t in tokens
        ):
            spans.append((m.start(1), m.end(1)))
    return sorted(set(spans))


# ---------------------------------------------------------------------------
# Key estimation
# ---------------------------------------------------------------------------

# Scale degree (semitones above tonic) -> expected quality, with weights.
_DIATONIC = {
    0: ("maj", 3.0),   # I
    2: ("min", 1.5),   # ii
    4: ("min", 1.0),   # iii
    5: ("maj", 2.5),   # IV
    7: ("maj", 2.5),   # V
    9: ("min", 2.0),   # vi
    10: ("maj", 0.6),  # bVII (common borrowed chord)
}


def _chord_fit(chord: Chord, tonic: int) -> float:
    degree = (chord.root_pc - tonic) % 12
    if degree not in _DIATONIC:
        return -1.0
    expected, weight = _DIATONIC[degree]
    actual = "min" if chord.is_minor else "maj"
    if chord.is_diminished:
        return 0.5 if degree == 11 else -0.5
    if actual != expected:
        # Sus/power chords have no third, so don't penalise them.
        if "sus" in chord.quality or chord.quality == "5":
            return weight * 0.6
        return -0.5
    return weight


def key_scores(chords: list[Chord]) -> list[tuple[float, int]]:
    """Score every major key (tonic pitch class) for a list of chords, best first."""
    if not chords:
        return []
    counts = Counter(chords)
    first, last = chords[0], chords[-1]
    scores = []
    for tonic in range(12):
        s = sum(_chord_fit(c, tonic) * n for c, n in counts.items())
        # Songs and sections usually start or end on the tonic.
        for c, bonus in ((first, 2.0), (last, 3.0)):
            if c.root_pc == tonic and not c.is_minor:
                s += bonus
        scores.append((s / len(chords), tonic))
    return sorted(scores, reverse=True)


def spell_key(tonic: int, chords: list[Chord] | None = None) -> str:
    """Name a major key, picking sharps/flats to match the chords when ambiguous."""
    name = MAJOR_KEY_NAMES[tonic]
    if tonic in (1, 6) and chords:  # Db/C#, F#/Gb
        sharps = sum("#" in c.root for c in chords)
        flats = sum("b" in c.root for c in chords)
        if tonic == 1:
            name = "C#" if sharps > flats else "Db"
        else:
            name = "Gb" if flats > sharps else "F#"
    return name


def estimate_key(chords: list[Chord]) -> tuple[str | None, float]:
    """Best major key for the chords and a 0-1 confidence."""
    scores = key_scores(chords)
    if not scores:
        return None, 0.0
    (best, tonic), (second, _) = scores[0], scores[1]
    margin = best - second
    confidence = max(0.0, min(1.0, 0.35 + margin / 1.5 + (0.15 if len(chords) >= 8 else 0)))
    return spell_key(tonic, chords), round(confidence, 2)


def parse_key_name(text: str) -> str | None:
    """'F# Major' -> 'F#', 'Bb' -> 'Bb'. Minor keys keep an 'm' suffix."""
    m = re.match(r"^\s*([A-Ga-g])\s*([#b♯♭])?\s*(major|maj|minor|min|m)?(?![A-Za-z])", text, re.IGNORECASE)
    if not m:
        return None
    root = m[1].upper() + {"♯": "#", "♭": "b"}.get(m[2] or "", m[2] or "")
    if root not in NOTE_TO_PC:
        return None
    minor = (m[3] or "").lower() in ("minor", "min", "m")
    return root + ("m" if minor else "")


def semitones_between(from_key: str, to_key: str) -> int:
    """Smallest signed shift (-5..+6) from one key to another."""
    a = NOTE_TO_PC[from_key.rstrip("m")]
    b = NOTE_TO_PC[to_key.rstrip("m")]
    d = (b - a) % 12
    return d - 12 if d > 6 else d
