/**
 * Server-side caches of data that's the same for everyone (`"use cache: remote"` + cacheTag).
 *
 * Every Server Action that changes the data must call `updateTag(<tag>)`, so the next page load
 * waits for fresh data instead of showing the cached copy. Changes made outside the app (the
 * worker's scheduled Drive sync, edits in the Supabase dashboard) don't clear the tag, so each cache
 * also expires on its own after a few minutes (CACHE_LIFE).
 */

/** The song library: songs, their songsheet versions, open issue reports, links. */
export const SONGS_TAG = "songs";

/** Refreshed in the background after 5 minutes; never served once an hour old. */
export const CACHE_LIFE = { stale: 60, revalidate: 300, expire: 3600 } as const;
