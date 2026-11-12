import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { loadSongCards } from "@/lib/songs";
import { NoteLoader } from "@/components/note-loader";
import { SongGallery } from "@/components/songs/song-gallery";
import { DriveSyncButton } from "@/components/songs/drive-sync-button";
import { workerFetch } from "@/lib/worker";
import { loadSongUpdates, updateKindsFor } from "@/lib/song-updates";
import { SongUpdatesButton } from "@/components/songs/song-updates";

type DriveStatus = {
  configured: boolean;
  every_minutes: number;
  running?: boolean;
  last_run: { finished_at: string | null; started_at: string } | null;
};

/** Whether Google Drive is set up (asked of the worker; quick, and the page works without it). */
async function driveStatus(): Promise<DriveStatus | null> {
  try {
    return await workerFetch<DriveStatus>("/drive/status", {}, 4_000);
  } catch {
    return null;
  }
}

export const metadata: Metadata = { title: "Songs · Brighton Worship" };

async function SongLibrary() {
  const user = await requireUser();
  if (!user.can("songs.view")) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        You don&apos;t have access to the song library yet. Ask a worship team admin.
      </p>
    );
  }
  const [{ songs, pendingScans }, drive, updates] = await Promise.all([
    loadSongCards(),
    user.can("songs.create") ? driveStatus() : Promise.resolve(null),
    updateKindsFor(user).length ? loadSongUpdates(user.id, updateKindsFor(user)) : Promise.resolve(null),
  ]);
  return (
    <SongGallery
      songs={songs}
      pendingScans={pendingScans}
      canCreate={user.can("songs.create")}
      canReview={user.can("songs.edit")}
      canTranspose={user.can("songs.transpose")}
      updates={updates ? <SongUpdatesButton updates={updates} kinds={updateKindsFor(user)} /> : undefined}
      driveSync={
        drive?.configured ? (
          <DriveSyncButton
            lastSyncedAt={drive.last_run?.finished_at ?? null}
            running={Boolean(drive.running)}
            everyMinutes={drive.every_minutes}
          />
        ) : undefined
      }
    />
  );
}

export default function SongsPage() {
  return (
    <Suspense fallback={<NoteLoader label="Loading the songs" className="py-24" />}>
      <SongLibrary />
    </Suspense>
  );
}
