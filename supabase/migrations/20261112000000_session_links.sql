-- Links for a whole session (e.g. a reference playlist or the service run sheet), on top of each
-- song's own links. `links` is the published (or never-published draft) list; `draft_links` is the
-- worship leaders' revised list, saved alongside `draft_plan` and published with it. A revision
-- saved before this column existed has draft_links null: it keeps the published links.
ALTER TABLE "public"."worship_sessions"
    ADD COLUMN IF NOT EXISTS "links" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    ADD COLUMN IF NOT EXISTS "draft_links" "jsonb";
