import io
import zipfile

from worship_worker.scanner import scan_docx
from worship_worker.docx_text import extract
from worship_worker.transpose import (
    note_name,
    transpose_chord_text,
    transpose_docx,
    transpose_key,
    transpose_keys_in,
    transposed_file_name,
)

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def make_docx(paragraphs: list[list[str]]) -> bytes:
    """A minimal .docx; each paragraph is a list of runs ('\t' = tab)."""
    def run(t: str) -> str:
        if t == "\t":
            return "<w:r><w:rPr><w:b/><w:sz w:val=\"22\"/></w:rPr><w:tab/></w:r>"
        return f'<w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">{t}</w:t></w:r>'
    body = "".join("<w:p>" + "".join(run(r) for r in p) + "</w:p>" for p in paragraphs)
    doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440" w:top="1440" w:bottom="1440"/></w:sectPr></w:body></w:document>'
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", doc)
    return out.getvalue()


def test_spelling_follows_the_key():
    assert [note_name(pc, "C") for pc in (1, 3, 6, 8, 10)] == ["Db", "Eb", "F#", "Ab", "Bb"]
    assert note_name(1, "E") == "C#" and note_name(10, "F") == "Bb"
    assert transpose_chord_text("E/G#", 3, "G") == "G/B"
    assert transpose_chord_text("C#m7", 1, "Eb") == "Dm7"
    assert transpose_chord_text("Dadd4,9", 5, "C") == "Gadd4,9"


def test_key_names():
    assert transpose_key("E", 2) == "F#" and transpose_key("A", 6) == "Eb"
    assert transpose_keys_in("(E-F#)", 3) == "(G-A)"
    assert transpose_keys_in("Key: g-a", 2) == "Key: a-b"
    assert transposed_file_name("Abide (E-F#) 74.docx", "E", 3, "G") == "Abide (G-A) 74.docx"
    assert transposed_file_name("Way Maker.docx", "C", 2, "D") == "Way Maker (D).docx"
    assert transposed_file_name("New Wine (Bb) 70.docx", "E", 3, "G") == "New Wine 70 (G).docx"


def test_transpose_document_keeps_lines_and_runs():
    data = make_docx([
        ["ABIDE (E)"],
        ["Tempo: 74 bpm"],
        ["E Major"],
        ["Verse:"],
        ["||:   E", "\t", "|     B", "\t", "|   C", "#m", "\t", "|  A  :||"],  # chord split across runs
        ["Original Key: B (Male)"],
        ["Band Notes : E E B B"],
    ])
    out, rep = transpose_docx(data, target_key="G")
    lines = [l for l in extract(out).all_lines() if l.strip()]
    assert lines[0] == "ABIDE (G)"
    assert lines[2] == "G Major"
    assert lines[4].split() == ["||:", "G", "|", "D", "|", "Em", "|", "C", ":||"]
    assert lines[5] == "Original Key: B (Male)"  # the recording's key is left alone
    assert lines[6].endswith("G G D D")
    assert rep.semitones == 3 and rep.from_key == "E"
    assert scan_docx(out).key_display == "G"


def test_semitones_option():
    data = make_docx([["SONG"], ["|| C  | F  | G  | C ||"]])
    out, rep = transpose_docx(data, semitones=-2)
    assert rep.to_key == "Bb"
    assert "Bb" in extract(out).all_lines()[1] and "Eb" in extract(out).all_lines()[1]


def test_confirmed_key_overrides_the_scanner():
    # Ambiguous progression (could be read as C or G); the editor says it's in G.
    data = make_docx([["SONG"], ["|| C  | G  | C  | G ||"]])
    out, rep = transpose_docx(data, target_key="A", from_key="G")
    assert rep.from_key == "G" and rep.semitones == 2
    assert extract(out).all_lines()[1].split() == ["||", "D", "|", "A", "|", "D", "|", "A", "||"]
