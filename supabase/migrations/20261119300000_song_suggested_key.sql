-- The key the admin team and leads suggest playing a song in. Filled in by hand on the song's
-- details (the scanner never sets it), so every existing song starts blank.
ALTER TABLE "public"."songs"
    ADD COLUMN IF NOT EXISTS "suggested_key" text;
