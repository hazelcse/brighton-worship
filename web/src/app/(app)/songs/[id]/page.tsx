import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NoteLoader } from "@/components/note-loader";
import { requireUser } from "@/lib/auth";
import { LANGUAGE_LABEL, SONG_TYPE_LABEL, loadSong, openIssues } from "@/lib/songs";
import { IssueList } from "@/components/songs/issue-list";
import { ReviewButton } from "@/components/songs/review-button";
import { SequenceView } from "@/components/sessions/sequence-builder";
import { songSteps } from "@/lib/session-plan";
import { SongDetailsForm } from "@/components/songs/song-details-form";
import { SongLinks } from "@/components/songs/song-links";
import { SongVersions } from "@/components/songs/song-versions";
import { SongsheetPreview } from "@/components/songs/songsheet-preview";
import { DeleteSongButton } from "@/components/songs/delete-song-button";
import { ClearMissingButton, RaiseIssueButton } from "@/components/songs/raise-issue-button";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string; edit?: string }> };

async function SongView({ params, searchParams }: Params) {
  const user = await requireUser();
  if (!user.can("songs.view")) notFound();
  const [{ id }, { sheet, edit }] = await Promise.all([params, searchParams]);
  const data = await loadSong(id);
  if (!data) notFound();
  const { song, versions, links, reports } = data;

  const issues = openIssues(versions, song.reviewed_at);
  const canEdit = user.can("songs.edit");
  const hasPreview = versions[0]?.scan_status === "done";
  const canEditLinks = user.can("songs.edit_links");
  // The pencil edits whatever this person may change: the details, the links, or both.
  const editing = (canEdit || canEditLinks) && edit === "1";

  return (
    <div className="space-y-6">
      {/* While editing, the back arrow leaves edit mode (edits are dropped) and shows the song. */}
      <Link href={editing ? `/songs/${song.id}` : "/songs"} scroll={!editing} className="text-sm text-muted hover:text-foreground">
        {editing ? "← Back to song" : "← Songs"}
      </Link>

      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
            {song.title}
            {(canEdit || canEditLinks) && !editing && (
              <Link
                href={`/songs/${song.id}?edit=1`}
                scroll={false}
                aria-label="Edit song details"
                title="Edit song details"
                className="ml-2 inline-flex translate-y-[-0.1em] items-center border-b-2 border-transparent pb-0.5 align-middle text-muted opacity-70 transition hover:border-current hover:opacity-100"
              >
                <PencilIcon />
              </Link>
            )}
          </h1>
          <RaiseIssueButton songId={song.id} title={song.title} />
        </div>
        {song.artist && <p className="text-muted">{song.artist}</p>}
      </header>

      {song.missing_from_drive_at && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-300 bg-stone-100/70 p-4">
          <div>
            <h2 className="font-semibold">Missing from Google Drive</h2>
            <p className="text-sm text-muted">
              This songsheet was removed from the Drive folder on{" "}
              {new Date(song.missing_from_drive_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. The app still
              has its copy, so the song works as normal. It clears itself if the file is added back.
            </p>
          </div>
          {canEdit && <ClearMissingButton songId={song.id} />}
        </section>
      )}

      {(reports.length > 0 || issues.length > 0) && (
        <section
          aria-labelledby="issues-title"
          className="space-y-4 rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="issues-title" className="font-semibold">
              {reports.length + issues.length === 1 ? "1 thing" : `${reports.length + issues.length} things`} to check
            </h2>
            {canEdit && <ReviewButton songId={song.id} />}
          </div>
          <IssueList
            issues={[
              ...reports.map((r) => ({
                code: `report-${r.id}`,
                severity: "warning" as const,
                source: r.by,
                message: r.message,
                note: new Date(r.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
              })),
              ...issues.map((i) => ({ ...i, source: "Scanner" })),
            ]}
          />
        </section>
      )}

      {/* Phones: preview, Details, then the songsheet card and delete. From 1024px: Details on the left
          (both rows), preview above the rest on the right. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[auto_1fr]">
        {hasPreview && (
          <div className="lg:col-start-2 lg:row-start-1">
            <SongsheetPreview
              versionId={versions[0].id}
              previewPages={versions[0].preview_pages ?? null}
              title={song.title}
              openFullSize={sheet === "1"}
            />
          </div>
        )}

        <section
          aria-labelledby="details-title"
          className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5 lg:col-start-1 lg:row-span-2 lg:row-start-1"
        >
          <h2 id="details-title" className="text-lg font-semibold">
            Details
          </h2>
          {editing ? (
            <SongDetailsForm
              song={song}
              links={links}
              canEditDetails={canEdit}
              canEditLinks={canEditLinks}
            />
          ) : (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <ReadOnly
                label="Type"
                value={song.type ? SONG_TYPE_LABEL[song.type] + (song.type_is_estimate ? " (estimated)" : "") : null}
              />
              <ReadOnly label="Tempo" value={song.bpm ? `${Number(song.bpm)} bpm` : null} />
              <ReadOnly label="Language" value={LANGUAGE_LABEL[song.language]} />
              <ReadOnly label="Original key" value={song.original_key} />
              <ReadOnly label="Suggested key" value={song.suggested_key} />
              {song.time_signature && <ReadOnly label="Time signature" value={song.time_signature} />}
              <div className="col-span-2">
                <dt className="text-muted">Standard sequence</dt>
                <dd className="mt-1">
                  <SequenceView steps={songSteps(song.standard_steps, song.standard_sequence)} />
                </dd>
              </div>
              <ReadOnly label="Themes" value={song.themes.join(", ")} className="col-span-2" />
              <SongLinks links={links} />
              <div className="col-span-2">
                <dt className="text-muted">Additional notes</dt>
                <dd className="mt-0.5 whitespace-pre-line font-medium">{song.notes || "—"}</dd>
              </div>
            </dl>
          )}
        </section>

        <div className={`space-y-6 lg:col-start-2 ${hasPreview ? "lg:row-start-2" : "lg:row-start-1"}`}>
          <SongVersions
            songId={song.id}
            version={
              versions[0]
                ? {
                    id: versions[0].id,
                    file_name: versions[0].file_name,
                    key_display: versions[0].key_display,
                    alternate_keys: versions[0].alternate_keys,
                    scan_status: versions[0].scan_status,
                    scan_error: versions[0].scan_error,
                    issues: versions[0].issues,
                    hasPdf: (versions[0].preview_pages ?? 0) > 0,
                    keyInfo: {
                      keys: versions[0].keys ?? [],
                      alternates: versions[0].alternate_keys ?? [],
                      confirmedAt: versions[0].key_confirmed_at ?? null,
                      confirmedBy: versions[0].confirmer?.full_name || versions[0].confirmer?.email || null,
                      scannerKeys: versions[0].scanned_keys ?? null,
                      scannerAlternates: versions[0].scanned_alternates ?? [],
                    },
                  }
                : null
            }
            canReplace={user.can("songs.create") && canEdit}
            canRescan={canEdit}
            canTranspose={user.can("songs.transpose")}
          />
          {user.can("songs.delete") && <DeleteSongButton songId={song.id} title={song.title} />}
        </div>
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      <path d="m14.5 5.5 3 3" />
    </svg>
  );
}

function ReadOnly({ label, value, className }: { label: string; value: string | null | undefined; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{value || "—"}</dd>
    </div>
  );
}

export default function SongPage({ params, searchParams }: Params) {
  return (
    <Suspense fallback={<NoteLoader label="Loading the song" className="py-24" />}>
      <SongView params={params} searchParams={searchParams} />
    </Suspense>
  );
}
