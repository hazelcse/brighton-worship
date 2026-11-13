-- A worship leader left a session's builder while still in edit mode (the "← Sessions" link and
-- chose "Leave anyway", another page, or closed the tab). Their unsaved edits are kept here, the
-- editing lock is let go (so the other worship leader isn't blocked), and Home reminds them that
-- the session is still open for editing. Opening the session again picks the edits back up; the row
-- goes once they save (the floppy disk) or stop editing (the ×).
CREATE TABLE IF NOT EXISTS "public"."worship_session_open_edits" (
    "session_id" "uuid" NOT NULL REFERENCES "public"."worship_sessions"("id") ON DELETE CASCADE,
    "member_id" "uuid" NOT NULL REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
    "plan" "jsonb" NOT NULL,
    "links" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "left_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    PRIMARY KEY ("session_id", "member_id")
);

CREATE INDEX IF NOT EXISTS "worship_session_open_edits_member_idx" ON "public"."worship_session_open_edits" ("member_id");

ALTER TABLE "public"."worship_session_open_edits" OWNER TO "postgres";
ALTER TABLE "public"."worship_session_open_edits" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."worship_session_open_edits" TO "anon";
GRANT ALL ON TABLE "public"."worship_session_open_edits" TO "authenticated";
GRANT ALL ON TABLE "public"."worship_session_open_edits" TO "service_role";
