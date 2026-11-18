-- Someone on both a worship team and a media team picks, in Settings, which one they land on when
-- they log in. Null: worship. (The login page's title no longer chooses: it just cycles.)
ALTER TABLE "public"."profiles"
    ADD COLUMN IF NOT EXISTS "landing_kind" text CHECK ("landing_kind" IN ('worship', 'media'));
