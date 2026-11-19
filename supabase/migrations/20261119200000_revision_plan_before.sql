-- A republished session keeps the plan (and session links) it replaced, so the session page can
-- show what changed, added and taken out, like a diff. Revisions published before this have none.
ALTER TABLE "public"."worship_session_revisions"
    ADD COLUMN IF NOT EXISTS "plan_before" jsonb,
    ADD COLUMN IF NOT EXISTS "links_before" jsonb;
