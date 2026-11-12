"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCloseOnLeave } from "@/lib/use-close-on-leave";
import { NO_CROP, marginsOf, sheetCrops, type Margins } from "@/lib/sheet-crop";
import { NoteLoader } from "@/components/note-loader";


type Meta = { pages: number } | { error: string } | null;

/** Loads (and if needed, creates) the preview page count for a songsheet. */
function usePreviewPages(versionId: string | null, known: number | null): Meta {
  const [meta, setMeta] = useState<Meta>(known ? { pages: known } : null);
  const [forId, setForId] = useState(versionId);
  if (forId !== versionId) {
    setForId(versionId);
    setMeta(known ? { pages: known } : null);
  }
  useEffect(() => {
    if (!versionId || known) return;
    let cancelled = false;
    fetch(`/api/songsheets/${versionId}/preview`)
      .then(async (r) => {
        const json = await r.json();
        if (!cancelled) setMeta(r.ok ? { pages: json.pages } : { error: json.error ?? "Preview unavailable." });
      })
      .catch(() => !cancelled && setMeta({ error: "Preview unavailable." }));
    return () => {
      cancelled = true;
    };
  }, [versionId, known]);
  return meta;
}

/** A page image as loaded: its size and white margins (null: blank or unreadable). */
type Loaded = { width: number; height: number; margins: Margins | null };

function Pages({ versionId, meta, title, onOpen }: { versionId: string; meta: Meta; title: string; onOpen?: () => void }) {
  const [loaded, setLoaded] = useState<(Loaded | undefined)[]>([]);
  const [forId, setForId] = useState(versionId);
  if (forId !== versionId) {
    setForId(versionId);
    setLoaded([]);
  }
  const pages = meta && "pages" in meta ? meta.pages : 0;
  const all = Array.from({ length: pages }, (_, i) => loaded[i]);
  // Every page waits for the others: the sheet's pages share one zoom (see sheet-crop.ts).
  const crops = pages > 0 && all.every(Boolean) ? sheetCrops(all.map((p) => p!.margins)) : null;
  const done = (i: number, page: Loaded) =>
    setLoaded((prev) => {
      const next = [...prev];
      next[i] = page;
      return next;
    });
  const measure = (i: number, el: HTMLImageElement) => done(i, { width: el.naturalWidth, height: el.naturalHeight, margins: marginsOf(el) });

  if (!meta) {
    return (
      <div className="flex aspect-[8.5/11] w-full items-center justify-center rounded-lg bg-background">
        <NoteLoader label="Making the preview" />
      </div>
    );
  }
  if ("error" in meta) {
    return <p className="rounded-lg bg-background p-4 text-sm text-muted">{meta.error}</p>;
  }
  return (
    <div className="space-y-3">
      {Array.from({ length: meta.pages }, (_, i) => {
        const size = loaded[i] ?? { width: 1105, height: 1430 };
        const crop = crops?.[i] ?? NO_CROP;
        const img = (
          <div
            className="relative overflow-hidden rounded-lg border border-border bg-white shadow-sm"
            style={{ aspectRatio: `${size.width * crop.w} / ${size.height * crop.h}` }}
          >
            {/* Plain <img>: these are private, already-sized PNGs served by our own API. Hidden
                until every page is measured, so the zoom doesn't jump in after it shows. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/songsheets/${versionId}/preview/${i + 1}`}
              alt={`${title} songsheet, page ${i + 1} of ${meta.pages}`}
              width={size.width}
              height={size.height}
              // The ref catches an image that loaded (e.g. from cache) before React was listening.
              ref={(el) => {
                if (el?.complete && el.naturalWidth && !loaded[i]) measure(i, el);
              }}
              onLoad={(e) => measure(i, e.currentTarget)}
              onError={() => done(i, { width: 1105, height: 1430, margins: null })}
              className={`absolute h-auto max-w-none ${crops ? "" : "invisible"}`}
              style={{ width: `${100 / crop.w}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%` }}
            />
          </div>
        );
        return onOpen ? (
          <button
            key={i}
            type="button"
            onClick={onOpen}
            className="block w-full cursor-zoom-in"
            aria-label={`Open ${title} songsheet full size`}
          >
            {img}
          </button>
        ) : (
          <div key={i}>{img}</div>
        );
      })}
    </div>
  );
}

/** Full-size viewer in a dialog. */
export function PreviewDialog({
  open,
  onClose,
  versionId,
  previewPages,
  title,
  songId,
}: {
  open: boolean;
  onClose: () => void;
  versionId: string | null;
  previewPages: number | null;
  title: string;
  songId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useCloseOnLeave(ref);
  const meta = usePreviewPages(open ? versionId : null, previewPages);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={`${title} songsheet`}
      className="m-auto h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-4xl overflow-hidden rounded-2xl bg-surface p-0 text-foreground shadow-2xl sm:w-[calc(100%-2rem)]"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate font-display text-2xl font-semibold">{title}</h2>
          {versionId && meta && "pages" in meta && (
            <a
              href={`/api/songsheets/${versionId}/preview/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-sm text-accent underline-offset-2 hover:underline"
            >
              Open PDF
            </a>
          )}
          {songId && (
            <Link href={`/songs/${songId}`} className="shrink-0 text-sm text-accent underline-offset-2 hover:underline">
              Open song
            </Link>
          )}
          <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 shrink-0 rounded-full p-2 text-muted hover:bg-background">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-background p-2 sm:p-4">
          {open && versionId ? (
            <Pages versionId={versionId} meta={meta} title={title} />
          ) : (
            <p className="p-4 text-sm text-muted">This song has no songsheet yet.</p>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** Preview panel on the song page; tap to open full size. openFullSize: start open (a link straight to the songsheet). */
export function SongsheetPreview({
  versionId,
  previewPages,
  title,
  openFullSize = false,
}: {
  versionId: string;
  previewPages: number | null;
  title: string;
  openFullSize?: boolean;
}) {
  const [open, setOpen] = useState(openFullSize);
  const meta = usePreviewPages(versionId, previewPages);
  return (
    <section aria-labelledby="preview-title" className="space-y-3 rounded-xl border border-border bg-surface p-2 sm:p-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="preview-title" className="text-lg font-semibold">
          Preview
        </h2>
        <button type="button" onClick={() => setOpen(true)} className="text-sm text-accent underline-offset-2 hover:underline">
          Full size
        </button>
      </div>
      <Pages versionId={versionId} meta={meta} title={title} onOpen={() => setOpen(true)} />
      <PreviewDialog open={open} onClose={() => setOpen(false)} versionId={versionId} previewPages={previewPages} title={title} />
    </section>
  );
}
