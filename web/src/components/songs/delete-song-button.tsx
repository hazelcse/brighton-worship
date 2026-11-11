"use client";

import { useRef, useState, useTransition } from "react";
import { deleteSong } from "@/app/(app)/songs/actions";

/** "Delete song" with a confirmation step. Shown only to people allowed to delete songs. */
export function DeleteSongButton({ songId, title }: { songId: string; title: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section aria-labelledby="delete-song-title" className="space-y-2 rounded-xl border border-red-200 bg-surface p-4 sm:p-5">
      <h2 id="delete-song-title" className="text-lg font-semibold">
        Delete song
      </h2>
      <p className="text-sm text-muted">Removes the song, its songsheet, preview and links from the library.</p>
      <button
        type="button"
        onClick={() => {
          setError(null);
          ref.current?.showModal();
        }}
        className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-danger hover:bg-red-50"
      >
        Delete song
      </button>

      <dialog
        ref={ref}
        aria-labelledby="confirm-delete-song"
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
        onClick={(e) => e.target === ref.current && !pending && ref.current?.close()}
      >
        <div className="space-y-4 p-6">
          <h2 id="confirm-delete-song" className="text-lg font-semibold">
            Delete “{title}”?
          </h2>
          <p className="text-sm text-muted">
            The song, its songsheet file, preview, reference links and key instruments are removed permanently. This can&apos;t be undone.
          </p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" disabled={pending} onClick={() => ref.current?.close()} className="text-sm text-muted">
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteSong(songId);
                  if (r && !r.ok) setError(r.message);
                })
              }
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Delete song"}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
