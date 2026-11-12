-- The landing page tells each person about changes to the band of sessions they're on, once: up to
-- this time they've been shown. Existing accounts start from now, so old changes don't all appear.
ALTER TABLE "public"."profiles"
    ADD COLUMN IF NOT EXISTS "home_band_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL;
