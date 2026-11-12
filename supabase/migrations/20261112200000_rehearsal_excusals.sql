-- A worship leader moved a session's rehearsal to a day a band member is away, and chose to go
-- ahead without a sub. That member then isn't asked to find cover for missing the rehearsal.
-- Only counts while the rehearsal is still on that date (moving it again makes it stale).
CREATE TABLE IF NOT EXISTS "public"."rehearsal_excusals" (
    "session_id" "uuid" NOT NULL REFERENCES "public"."roster_sessions"("id") ON DELETE CASCADE,
    "member_id" "uuid" NOT NULL REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
    "rehearsal_date" "date" NOT NULL,
    "excused_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    PRIMARY KEY ("session_id", "member_id")
);

ALTER TABLE "public"."rehearsal_excusals" OWNER TO "postgres";
ALTER TABLE "public"."rehearsal_excusals" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."rehearsal_excusals" TO "anon";
GRANT ALL ON TABLE "public"."rehearsal_excusals" TO "authenticated";
GRANT ALL ON TABLE "public"."rehearsal_excusals" TO "service_role";
