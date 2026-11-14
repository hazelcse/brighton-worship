-- A person's own rule (root and developers set it on their team card): parts they can play but
-- shouldn't be rostered for. The roster generator leaves them out of those parts.
ALTER TABLE "public"."profiles"
    ADD COLUMN IF NOT EXISTS "no_roster_roles" "text"[] DEFAULT '{}'::"text"[] NOT NULL;
