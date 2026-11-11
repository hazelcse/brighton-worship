"""Pull text out of a songsheet .docx as ordered blocks of lines.

Songsheets put lyrics in the main body and chord charts / metadata in floating
text boxes. Word stores each text box twice: a modern DrawingML copy inside
<mc:Choice> and a legacy VML copy inside <mc:Fallback>. We read the modern copy
and ignore fallbacks, so nothing is counted twice.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"w": W, "mc": MC, "r": R}

_P = f"{{{W}}}p"
_T = f"{{{W}}}t"
_TAB = f"{{{W}}}tab"
_BR = f"{{{W}}}br"
_CR = f"{{{W}}}cr"
_TXBX = f"{{{W}}}txbxContent"
_FALLBACK = f"{{{MC}}}Fallback"


@dataclass
class Block:
    """A run of lines from one place in the document: the body, or one text box."""

    kind: str  # "body" | "textbox"
    lines: list[str] = field(default_factory=list)


@dataclass
class DocText:
    blocks: list[Block]
    hyperlinks: list[str]

    def all_lines(self) -> list[str]:
        return [line for b in self.blocks for line in b.lines]


def _paragraph_text(p: etree._Element) -> str:
    """Text of one paragraph, excluding any text boxes nested inside it."""
    parts: list[str] = []
    for el in p.iter(_T, _TAB, _BR, _CR):
        # Skip content that belongs to a nested text box.
        anc = el.getparent()
        nested = False
        while anc is not None and anc is not p:
            if anc.tag == _TXBX:
                nested = True
                break
            anc = anc.getparent()
        if nested:
            continue
        if el.tag == _T:
            parts.append(el.text or "")
        elif el.tag == _TAB:
            parts.append("\t")
        else:
            parts.append("\n")
    return "".join(parts)


def _in_fallback(el: etree._Element) -> bool:
    return any(a.tag == _FALLBACK for a in el.iterancestors())


def extract(docx_bytes: bytes) -> DocText:
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as z:
        root = etree.fromstring(z.read("word/document.xml"))
        rels_xml = z.read("word/_rels/document.xml.rels") if "word/_rels/document.xml.rels" in z.namelist() else b""

    body = root.find("w:body", NS)
    blocks: list[Block] = []
    body_block = Block("body")
    blocks.append(body_block)

    # Walk body paragraphs in order. Text boxes anchored in a paragraph become
    # their own blocks, placed after the paragraph that anchors them.
    for p in body.iter(_P):
        if any(a.tag == _TXBX for a in p.iterancestors()):
            continue  # paragraphs inside text boxes are handled below
        text = _paragraph_text(p)
        for line in text.split("\n"):
            body_block.lines.append(line)
        for txbx in p.iter(_TXBX):
            if _in_fallback(txbx):
                continue
            # Only direct text boxes (not ones nested in another text box).
            if any(a.tag == _TXBX for a in txbx.iterancestors()):
                continue
            box = Block("textbox")
            # Every paragraph in the box in reading order, including ones inside tables
            # (a chord chart is often a table in a text box), but not ones that belong to a
            # text box nested inside this one.
            for bp in txbx.iter(_P):
                if next((a for a in bp.iterancestors() if a.tag == _TXBX), None) is not txbx:
                    continue
                box.lines.extend(_paragraph_text(bp).split("\n"))
            blocks.append(box)

    hyperlinks: list[str] = []
    if rels_xml:
        rels = etree.fromstring(rels_xml)
        for rel in rels:
            if rel.get("TargetMode") == "External" and rel.get("Type", "").endswith("/hyperlink"):
                hyperlinks.append(rel.get("Target", ""))

    for b in blocks:
        b.lines = [re.sub(r"[  ]+$", "", line) for line in b.lines]
    return DocText(blocks=blocks, hyperlinks=hyperlinks)
