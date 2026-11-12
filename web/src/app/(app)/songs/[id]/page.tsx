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

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string }> };

async function SongView({ params, searchParams }: Params) {
  const user = await requireUser();
  if (!user.can("songs.view")) notFound();
  const [{ id }, { sheet }] = await Promise.all([params, searchParams]);
  const data = await loadSong(id);
  if (!data) notFound();
  const { song, versions, links, reports } = data;

  const issues = openIssues(versions, song.reviewed_at);
  const keys = [...new Set(versions.map((v) => v.key_display).filter(Boolean))] as string[];
  const latest = [...versions].reverse().find((v) => v.scan_status === "done");
  const canEdit = user.can("songs.edit");

  return (
    <div className="space-y-6">
      <Link href="/songs" className="text-sm text-muted hover:text-foreground">
        ← Songs
      </Link>

      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">{song.title}</h1>
          <RaiseIssueButton songId={song.id} title={song.title} />
        </div>
        {song.artist && <p className="text-muted">{song.artist}</p>}
        <dl className="flex flex-wrap gap-2 text-sm">
          {[
            ["Type", song.type ? SONG_TYPE_LABEL[song.type] + (song.type_is_estimate ? " (estimated)" : "") : "Not set"],
            ["Key", keys.join(", ") || "Unknown"],
            ["Tempo", song.bpm ? `${Number(song.bpm)} bpm` : "Unknown"],
            ...(song.time_signature ? [["Time", song.time_signature]] : []),
            ["Language", LANGUAGE_LABEL[song.language]],
          ].map(([k, v]) => (
            <div key={k} className="rounded-full border border-border bg-surface px-3 py-1">
              <dt className="inline text-muted">{k}: </dt>
              <dd className="inline font-medium">{v}</dd>
            </div>
          ))}
        </dl>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="details-title" className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 id="details-title" className="text-lg font-semibold">
            Details
          </h2>
          {canEdit ? (
            <SongDetailsForm
              song={song}
              detectedSequence={latest?.chart_sequence ?? []}
              lyricSequence={latest?.lyric_sequence ?? []}
            />
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <ReadOnly label="Sections" value={song.sections.join(", ")} />
              <div className="sm:col-span-2">
                <dt className="text-muted">Standard sequence</dt>
                <dd className="mt-1">
                  <SequenceView steps={songSteps(song.standard_steps, song.standard_sequence)} />
                </dd>
              </div>
              <ReadOnly label="Themes" value={song.themes.join(", ")} />
              <ReadOnly label="Original key" value={song.original_key} />
              <div className="sm:col-span-2">
                <dt className="text-muted">Additional notes</dt>
                <dd className="mt-0.5 whitespace-pre-line font-medium">{song.notes || "—"}</dd>
              </div>
            </dl>
          )}
        </section>

        <div className="order-first space-y-6 lg:order-none">
          {versions[0] && versions[0].scan_status === "done" && (
            <SongsheetPreview
              versionId={versions[0].id}
              previewPages={versions[0].preview_pages ?? null}
              title={song.title}
              openFullSize={sheet === "1"}
            />
          )}
          <SongLinks songId={song.id} links={links} canEdit={user.can("songs.edit_links")} />
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

function ReadOnly({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
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
