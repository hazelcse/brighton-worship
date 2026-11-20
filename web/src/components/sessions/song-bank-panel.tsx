"use client";

import { FilterMenu, LANGUAGE_OPTIONS, TYPE_OPTIONS } from "@/components/filter-menu";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { BankSongDetail } from "@/app/(app)/sessions/actions";
import { SongsheetPreview } from "@/components/songs/songsheet-preview";
import { PdfSheetPreview } from "@/components/songs/pdf-viewer-dialog";
import { SequenceView } from "@/components/sessions/sequence-builder";
import { SONG_TYPE_LABEL, type SongType } from "@/lib/session-plan";
import { searchSongs, songIndex } from "@/lib/song-search";

export type BankSong = {
  id: string;
  title: string;
  artist: string | null;
  lyrics: string;
  titlePinyin: string;
  type: SongType | null;
  bpm: number | null;
  language: "en" | "zh";
  key: string | null;
  keyDisplay: string | null;
};

const TYPE_STYLE: Record<SongType, string> = {
  praise: "bg-orange-100 text-orange-800",
  worship: "bg-sky-100 text-sky-800",
  praise_worship: "bg-violet-100 text-violet-800",
};

export function TypeBadge({ type }: { type: SongType | null }) {
  if (!type) return null;
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_STYLE[type]}`}>{SONG_TYPE_LABEL[type]}</span>;
}

const input =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

export type PanelTarget = { label: string; songId: string | null } | null;

/** The open song's own uploaded songsheet (not from the bank), shown where a bank song's would be. */
export type OwnSheet = { title: string; artist: string | null; keyLabel: string | null; fileName: string; src: string } | null;

/**
 * The song bank, on the right of the workbench: a searchable list of the library, and one song's
 * details and songsheet. With a song slot selected in edit mode, songs can be used for that slot.
 */
export function SongBankPanel({
  inSheet = false,
  toEdge = false,
  bank,
  canBrowse,
  query,
  onQuery,
  detailId,
  onDetail,
  detail,
  target,
  onUse,
  onMinimise,
  focusSearch,
  defaultLanguage,
  ownSheet = null,
}: {
  /** Phones: inside the bottom sheet (which draws the frame), with an ✕ that closes it instead of ">". */
  inSheet?: boolean;
  /** Stretched to the window's right edge (a song open on desktop): no border or rounding on that side. */
  toEdge?: boolean;
  bank: BankSong[];
  canBrowse: boolean;
  query: string;
  onQuery: (q: string) => void;
  /** Showing this song's details (null = the list). */
  detailId: string | null;
  onDetail: (id: string | null) => void;
  detail: BankSongDetail | null | undefined;
  /** The slot a song can be used for right now (edit mode, a song selected). */
  target: PanelTarget;
  onUse: (song: BankSong) => void;
  onMinimise: () => void;
  /** Changes whenever the search box should take focus. */
  focusSearch: number;
  /** Starting language filter: English for EM sessions, Chinese for CM, "" (all) otherwise. */
  defaultLanguage: "en" | "zh" | "";
  /** Editing a song with its own uploaded songsheet: shown instead of the list (← goes back to it). */
  ownSheet?: OwnSheet;
}) {
  const [type, setType] = useState("");
  const [language, setLanguage] = useState<string>(defaultLanguage);
  const deferred = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSearch && !detailId) searchRef.current?.focus();
  }, [focusSearch, detailId]);

  // The same search as the Songs page (lib/song-search.ts): title, artist, lyrics, then BPM.
  const index = useMemo(() => songIndex(bank), [bank]);
  // (Every row already shows its BPM, so a BPM match needs no label.)
  const { list, lyricHit } = useMemo(
    () => searchSongs(bank.filter((s) => (!type || s.type === type) && (!language || s.language === language)), index, deferred),
    [bank, index, deferred, type, language],
  );

  const bankSong = detailId ? bank.find((s) => s.id === detailId) : undefined;

  return (
    <section aria-label="Song bank" className={`flex h-full flex-col overflow-hidden bg-surface ${inSheet ? "" : toEdge ? "rounded-l-xl border-y border-l border-border" : "rounded-xl border border-border"}`}>
      <div className={`flex items-center gap-2 border-b border-border px-3 ${inSheet ? "pb-2.5" : "py-2.5"}`}>
        {detailId || ownSheet ? (
          <button type="button" onClick={() => onDetail(null)} className="-ml-1 flex items-center gap-1 rounded-md px-1 py-1 text-sm text-muted hover:text-foreground">
            {/* An arrow with a line (←), not a bare chevron. */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5m6-6-6 6 6 6" />
            </svg>
            Song bank
          </button>
        ) : (
          <h2 className="font-semibold">Song bank</h2>
        )}
        <button
          type="button"
          onClick={onMinimise}
          aria-label={inSheet ? "Close song bank" : "Minimise song bank"}
          title={inSheet ? "Close" : "Minimise"}
          className="ml-auto rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground"
        >
          {inSheet ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          ) : (
            <Chevron dir="right" />
          )}
        </button>
      </div>

      {ownSheet && !detailId ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="space-y-1">
            <h3 className="font-display text-2xl font-semibold leading-tight">{ownSheet.title}</h3>
            {ownSheet.artist && <p className="text-sm text-muted">{ownSheet.artist}</p>}
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
              <span className="rounded-full bg-background px-2 py-0.5 font-medium text-muted">Your own songsheet</span>
              {ownSheet.keyLabel && <span className="rounded-full border border-border px-2 py-0.5">Key {ownSheet.keyLabel}</span>}
            </div>
          </div>
          <PdfSheetPreview key={ownSheet.src} src={ownSheet.src} title={ownSheet.title} fileName={ownSheet.fileName} />
          <p className="truncate text-xs text-muted" title={ownSheet.fileName}>
            {ownSheet.fileName}
          </p>
        </div>
      ) : !canBrowse ? (
        <p className="p-4 text-sm text-muted">You don&apos;t have access to the song library.</p>
      ) : detailId ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {detail === undefined ? (
            <p className="text-sm text-muted" role="status">
              Loading…
            </p>
          ) : detail === null ? (
            <p className="text-sm text-muted">This song isn&apos;t in the library any more.</p>
          ) : (
            <>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="min-w-0 font-display text-2xl font-semibold leading-tight">{detail.title}</h3>
                  {/* Already the song picked for the chosen slot: a small badge, not a full-width bar. */}
                  {target && bankSong && target.songId === bankSong.id && (
                    <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted">In {target.label}</span>
                  )}
                </div>
                {detail.artist && <p className="text-sm text-muted">{detail.artist}</p>}
                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                  <TypeBadge type={detail.type} />
                  {(detail.keyDisplay || detail.key) && <span className="rounded-full border border-border px-2 py-0.5">Key {detail.keyDisplay || detail.key}</span>}
                  {detail.bpm && <span className="rounded-full border border-border px-2 py-0.5">{detail.bpm} bpm</span>}
                  {detail.timeSignature && <span className="rounded-full border border-border px-2 py-0.5">{detail.timeSignature}</span>}
                </div>
              </div>
              {target && bankSong && target.songId !== bankSong.id && (
                <button
                  type="button"
                  onClick={() => onUse(bankSong)}
                  className="w-full rounded-lg bg-ink px-3 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90"
                >
                  Use for {target.label}
                </button>
              )}
              {/* The songsheet first, then its sequence, links and notes. */}
              {detail.versionId ? (
                <SongsheetPreview versionId={detail.versionId} previewPages={detail.previewPages} title={detail.title} bare />
              ) : (
                <p className="text-sm text-muted">No songsheet yet.</p>
              )}
              {detail.steps.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">Sequence</p>
                  <div className="text-sm">
                    <SequenceView steps={detail.steps} />
                  </div>
                </div>
              )}
              {detail.links.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">Links</p>
                  <ul className="space-y-0.5">
                    {detail.links.map((l) => (
                      <li key={l.url}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline-offset-2 hover:underline">
                          {l.label || l.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.notes && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">Notes</p>
                  <p className="whitespace-pre-line text-sm">{detail.notes}</p>
                </div>
              )}
              <Link href={`/songs/${detail.id}`} target="_blank" className="inline-block text-sm text-accent underline-offset-2 hover:underline">
                Open song page ↗
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          {/* One row on every screen: search, then an icon-only Filters dropdown on its right. */}
          <div className="flex items-center gap-2 border-b border-border p-3">
            {/* Like the Songs page's search: magnifier inside, the same placeholder. */}
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search songs by title, artist, lyrics or BPM</span>
              <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder="Search title, artist, lyrics, BPM"
                // 40px tall, to match the Filters button beside it.
                className={`${input.replace("h-9", "h-10")} pl-9`}
              />
            </label>
            <FilterMenu
              iconOnly
              className="shrink-0"
              groups={[
                { id: "language", label: "Language", options: LANGUAGE_OPTIONS, value: language, onChange: setLanguage },
                { id: "type", label: "Type", options: TYPE_OPTIONS, value: type, onChange: setType },
              ]}
            />
          </div>
          <p className="px-3 pt-2 text-xs text-muted">
            {list.length} {list.length === 1 ? "song" : "songs"}
          </p>
          <ul className="flex-1 divide-y divide-border overflow-y-auto">
            {list.slice(0, 300).map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-background">
                <button type="button" onClick={() => onDetail(s.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {s.artist && <span className="truncate">{s.artist}</span>}
                    {s.key && <span className="shrink-0">· {s.keyDisplay || s.key}</span>}
                    {s.bpm && <span className="shrink-0">· {s.bpm} bpm</span>}
                    {lyricHit.has(s.id) && <span className="shrink-0">· Lyrics match</span>}
                  </span>
                </button>
                <TypeBadge type={s.type} />
                {target && (
                  <button
                    type="button"
                    onClick={() => onUse(s)}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium hover:border-accent hover:text-accent"
                  >
                    Use
                  </button>
                )}
              </li>
            ))}
            {list.length === 0 && <li className="p-4 text-sm text-muted">No songs match.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
