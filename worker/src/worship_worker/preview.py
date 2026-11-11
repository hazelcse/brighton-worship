"""Read-only previews: .docx -> PDF (LibreOffice) -> one PNG per page (pdfium).

Images rather than an embedded PDF so previews work in every browser, including phones.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
from pathlib import Path

import pypdfium2 as pdfium

PREVIEW_DPI = 130  # sharp enough to read chords on a phone, ~150 KB per page
MAX_PAGES = 6


class PreviewUnavailable(RuntimeError):
    pass


def docx_to_pdf(docx: bytes) -> bytes:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise PreviewUnavailable("Previews need LibreOffice, which is installed in the worker's Docker image.")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "sheet.docx"
        src.write_bytes(docx)
        # A private profile per run, so several previews can be made at the same time.
        subprocess.run(
            [soffice, "--headless", "--norestore", f"-env:UserInstallation=file://{tmp}/profile",
             "--convert-to", "pdf", "--outdir", tmp, str(src)],
            check=True, capture_output=True, timeout=120,
        )
        out = Path(tmp) / "sheet.pdf"
        if not out.exists():
            raise PreviewUnavailable("LibreOffice couldn't render this songsheet.")
        return out.read_bytes()


def pdf_to_pngs(pdf: bytes, dpi: int = PREVIEW_DPI) -> list[bytes]:
    doc = pdfium.PdfDocument(pdf)
    pages = []
    try:
        for i in range(min(len(doc), MAX_PAGES)):
            image = doc[i].render(scale=dpi / 72).to_pil()
            buf = io.BytesIO()
            image.convert("RGB").save(buf, format="PNG", optimize=True)
            pages.append(buf.getvalue())
    finally:
        doc.close()
    return pages


def render_preview(docx: bytes) -> tuple[bytes, list[bytes]]:
    """(PDF bytes, PNG bytes for each page)."""
    pdf = docx_to_pdf(docx)
    return pdf, pdf_to_pngs(pdf)
