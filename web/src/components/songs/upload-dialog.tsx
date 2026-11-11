"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { finishUploads, uploadSongsheet } from "@/app/(app)/songs/actions";
import { songsheetFileProblem } from "@/lib/songsheet-file";
import type { UploadResult } from "@/lib/worker";
import { AddMenu } from "@/components/songs/add-menu";
import { IssueList } from "@/components/songs/issue-list";
import { useCloseOnLeave } from "@/lib/use-close-on-leave";

/**
 * "+ New song": add songs from their songsheets.
 * With songId: "Replace songsheet" for that song (each song keeps one base copy).
 */
export function UploadDialog({
  songId,
  label,
  variant = "primary",
  addMenu,
}: {
  songId?: string;
  label?: string;
  variant?: "primary" | "secondary";
  /** Songs page: open from the "+" menu (which also offers a new transposition) instead of a button. */
  addMenu?: { canTranspose: boolean };
}) {
  const replacing = Boolean(songId);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useCloseOnLeave(dialogRef);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ results: UploadResult[]; error: string | null }>({ results: [], error: null });
  // While uploading: how many files are done, out of how many.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const pending = progress !== null;
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  function open() {
    formRef.current?.reset();
    setFileNames([]);
    dialogRef.current?.showModal();
  }

  /** Sends the files one per request (keeps each under the host's body limit), showing results as they come in. */
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const files = [...(inputRef.current?.files ?? [])].filter((f) => f.size > 0);
    if (!files.length) return setState({ results: [], error: "Choose a .docx songsheet." });
    if (replacing && files.length > 1) return setState({ results: [], error: "Choose just one songsheet to replace it with." });

    const results: UploadResult[] = [];
    setState({ results, error: null });
    setProgress({ done: 0, total: files.length });
    let sent = false;
    for (const [i, file] of files.entries()) {
      const problem = songsheetFileProblem(file);
      let result: UploadResult;
      if (problem) {
        result = { file_name: file.name, status: "failed", error: problem };
      } else {
        const body = new FormData();
        body.append("file", file, file.name);
        if (songId) body.append("song_id", songId);
        result = await uploadSongsheet(body).catch((err: unknown) => ({
          file_name: file.name,
          status: "failed" as const,
          error: err instanceof Error ? err.message : "Upload failed.",
        }));
        sent = true;
      }
      results.push(result);
      setState({ results: [...results], error: null });
      setProgress({ done: i + 1, total: files.length });
    }
    if (sent) await finishUploads().catch(() => {});
    formRef.current?.reset();
    setFileNames([]);
    setProgress(null);
  }

  return (
    <>
      {addMenu ? (
        <AddMenu onNewSong={open} canTranspose={addMenu.canTranspose} />
      ) : (
        <button
          type="button"
          onClick={open}
          className={
            variant === "primary"
              ? "h-10 rounded-lg bg-ink px-4 text-sm font-medium text-ink-foreground transition hover:bg-ink/90"
              : "text-sm text-muted hover:text-foreground"
          }
        >
          {label ?? "+ New song"}
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="upload-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
        onClick={(e) => e.target === dialogRef.current && !pending && dialogRef.current?.close()}
      >
        <form
          ref={formRef}
          onSubmit={upload}
          className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-6"
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 id="upload-title" className="font-display text-3xl font-semibold">
                {replacing ? "Replace songsheet" : "New song"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {replacing
                  ? "Upload the new base copy (.docx). It replaces the current songsheet, here and in Google Drive, and is scanned again. Details you've edited are kept."
                  : "Upload songsheets (.docx). Each one is scanned straight away for the title, key, tempo, sections and YouTube links, and becomes a new song."}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              disabled={pending}
              onClick={() => dialogRef.current?.close()}
              className="-mr-2 -mt-1 rounded-full p-2 text-muted hover:bg-background"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {songId && <input type="hidden" name="song_id" value={songId} />}

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (inputRef.current && e.dataTransfer.files.length) {
                inputRef.current.files = e.dataTransfer.files;
                setFileNames([...e.dataTransfer.files].map((f) => f.name));
              }
            }}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm transition ${
              dragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
            }`}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted" aria-hidden>
              <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <span className="font-medium">{replacing ? "Choose a .docx file" : "Choose .docx files or drag them here"}</span>
            {!replacing && <span className="text-muted">You can pick several at once.</span>}
            <input
              ref={inputRef}
              type="file"
              name="files"
              multiple={!replacing}
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFileNames([...(e.target.files ?? [])].map((f) => f.name))}
              className="sr-only"
            />
          </label>
          {fileNames.length > 0 && (
            <ul className="space-y-1 text-sm">
              {fileNames.map((n) => (
                <li key={n} className="truncate">
                  📄 {n}
                </li>
              ))}
            </ul>
          )}

          {state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}

          {state.results.length > 0 && (
            <ul className="space-y-3" aria-live="polite">
              {state.results.map((r, i) => (
                <li key={`${r.file_name}-${i}`} className="rounded-lg border border-border p-3 text-sm">
                  <p className="truncate text-xs text-muted">{r.file_name}</p>
                  {r.status === "failed" ? (
                    <p className="mt-1 text-danger">✕ {r.error}</p>
                  ) : r.status === "duplicate" || r.status === "exists" ? (
                    <p className="mt-1">
                      {r.status === "duplicate" ? "This exact file is already in the library" : `"${r.title}" is already in the library`}
                      {r.song_id && (
                        <>
                          {" "}
                          (
                          <Link href={`/songs/${r.song_id}`} className="text-accent underline underline-offset-2">
                            open song
                          </Link>
                          ). Each song keeps one songsheet. To use this file instead, choose Replace songsheet on the song.
                        </>
                      )}
                    </p>
                  ) : (
                    <>
                      <p className="mt-1">
                        ✓{" "}
                        <Link href={`/songs/${r.song_id}`} className="font-medium text-accent underline underline-offset-2">
                          {r.title ?? "Untitled"}
                        </Link>
                        {r.key && <span className="text-muted"> · Key {r.key}</span>}
                        {replacing && <span className="text-muted"> · songsheet replaced</span>}
                      </p>
                      {r.drive && r.drive.status !== "not_configured" && (
                        <p className={`mt-1 text-xs ${r.drive.status === "failed" ? "text-danger" : "text-muted"}`}>{r.drive.message}</p>
                      )}
                      <IssueList issues={(r.issues ?? []).filter((x) => x.severity !== "info")} compact />
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <button
            type="submit"
            disabled={pending || fileNames.length === 0}
            className="rounded-lg bg-ink px-4 py-2.5 font-medium text-ink-foreground transition hover:bg-ink/90 disabled:opacity-50"
          >
            {progress
              ? progress.total > 1
                ? `Uploading and scanning ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : "Uploading and scanning…"
              : replacing
                ? "Replace"
                : "Upload"}
          </button>
        </form>
      </dialog>
    </>
  );
}
