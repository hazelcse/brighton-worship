"use client";

import { useEffect, useRef, useState } from "react";
import { attachSessionSheet, readSessionSheetKey } from "@/app/(app)/sessions/actions";
import { MAJOR_KEYS, keyUp, majorKey, sessionSheetProblem, stepsFrom, type PlanItem } from "@/lib/session-plan";

const input =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const label = "mb-1 block text-xs font-medium text-muted";

function KeyOptions({ id, value, onChange, disabled }: { id: string; value: string | null; onChange: (k: string | null) => void; disabled?: boolean }) {
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} className={input}>
      <option value="">—</option>
      {MAJOR_KEYS.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}

/**
 * "Upload your own songsheet" for a song in the session, instead of one from the song bank.
 * A PDF is shown to the band as it is, with the title and key typed in here. A Word (.docx) sheet
 * is scanned and fills in the song's details (title, key, BPM, type, artist, sequence, YouTube
 * links), which the worship leader can then check and change.
 *
 * `onAttached` gets the changes to make to the song.
 */
export function SheetUploadDialog({
  sessionId,
  item,
  onAttached,
  onClose,
}: {
  sessionId: string;
  item: PlanItem;
  onAttached: (patch: Partial<PlanItem>, filled: string[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(item.title);
  /** The key the sheet is written in: typed for a PDF, read by the scanner for a .docx (theirs wins). */
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  /** Reading a .docx's key, before it's attached. */
  const [reading, setReading] = useState(false);
  const readFor = useRef<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const isPdf = file ? /\.pdf$/i.test(file.name) : false;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function choose(f: File | null) {
    const problem = f ? sessionSheetProblem(f) : null;
    setError(problem);
    setFile(f);
    setSheetKey(null);
    setReading(false);
    readFor.current = f;
    if (!f || problem || /\.pdf$/i.test(f.name)) return;
    // Read the Word sheet's key now, so they can check it before it's transposed.
    setReading(true);
    const body = new FormData();
    body.append("file", f, f.name);
    const r = await readSessionSheetKey(sessionId, body).catch(() => null);
    if (readFor.current !== f) return;
    setReading(false);
    if (r?.ok) setSheetKey(r.key);
  }

  async function attach() {
    if (!file) return setError("Choose a songsheet.");
    const problem = sessionSheetProblem(file);
    if (problem) return setError(problem);
    if (isPdf && !title.trim()) return setError("Type the song's title.");
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("file", file, file.name);
    if (sheetKey) body.append("from_key", sheetKey);
    const r = await attachSessionSheet(sessionId, body).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : "Upload failed." }));
    setBusy(false);
    if (!r.ok) return setError(r.message);

    // An attached sheet replaces any song bank pick. It remembers the key it's written in: a Word sheet
    // is shown transposed to the song's key, a PDF as it is (with a note if the song's key differs).
    // A song with no key yet takes the sheet's.
    const patch: Partial<PlanItem> = { sheet: r.sheet, song_id: null, key: majorKey(item.key) ?? r.sheet.key ?? null };
    const filled: string[] = [];
    if (isPdf || !r.scan) {
      patch.title = title.trim();
    } else {
      const s = r.scan;
      const fill = (name: string, change: Partial<PlanItem>) => {
        Object.assign(patch, change);
        filled.push(name);
      };
      if (s.title) fill("title", { title: s.title });
      if (!majorKey(item.key) && r.sheet.key) filled.push("key");
      if (s.bpm) fill("BPM", { bpm: s.bpm });
      if (s.type) fill("type", { type: s.type });
      if (s.artist) fill("artist", { artist: s.artist });
      if (s.sequence.length) fill("sequence", { sequence: stepsFrom(s.sequence) });
      if (s.youtube_links.length && !item.links?.length) fill("links", { links: s.youtube_links.map((url) => ({ label: "YouTube", url })) });
    }
    if (patch.key !== undefined && majorKey(patch.key) !== majorKey(item.key)) patch.transpose_to = null;
    // A key change written in the sheet (E→F#) becomes the song's, from the song's key (F→G), unless
    // it already has one.
    const change = r.scan?.key_change;
    const songKey = patch.key ?? item.key;
    if (change && songKey && !(patch.transpose_to === undefined ? item.transpose_to : patch.transpose_to)) {
      patch.transpose_to = keyUp(songKey, change);
      filled.push("key change");
    }
    onAttached(patch, filled);
    ref.current?.close();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="sheet-upload-title"
      onClose={onClose}
      onCancel={(e) => busy && e.preventDefault()}
      onClick={(e) => e.target === ref.current && !busy && ref.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          attach();
        }}
        className="space-y-4 p-5"
      >
        <div>
          <h2 id="sheet-upload-title" className="font-display text-xl font-semibold">
            Upload your own songsheet
          </h2>
          <p className="mt-1 text-sm text-muted">
            For a song that isn&apos;t in the song bank. It stays with this session (it isn&apos;t added to the library), and the band can open it once
            the session is published.
          </p>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f && inputRef.current) {
              inputRef.current.files = e.dataTransfer.files;
              choose(f);
            }
          }}
          className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition ${
            dragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
          }`}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted" aria-hidden>
            <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span className="max-w-full truncate font-medium">{file ? file.name : "Choose a PDF or Word (.docx) file"}</span>
          <span className="text-muted">{file ? "Click to choose a different file" : "or drag it here"}</span>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </label>

        {file && !error && (
          <div className="space-y-3">
            {isPdf ? (
              <p className="text-sm text-muted">A PDF is shown to the band as it is. Type its title and the key it&apos;s written in:</p>
            ) : (
              <p className="text-sm text-muted">
                The songsheet is read for its title, key, BPM, sequence and YouTube links, and those fill in the song&apos;s details. Check the key
                it&apos;s written in (change it if it&apos;s read wrong): the sheet is transposed from it to the song&apos;s key.
              </p>
            )}
            <div className="flex gap-3">
              {isPdf && (
                <div className="min-w-0 flex-1">
                  <label className={label} htmlFor="sheet-title">
                    Song title
                  </label>
                  <input id="sheet-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" className={input} />
                </div>
              )}
              <div className={isPdf ? "w-28 shrink-0" : "w-40"}>
                <label className={label} htmlFor="sheet-key">
                  {reading ? "Reading key…" : "Written in"}
                </label>
                <KeyOptions id="sheet-key" value={sheetKey} onChange={setSheetKey} disabled={reading} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => ref.current?.close()}
            className="h-9 rounded-lg border border-border px-4 text-sm font-medium hover:border-accent/50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!file || busy || reading || Boolean(sessionSheetProblem(file))}
            className="h-9 rounded-lg bg-ink px-4 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-40"
          >
            {busy ? (isPdf ? "Uploading…" : "Uploading and reading…") : "Attach"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
