import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { loadSongCards } from "@/lib/songs";
import { Transposer } from "@/components/songs/transposer";

export const metadata: Metadata = { title: "Transpose songsheet · Brighton Worship" };

async function TransposeView({ searchParams }: { searchParams: Promise<{ song?: string }> }) {
  const user = await requireUser();
  if (!user.can("songs.transpose")) {
    return (
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        You don&apos;t have permission to transpose songsheets. Ask a worship team admin.
      </p>
    );
  }
  const [{ song }, { songs }] = await Promise.all([searchParams, loadSongCards()]);
  return (
    <Transposer
      songs={songs.filter((s) => s.keys.length > 0).map((s) => ({ id: s.id, title: s.title, key: s.keys[0] }))}
      initialSongId={song ?? null}
      canBrowseLibrary={user.can("songs.view")}
    />
  );
}

export default function TransposePage({ searchParams }: { searchParams: Promise<{ song?: string }> }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/songs" className="text-sm text-muted hover:text-foreground">
        ← Songs
      </Link>
      <div>
        <h1 className="font-display text-4xl font-semibold">Transpose songsheet</h1>
        <p className="mt-1 text-sm text-muted">
          Get any song in a new key. The chords are changed and the layout is kept: every chord stays on its line, and the
          chord box is widened if a line needs more room.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <TransposeView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
