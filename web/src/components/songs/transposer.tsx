"use client";

import { useMemo, useState } from "react";
import { IssueList } from "@/components/songs/issue-list";
import { NoteLoader } from "@/components/note-loader";
import { DownloadIcon, PdfViewerDialog } from "@/components/songs/pdf-viewer-dialog";

/** versionId: the stored songsheet, shown as it is when its own key is picked (hasPreview: its PDF exists). */
type SongOption = { id: string; title: string; key: string; versionId: string | null; hasPreview: boolean };
type Analysis = {
  title: string | null;
  key: string | null;
  key_display: string | null;
  alternate_keys: string[];
  confidence: number;
  issues: { code: string; severity: "error" | "warning" | "info"; message: string }[];
};
type Report = {
  from_key: string | null;
  to_key: string | null;
  semitones: number;
  chords_changed: number;
  keys_changed: number;
  boxes_widened: number[];
  lines_tightened: number;
  lines_shrunk: number;
  warnings: string[];
};

const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const PC: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, F: 5, "E#": 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11,
};

function pcOf(key: string | null): number | null {
  if (!key) return null;
  const k = key.replace(/m$/, "");
  return k in PC ? PC[k] : null;
}

/** Smallest shift between two keys, like the worker (-5..+6). */
function shiftBetween(from: string, to: string): number {
  const d = (((pcOf(to) ?? 0) - (pcOf(from) ?? 0)) % 12 + 12) % 12;
  return d > 6 ? d - 12 : d;
}

function describeShift(n: number): string {
  if (n === 0) return "same key";
  const s = Math.abs(n);
  return `${n > 0 ? "up" : "down"} ${s} semitone${s === 1 ? "" : "s"}`;
}

const btn = "rounded-lg border px-3 py-2 text-sm font-medium transition";

export function Transposer({
  songs,
  initialSongId,
  canBrowseLibrary,
}: {
  songs: SongOption[];
  initialSongId: string | null;
  canBrowseLibrary: boolean;
}) {
  const [mode, setMode] = useState<"library" | "upload">(canBrowseLibrary ? "library" : "upload");
  const [query, setQuery] = useState("");
  const [songId, setSongId] = useState<string | null>(songs.some((s) => s.id === initialSongId) ? initialSongId : null);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [keyOverride, setKeyOverride] = useState<string>(""); // "the scanner is wrong, it's in…"
  const [byKey, setByKey] = useState(true);
  const [target, setTarget] = useState<string | null>(null);
  const [semitones, setSemitones] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyFormat, setBusyFormat] = useState<"docx" | "pdf" | "view" | null>(null);
  // "View": the transposed PDF (a blob: URL) or the stored songsheet's PDF, shown in a dialog.
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null);
  function closeView() {
    if (viewing?.url.startsWith("blob:")) URL.revokeObjectURL(viewing.url);
    setViewing(null);
  }
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; report: Report; viewed?: boolean } | null>(null);

  const song = songs.find((s) => s.id === songId) ?? null;
  const fromKey = mode === "library" ? song?.key ?? null : keyOverride || analysis?.key || null;
  const keyKnown = pcOf(fromKey) !== null;
  const useKey = byKey && keyKnown;
  const shift = useKey ? (target && fromKey ? shiftBetween(fromKey, target) : null) : semitones;
  // A library song in its own key needs no transposing: its stored songsheet is shown as it is.
  const original = mode === "library" && Boolean(song?.versionId) && useKey && shift === 0;
  const ready =
    (mode === "library" ? Boolean(song) : Boolean(file && analysis)) && shift !== null && (shift !== 0 || original) && !busy;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? songs.filter((s) => s.title.toLowerCase().includes(q)) : songs).slice(0, 8);
  }, [songs, query]);

  function reset() {
    setTarget(null);
    setSemitones(0);
    setResult(null);
    setError(null);
  }

  async function analyze(f: File) {
    setFile(f);
    setAnalysis(null);
    setKeyOverride("");
    reset();
    if (!/\.docx$/i.test(f.name)) {
      setError("Only .docx songsheets are supported. Open it in Word and use Save As → Word Document (.docx).");
      return;
    }
    setAnalyzing(true);
    try {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch("/api/transpose/analyze", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't read this songsheet.");
      setAnalysis(json as Analysis);
      if (!(json as Analysis).key) setByKey(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  /** The stored songsheet as it is: viewed, or downloaded as its .docx or PDF. */
  async function showOriginal(format: "docx" | "pdf" | "view") {
    if (!song?.versionId) return;
    setError(null);
    setResult(null);
    if (format === "docx") {
      download(`/api/songsheets/${song.versionId}`);
      return;
    }
    // The PDF is made with the preview; make it first if this sheet hasn't had one yet.
    if (!song.hasPreview) {
      setBusy(true);
      setBusyFormat(format);
      try {
        const res = await fetch(`/api/songsheets/${song.versionId}/preview`);
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "The songsheet couldn't be loaded.");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      } finally {
        setBusy(false);
        setBusyFormat(null);
      }
    }
    const url = `/api/songsheets/${song.versionId}/preview/pdf`;
    if (format === "pdf") download(url);
    else setViewing({ url, name: `${song.title}.pdf` });
  }

  async function generate(format: "docx" | "pdf" | "view") {
    if (original) return showOriginal(format);
    setBusy(true);
    setBusyFormat(format);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("format", format === "view" ? "pdf" : format);
      if (useKey && target) body.append("target_key", target);
      else body.append("semitones", String(semitones));
      if (mode === "library" && song) body.append("song_id", song.id);
      else if (file) {
        body.append("file", file);
        if (keyOverride) body.append("from_key", keyOverride);
      }
      const res = await fetch("/api/transpose", { method: "POST", body });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "The transposer couldn't process this songsheet.");
      }
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get("x-file-name") ?? "transposed.docx");
      const report = JSON.parse(res.headers.get("x-transpose-report") ?? "{}") as Report;
      const url = URL.createObjectURL(blob);
      if (format === "view") {
        if (viewing) URL.revokeObjectURL(viewing.url);
        setViewing({ url, name });
        setResult({ name, report, viewed: true });
        return;
      }
      download(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setResult({ name, report });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setBusyFormat(null);
    }
  }

  return (
    <div className="space-y-5">
      {canBrowseLibrary && (
        <div role="tablist" aria-label="Songsheet source" className="inline-flex rounded-lg border border-border bg-surface p-1">
          {(["library", "upload"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                reset();
              }}
              className="rounded-md px-4 py-1.5 text-sm font-medium text-muted aria-selected:bg-ink aria-selected:text-ink-foreground"
            >
              {m === "library" ? "From the library" : "Upload a songsheet"}
            </button>
          ))}
        </div>
      )}

      {/* Step 1: the songsheet */}
      <section className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <h2 className="font-semibold">1. Songsheet</h2>
        {mode === "library" ? (
          song ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-3 py-2">
              <p>
                <span className="font-medium">{song.title}</span>
                <span className="text-muted"> · in {song.key}</span>
              </p>
              <button type="button" onClick={() => { setSongId(null); reset(); }} className="text-sm text-accent underline underline-offset-2">
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search songs by title"
                aria-label="Search songs by title"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {matches.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => { setSongId(s.id); reset(); }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-background"
                    >
                      <span>{s.title}</span>
                      <span className="text-muted">{s.key}</span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted">No songs match.</li>}
              </ul>
            </div>
          )
        ) : (
          <div className="space-y-2">
            <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border px-4 py-6 text-center text-sm hover:border-accent/50">
              <span className="font-medium">{file ? file.name : "Choose a .docx songsheet"}</span>
              <span className="text-muted">It isn&apos;t saved to the library.</span>
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])}
              />
            </label>
            {analyzing && <NoteLoader label="Working out the key" className="py-4" />}
            {analysis && (
              <div className="space-y-2 rounded-lg bg-background px-3 py-2 text-sm">
                <p>
                  <span className="font-medium">{analysis.title ?? "Untitled"}</span>{" "}
                  {analysis.key ? (
                    <span className="text-muted">
                      · looks like it&apos;s in <b className="text-foreground">{analysis.key_display}</b>
                      {analysis.alternate_keys.length > 0 && ` (also written out in ${analysis.alternate_keys.join(", ")})`}
                      {analysis.confidence < 0.6 && " (not certain)"}
                    </span>
                  ) : (
                    <span className="text-muted">· the key couldn&apos;t be worked out, so choose how many semitones to move it.</span>
                  )}
                </p>
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">{analysis.key ? "Not right? It's actually in" : "It's in"}</span>
                  <select
                    value={keyOverride}
                    onChange={(e) => {
                      setKeyOverride(e.target.value);
                      setTarget(null);
                      setResult(null);
                      if (e.target.value) setByKey(true);
                    }}
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                  >
                    <option value="">{analysis.key ? `${analysis.key} (detected)` : "Choose…"}</option>
                    {KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <IssueList compact issues={keyOverride ? analysis.issues.filter((i) => !["written_key_mismatch", "title_key_mismatch", "low_key_confidence"].includes(i.code)) : analysis.issues} />
              </div>
            )}
          </div>
        )}
      </section>

      {/* Step 2: the new key */}
      <section className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">2. New key</h2>
          {keyKnown && (
            <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  aria-pressed={byKey === v}
                  onClick={() => { setByKey(v); setResult(null); }}
                  className="rounded-md px-2.5 py-1 text-muted aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground"
                >
                  {v ? "Choose a key" : "By semitones"}
                </button>
              ))}
            </div>
          )}
        </div>

        {useKey ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {KEYS.map((k) => {
              const current = pcOf(fromKey) === PC[k];
              return (
                <button
                  key={k}
                  type="button"
                  disabled={!fromKey}
                  aria-pressed={target === k}
                  onClick={() => {
                    setTarget(k);
                    setResult(null);
                    // Its own key: nothing to transpose, so open the stored songsheet straight away.
                    if (current && mode === "library" && song?.versionId) {
                      setError(null);
                      if (song.hasPreview) setViewing({ url: `/api/songsheets/${song.versionId}/preview/pdf`, name: `${song.title}.pdf` });
                      else void showOriginal("view");
                    }
                  }}
                  className={`${btn} ${
                    target === k
                      ? "border-ink bg-ink text-ink-foreground"
                      : current
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-border hover:border-accent/50"
                  } disabled:opacity-40`}
                >
                  {k}
                  {current && <span className="sr-only"> (current key)</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Down a semitone" onClick={() => { setSemitones((n) => Math.max(-11, n - 1)); setResult(null); }} className={`${btn} border-border`}>
              −
            </button>
            <output className="min-w-36 whitespace-nowrap text-center text-lg font-semibold" aria-live="polite">
              {semitones > 0 ? `+${semitones}` : semitones} semitone{Math.abs(semitones) === 1 ? "" : "s"}
            </output>
            <button type="button" aria-label="Up a semitone" onClick={() => { setSemitones((n) => Math.min(11, n + 1)); setResult(null); }} className={`${btn} border-border`}>
              +
            </button>
          </div>
        )}

        {fromKey && shift !== null && (
          <p className="text-sm text-muted">
            {fromKey} → {useKey ? target : transposeName(fromKey, semitones)} ({describeShift(shift)})
            {original && ": this is the songsheet as it's stored, nothing is transposed"}
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!ready}
          onClick={() => generate("view")}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 font-medium text-ink-foreground transition hover:bg-ink/90 disabled:opacity-50"
        >
          <EyeIcon />
          {busyFormat === "view" ? "Transposing…" : "View"}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => generate("docx")}
          aria-label="Download .docx"
          title="Download .docx"
          className="inline-flex items-center gap-2 rounded-lg border border-ink px-5 py-2.5 font-medium text-ink transition hover:bg-ink hover:text-ink-foreground disabled:opacity-50"
        >
          <DownloadIcon />
          {busyFormat === "docx" ? "Transposing…" : ".docx"}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => generate("pdf")}
          aria-label="Download PDF"
          title="Download PDF"
          className="inline-flex items-center gap-2 rounded-lg border border-ink px-5 py-2.5 font-medium text-ink transition hover:bg-ink hover:text-ink-foreground disabled:opacity-50"
        >
          <DownloadIcon />
          {busyFormat === "pdf" ? "Making PDF…" : "PDF"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {result && (
        <section role="status" className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="font-medium">
            ✓ {result.viewed ? "Transposed" : "Downloaded"} {result.name} ({result.report.from_key} → {result.report.to_key})
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>{result.report.chords_changed} chords changed{result.report.keys_changed ? `, ${result.report.keys_changed} written keys updated` : ""}</li>
            {result.report.boxes_widened.length > 0 && (
              <li>
                Chord box widened by {Math.round(Math.max(...result.report.boxes_widened))} pt so no chord moves to the next line
              </li>
            )}
            {result.report.lines_shrunk > 0 && (
              <li>
                {result.report.lines_shrunk} line{result.report.lines_shrunk === 1 ? " was" : "s were"} set slightly smaller to fit beside the lyrics
              </li>
            )}
          </ul>
          {result.report.warnings.length > 0 && (
            <IssueList compact issues={result.report.warnings.map((m, i) => ({ code: `w${i}`, severity: "warning" as const, message: m }))} />
          )}
        </section>
      )}

      {viewing && <PdfViewerDialog src={viewing.url} title={viewing.name.replace(/\.pdf$/i, "")} fileName={viewing.name} onClose={closeView} />}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Downloads a URL (a blob: URL or one of our API routes). */
function download(url: string, name?: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name ?? "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function transposeName(from: string, n: number): string {
  const pc = ((pcOf(from) ?? 0) + n + 120) % 12;
  return KEYS[pc];
}
