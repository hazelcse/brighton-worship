"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { NO_CROP, marginsOf, sheetCrops, type Crop, type Margins } from "@/lib/sheet-crop";
import { NoteLoader } from "@/components/note-loader";

/**
 * A PDF songsheet in a full-height popup, with "Open in new tab" and a download button at the top
 * right. `src` is fetched (it can be slow: a sheet may be transposed on the way), or is already a
 * blob: URL. `fileName` names the download; a response's X-File-Name header is used if it has one.
 *
 * The pages are drawn with pdf.js rather than shown in an <iframe>: phone browsers have no inline
 * PDF viewer (Android Chrome shows a grey "Open" box that can't open a blob: URL; iOS shows only
 * the first page).
 */
export function PdfViewerDialog({ src, title, fileName, onClose }: { src: string; title: string; fileName?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { file, error } = usePdfFile(src, title, fileName);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-label={`${title} songsheet`}
      className="m-auto h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-4xl overflow-hidden rounded-2xl bg-surface p-0 text-foreground shadow-2xl sm:w-[calc(100%-2rem)]"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate font-display text-2xl font-semibold">{title}</h2>
          {file && (
            <>
              <a href={file.url} target="_blank" rel="noopener noreferrer" className="hidden shrink-0 text-sm text-accent underline-offset-2 hover:underline sm:inline">
                Open in new tab
              </a>
              <a
                href={file.url}
                download={file.name}
                aria-label="Download PDF"
                title="Download PDF"
                className="shrink-0 rounded-full p-2 text-muted hover:bg-background hover:text-foreground"
              >
                <DownloadIcon />
              </a>
            </>
          )}
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="-mr-2 shrink-0 rounded-full p-2 text-muted hover:bg-background">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {file ? <PdfPages data={file.blob} title={title} /> : error ? <Status>{error}</Status> : <Loading />}
      </div>
    </dialog>
  );
}

/**
 * A PDF songsheet shown inline, its pages stacked at the width they're given, like a song bank
 * songsheet's preview: tap a page to open it full size (PdfViewerDialog, without fetching it again).
 */
export function PdfSheetPreview({ src, title, fileName }: { src: string; title: string; fileName?: string }) {
  const { file, error } = usePdfFile(src, title, fileName);
  const [open, setOpen] = useState(false);
  if (error) return <p className="rounded-lg bg-background p-4 text-sm text-muted">{error}</p>;
  if (!file) return <InlineLoading />;
  return (
    <div>
      <PdfPages data={file.blob} title={title} inline onOpen={() => setOpen(true)} />
      {open && <PdfViewerDialog src={file.url} title={title} fileName={file.name} onClose={() => setOpen(false)} />}
    </div>
  );
}

function InlineLoading() {
  return (
    <div className="flex aspect-[8.5/11] w-full items-center justify-center rounded-lg bg-background">
      <NoteLoader label="Getting the songsheet ready" />
    </div>
  );
}

/** Fetches a songsheet PDF (`src`, see PdfViewerDialog) into a blob: URL, let go when `src` changes. */
function usePdfFile(src: string, title: string, fileName?: string) {
  const [file, setFile] = useState<{ url: string; name: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forSrc, setForSrc] = useState(src);
  if (forSrc !== src) {
    setForSrc(src);
    setFile(null);
    setError(null);
  }

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetch(src)
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(json?.error ?? "The songsheet couldn't be loaded.");
        }
        const header = res.headers.get("x-file-name");
        const raw = await res.blob();
        if (cancelled) return;
        const blob = raw.type ? raw : new Blob([raw], { type: "application/pdf" });
        url = URL.createObjectURL(blob);
        setFile({ url, name: header ? decodeURIComponent(header) : (fileName ?? `${title}.pdf`), blob });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, title, fileName]);
  return { file, error };
}

/** NoteLoader is its own status region, so it isn't wrapped in Status. */
function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-background p-6">
      <NoteLoader label="Getting the songsheet ready" />
    </div>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-background p-6 text-center text-sm text-muted" role="status">
      {children}
    </div>
  );
}

/** Loads pdf.js (only when a sheet is opened) with the worker it needs. Legacy build: older phones. */
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

/** Every page of the PDF, stacked and fitted to the popup's width; redrawn when that width changes. */
function PdfPages({ data, title, inline = false, onOpen }: { data: Blob; title: string; inline?: boolean; onOpen?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      const pdfjs = await loadPdfjs();
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (cancelled) return;
      // Only fetched for a PDF that leans on fonts it doesn't carry (ours embed theirs).
      const assets = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}`;
      const task = pdfjs.getDocument({ data: bytes, cMapUrl: `${assets}/cmaps/`, standardFontDataUrl: `${assets}/standard_fonts/` });
      destroy = () => void task.destroy();
      const loaded = await task.promise;
      const margins = await Promise.all(Array.from({ length: loaded.numPages }, (_, i) => pageMargins(loaded, i + 1)));
      if (cancelled) return;
      setCrops(sheetCrops(margins));
      setDoc(loaded);
    })().catch((e) => {
      if (cancelled) return;
      console.error("PDF viewer:", e);
      setError("The songsheet couldn't be shown here. Use the download button to open it.");
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [data]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc]);

  if (error) return inline ? <p className="rounded-lg bg-background p-4 text-sm text-muted">{error}</p> : <Status>{error}</Status>;
  if (!doc) return inline ? <InlineLoading /> : <Loading />;
  if (inline) {
    return (
      <div ref={box} className="space-y-3">
        {width > 0 &&
          Array.from({ length: doc.numPages }, (_, i) => {
            const page = <PdfPage doc={doc} n={i + 1} width={width} crop={crops[i] ?? NO_CROP} label={`${title} songsheet, page ${i + 1} of ${doc.numPages}`} framed />;
            return onOpen ? (
              <button key={i} type="button" onClick={onOpen} className="block w-full cursor-zoom-in" aria-label={`Open ${title} songsheet full size`}>
                {page}
              </button>
            ) : (
              <div key={i}>{page}</div>
            );
          })}
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto bg-background p-2 sm:p-4">
      <div ref={box} className="mx-auto space-y-2 sm:space-y-4">
        {width > 0 &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} n={i + 1} width={width} crop={crops[i] ?? NO_CROP} label={`${title}, page ${i + 1} of ${doc.numPages}`} />
          ))}
      </div>
    </div>
  );
}

/** A page's white margins, from a small throwaway render. Null if blank or it can't be drawn. */
async function pageMargins(doc: PDFDocumentProxy, n: number): Promise<Margins | null> {
  try {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 400 / base.width });
    const c = document.createElement("canvas");
    c.width = Math.floor(viewport.width);
    c.height = Math.floor(viewport.height);
    await page.render({ canvas: c, viewport }).promise;
    return marginsOf(c);
  } catch {
    return null;
  }
}

/** Larger canvases than this run phones (iOS especially) out of canvas memory. */
const MAX_PIXELS = 12_000_000;

function PdfPage({ doc, n, width, crop, label, framed = false }: { doc: PDFDocumentProxy; n: number; width: number; crop: Crop; label: string; framed?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (cancelled || !canvas.current) return;
      // Only the cropped part of the page is drawn, fitted to the width.
      const shownW = base.width * crop.w;
      const shownH = base.height * crop.h;
      setRatio(shownW / shownH);
      const fit = width / shownW;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const scale = fit * Math.min(dpr, Math.sqrt(MAX_PIXELS / (shownW * fit * shownH * fit)));
      const viewport = page.getViewport({ scale, offsetX: -crop.x * base.width * scale, offsetY: -crop.y * base.height * scale });
      const el = canvas.current;
      el.width = Math.floor(shownW * scale);
      el.height = Math.floor(shownH * scale);
      task = page.render({ canvas: el, viewport });
      await task.promise;
    })().catch((e) => {
      if (!cancelled && (e as { name?: string })?.name !== "RenderingCancelledException") console.error(`PDF viewer, page ${n}:`, e);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, width, crop]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      style={{ aspectRatio: ratio ?? 1 / Math.SQRT2 }}
      // framed: inline, bordered like a song bank songsheet's preview pages.
      className={`block h-auto w-full bg-white shadow-sm ${framed ? "rounded-lg border border-border" : "rounded-sm"}`}
    />
  );
}

export function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}
