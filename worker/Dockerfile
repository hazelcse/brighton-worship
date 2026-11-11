# Songsheet worker: scanning, transposing and previewing .docx songsheets.
FROM python:3.13-slim-bookworm

# Fonts with the same character widths as Arial / Times New Roman / Courier New (Liberation),
# Calibri (Carlito) and Cambria (Caladea), so the transposer can measure lines like Word does.
# LibreOffice is only used to draw read-only previews (PDF) of songsheets; Noto CJK for Chinese sheets.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-cjk \
       libreoffice-writer-nogui \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH" HOME=/tmp
EXPOSE 8000
# Listens on $PORT when the host sets one (Railway does), otherwise 8000 (local docker run).
CMD ["sh", "-c", "exec uvicorn worship_worker.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
