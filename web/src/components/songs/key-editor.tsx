"use client";

import { useState, useTransition } from "react";
import { confirmKey, resetKey } from "@/app/(app)/songs/actions";

const MAJOR = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];
// Accept any spelling the scanner might have used, but offer the common ones.
const ALIASES: Record<string, string> = { "C#": "Db", "D#": "Eb", Gb: "F#", "G#": "Ab", "A#": "Bb", Dbm: "C#m", "D#m": "Ebm", Gbm: "F#m", Abm: "G#m", "A#m": "Bbm" };
const norm = (k: string) => ALIASES[k] ?? k;

const select = "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm";

function KeySelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={select}>
      <optgroup label="Major">
        {MAJOR.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </optgroup>
      <optgroup label="Minor">
        {MINOR.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

export type KeyInfo = {
  keys: string[];
  alternates: string[];
  confirmedAt: string | null;
  confirmedBy: string | null;
  scannerKeys: string | null; // what the scanner said, e.g. "E→F#"
  scannerAlternates: string[];
};

/** Shows the songsheet's key and lets editors confirm or correct what the scanner detected. */
export function KeyEditor({ songId, versionId, info, canEdit }: { songId: string; versionId: string; info: KeyInfo; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [keys, setKeys] = useState<string[]>(info.keys.length ? info.keys.map(norm) : ["C"]);
  const [alts, setAlts] = useState<string[]>(info.alternates.map(norm));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const display = info.keys.length ? info.keys.join(" → ") : "Unknown";
  const scannerDiffers = info.confirmedAt && info.scannerKeys && info.scannerKeys.replace(/→/g, " → ") !== display;

  function run(fn: () => Promise<{ ok: boolean; message: string | null }>, onOk?: () => void) {
    start(async () => {
      const r = await fn();
      setMessage(r.message ? { ok: r.ok, text: r.message } : null);
      if (r.ok) onOk?.();
    });
  }

  if (editing) {
    return (
      <div className="space-y-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
        <p className="text-sm font-medium">What key is this songsheet in?</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Starts in</span>
          <KeySelect label="Starting key" value={keys[0]} onChange={(v) => setKeys([v, ...keys.slice(1)])} />
        </div>
        {keys.slice(1).map((k, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">then changes to</span>
            <KeySelect
              label={`Key change ${i + 1}`}
              value={k}
              onChange={(v) => setKeys(keys.map((x, j) => (j === i + 1 ? v : x)))}
            />
            <button type="button" onClick={() => setKeys(keys.filter((_, j) => j !== i + 1))} className="text-xs text-danger">
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setKeys([...keys, MAJOR[(MAJOR.indexOf(norm(keys[keys.length - 1])) + 2) % 12] ?? "D"])}
          className="text-xs text-accent underline underline-offset-2"
        >
          + Add a key change
        </button>

        <div className="space-y-1.5 text-sm">
          <p className="text-muted">The whole chart is also written out in (e.g. a male / female version):</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {alts.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs">
                {k}
                <button type="button" aria-label={`Remove ${k}`} onClick={() => setAlts(alts.filter((x) => x !== k))} className="text-muted hover:text-danger">
                  ×
                </button>
              </span>
            ))}
            <select
              aria-label="Add another key it's written out in"
              value=""
              onChange={(e) => e.target.value && setAlts([...new Set([...alts, e.target.value])])}
              className={select}
            >
              <option value="">+ Add…</option>
              {/* Major keys only (a trailing "m" would mean minor); skip keys already in use. */}
              {MAJOR.filter((k) => !alts.includes(k) && !keys.includes(k)).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => confirmKey(songId, versionId, keys, alts), () => setEditing(false))}
            className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save key"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-muted">
            Cancel
          </button>
          {info.confirmedAt && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => resetKey(songId, versionId), () => setEditing(false))}
              className="ml-auto text-xs text-muted underline underline-offset-2"
            >
              Use scanner&apos;s key
            </button>
          )}
          {message && !message.ok && (
            <p role="alert" className="text-sm text-danger">
              {message.text}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-medium">Key {display}</p>
          {info.confirmedAt ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              ✓ Confirmed{info.confirmedBy ? ` by ${info.confirmedBy}` : ""}
            </span>
          ) : (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-muted">Detected by scanner</span>
          )}
        </div>
        {canEdit && (
          <span className="-mr-1.5 -mt-1 flex shrink-0 items-center gap-0.5">
            {!info.confirmedAt && info.keys.length > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => confirmKey(songId, versionId, info.keys, info.alternates))}
                aria-label="Confirm the scanner's key"
                title="Confirm the scanner's key"
                className="rounded-md p-1.5 text-muted transition hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setKeys(info.keys.length ? info.keys.map(norm) : ["C"]);
                setAlts(info.alternates.map(norm));
                setMessage(null);
                setEditing(true);
              }}
              aria-label="Edit the key"
              title="Edit the key"
              className="rounded-md p-1.5 text-muted transition hover:bg-background hover:text-foreground"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </span>
        )}
      </div>
      {info.alternates.length > 0 && <p className="text-xs text-muted">Also written out in {info.alternates.join(", ")}</p>}
      {scannerDiffers && <p className="text-xs text-muted">The scanner thought it was {info.scannerKeys}.</p>}
      {message && (
        <p role="status" className={`text-xs ${message.ok ? "text-emerald-700" : "text-danger"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
