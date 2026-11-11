"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A PDF songsheet in a full-height popup, with "Open in new tab" and a download button at the top
 * right. `src` is fetched (it can be slow: a sheet may be transposed on the way), or is already a
 * blob: URL. `fileName` names the download; a response's X-File-Name header is used if it has one.
 */
export function PdfViewerDialog({ src, title, fileName, onClose }: { src: string; title: string; fileName?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

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
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: "application/pdf" }));
        setFile({ url, name: header ? decodeURIComponent(header) : (fileName ?? `${title}.pdf`) });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, title, fileName]);

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
        {file ? (
          <iframe src={file.url} title={`${title} songsheet`} className="w-full flex-1 bg-background" />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-background p-6 text-center text-sm text-muted" role="status">
            {error ?? "Getting the songsheet ready…"}
          </div>
        )}
      </div>
    </dialog>
  );
}

export function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}
