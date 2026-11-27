-- Two or more songsheets in the Google Drive folder for the same song (e.g. one uploaded in the app
-- while the original was still waiting to be synced). A Drive sync sets this; choosing which one to
-- keep clears it. Its update kind tells the people who look after the song library.
ALTER TABLE "public"."songs"
    ADD COLUMN IF NOT EXISTS "duplicate_drive_at" timestamp with time zone;

ALTER TABLE "public"."song_events" DROP CONSTRAINT IF EXISTS "song_events_kind_check";
ALTER TABLE "public"."song_events" ADD CONSTRAINT "song_events_kind_check" CHECK (("kind" = ANY (ARRAY[
    'song_added'::"text", 'songsheet_reuploaded'::"text", 'issues_flagged'::"text", 'songsheet_missing'::"text",
    'issue_raised'::"text", 'songsheet_duplicate'::"text"])));
