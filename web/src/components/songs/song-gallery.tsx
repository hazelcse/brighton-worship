"use client";

import { FilterMenu, LANGUAGE_OPTIONS, TYPE_OPTIONS } from "@/components/filter-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { scanPendingSongsheets } from "@/app/(app)/songs/actions";
import { PreviewDialog } from "@/components/songs/songsheet-preview";
import { UploadDialog } from "@/components/songs/upload-dialog";
import { AddMenu } from "@/components/songs/add-menu";

type SongType = "praise" | "worship" | "praise_worship";
type Card = {
  id: string;
  title: string;
  artist: string | null;
  lyrics: string;
  type: SongType | null;
  language: "en" | "zh";
  bpm: number | null;
  keys: string[];
  needsReview: boolean;
  missingFromDrive: boolean;
  versionId: string | null;
  previewPages: number | null;
};

const TYPE_LABEL: Record<SongType, string> = { praise: "Praise", worship: "Worship", praise_worship: "Praise / Worship" };
const TYPE_STYLE: Record<SongType, string> = {
  praise: "bg-orange-100 text-orange-800",
  worship: "bg-sky-100 text-sky-800",
  praise_worship: "bg-violet-100 text-violet-800",
};

/** Text for matching: lower case, punctuation dropped, spaces collapsed ("Couldn't," → "couldnt"). */
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const select =
  "h-10 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export function SongGallery({
  songs,
  pendingScans,
  canCreate,
  canReview,
  canTranspose,
  driveSync,
  updates,
}: {
  songs: Card[];
  pendingScans: number;
  canCreate: boolean;
  canReview: boolean;
  canTranspose: boolean;
  /** Google Drive sync button (only when Drive is set up and the user can add songs). */
  driveSync?: React.ReactNode;
  /** The "Updates" button, for people who get song library updates. */
  updates?: React.ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [language, setLanguage] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [scanning, setScanning] = useState(pendingScans > 0);
  const deferredQuery = useDeferredValue(query);
  const [viewing, setViewing] = useState<Card | null>(null);
  const started = useRef(false);

  // Scan songsheets that were uploaded but not scanned yet (only new ones, never the whole library).
  useEffect(() => {
    if (pendingScans === 0 || started.current) return;
    started.current = true;
    scanPendingSongsheets()
      .then(() => router.refresh())
      .catch(() => {})
      .finally(() => setScanning(false));
  }, [pendingScans, router]);

  // Each song's title, artist and lyrics ready for matching (worked out once).
  const index = useMemo(
    () =>
      new Map(
        songs.map((s) => {
          const lines = s.lyrics.split("\n").filter((l) => l.trim());
          return [s.id, { title: norm(s.title), artist: norm(s.artist ?? ""), lyrics: norm(lines.join(" ")) }];
        }),
      ),
    [songs],
  );

  // Songs whose title, artist or lyrics match the search, and which matched on the lyrics only.
  const { filtered, lyricHit } = useMemo(() => {
    const q = norm(deferredQuery);
    const hits = new Set<string>();
    const list = songs.filter((s) => {
      if (type && s.type !== type) return false;
      if (language && s.language !== language) return false;
      if (reviewOnly && !s.needsReview) return false;
      if (missingOnly && !s.missingFromDrive) return false;
      if (!q) return true;
      const ix = index.get(s.id)!;
      if (ix.title.includes(q) || ix.artist.includes(q)) return true;
      if (!ix.lyrics.includes(q)) return false;
      hits.add(s.id);
      return true;
    });
    return { filtered: list, lyricHit: hits };
  }, [songs, index, deferredQuery, type, language, reviewOnly, missingOnly]);

  const reviewCount = songs.filter((s) => s.needsReview).length;
  const missingCount = songs.filter((s) => s.missingFromDrive).length;
  const anyFilter = query || type || language || reviewOnly || missingOnly;

  // "12 of 368 songs" (+ Clear filters): in the toolbar on phones, on its own line from 768px.
  const count = (
    <>
      {filtered.length} of {songs.length} songs
      {anyFilter && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setType("");
            setLanguage("");
            setReviewOnly(false);
            setMissingOnly(false);
          }}
          className="ml-3 underline underline-offset-2 hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      {/* One row from 768px up (see PAGE-LAYOUTS.md): the search takes the space left over and
          nothing else wraps or shrinks. On phones the search and an icon-only Filters button share
          the first row, and the rest wrap beneath. */}
      <div data-songbank-toolbar className="flex flex-wrap items-center gap-2 md:flex-nowrap">
          <label className="relative min-w-0 flex-1 md:min-w-40">
            <span className="sr-only">Search songs by title, artist or lyrics</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, artist, lyrics"
              className={`${select} w-full pl-9`}
            />
          </label>
          <FilterMenu
            className="shrink-0 md:w-36"
            iconOnlyOnMobile
            groups={[
              { id: "language", label: "Language", options: LANGUAGE_OPTIONS, value: language, onChange: setLanguage },
              { id: "type", label: "Type", options: TYPE_OPTIONS, value: type, onChange: setType },
            ]}
          />
          {/* Phones: end the search + Filters row here. */}
          <div className="basis-full md:hidden" aria-hidden />
          {canReview && reviewCount > 0 && (
            <button
              type="button"
              aria-pressed={reviewOnly}
              onClick={() => setReviewOnly((v) => !v)}
              aria-label={`Needs review (${reviewCount})`}
              title={`Needs review (${reviewCount})`}
              className="hidden h-10 w-10 shrink-0 place-items-center md:grid rounded-lg border border-border bg-surface text-base font-bold text-rose-600 aria-pressed:border-rose-400 aria-pressed:bg-rose-50"
            >
              !
            </button>
          )}
          <p className="text-sm text-muted md:hidden">{count}</p>
          {canReview && missingCount > 0 && (
            <button
              type="button"
              aria-pressed={missingOnly}
              onClick={() => setMissingOnly((v) => !v)}
              className="flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-surface px-3 text-sm aria-pressed:border-stone-500 aria-pressed:bg-stone-100"
            >
              <span className="h-2 w-2 rounded-full bg-stone-500" aria-hidden />
              <span className="hidden xl:inline">Missing from Drive</span>
              <span className="xl:hidden">Missing</span> ({missingCount})
            </button>
          )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {canCreate && driveSync && <div className="mr-1 shrink-0">{driveSync}</div>}
          {updates}
          {canCreate ? (
            <UploadDialog addMenu={{ canTranspose }} />
          ) : (
            canTranspose && <AddMenu canTranspose />
          )}
        </div>
      </div>

      <div className={`${scanning ? "flex" : "hidden md:flex"} items-center justify-between text-sm text-muted`}>
        <p className="hidden md:block">{count}</p>
        {scanning && <p role="status">Scanning {pendingScans} new songsheet{pendingScans === 1 ? "" : "s"}…</p>}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          {songs.length === 0 ? "No songs yet. Upload a songsheet to get started." : "No songs match these filters."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((s) => (
            <li key={s.id} className="relative">
              <Link
                href={`/songs/${s.id}`}
                className="group relative flex h-full min-h-24 flex-col justify-between gap-3 rounded-xl border border-border bg-surface p-4 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
              >
                <div className="space-y-1">
                  <h2 className="font-medium leading-snug group-hover:text-accent">{s.title}</h2>
                  {lyricHit.has(s.id) && <p className="text-xs text-muted">Lyrics match</p>}
                </div>
                <span
                  className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.type ? TYPE_STYLE[s.type] : "bg-stone-100 text-muted"
                  }`}
                >
                  {s.type ? TYPE_LABEL[s.type] : "Type not set"}
                </span>
                {canReview && (s.needsReview || s.missingFromDrive) && (
                  <span className="absolute right-3 top-3 flex gap-1">
                    {s.missingFromDrive && <span className="h-2 w-2 rounded-full bg-stone-500" title="Missing from Google Drive" aria-label="Missing from Google Drive" />}
                    {s.needsReview && <span className="h-2 w-2 rounded-full bg-rose-500" title="Needs review" aria-label="Needs review" />}
                  </span>
                )}
              </Link>
              {s.versionId && (
                <button
                  type="button"
                  onClick={() => setViewing(s)}
                  aria-label={`View ${s.title} songsheet`}
                  title="View songsheet"
                  className="absolute bottom-2.5 right-2.5 rounded-lg p-1.5 text-muted transition hover:bg-background hover:text-foreground"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <PreviewDialog
        open={viewing !== null}
        onClose={() => setViewing(null)}
        versionId={viewing?.versionId ?? null}
        previewPages={viewing?.previewPages ?? null}
        title={viewing?.title ?? ""}
        songId={viewing?.id}
      />
    </div>
  );
}
