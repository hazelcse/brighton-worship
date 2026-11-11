-- =============================================================================
-- Brighton Worship: baseline schema
--
-- This one file replaces the 47 development migrations (20261107000000 to
-- 20261111040000). It builds the database exactly as those migrations left it:
--   1. Structure: tables, types, functions, policies, grants (dumped by the Supabase CLI)
--   2. The trigger on auth.users that creates a profile for every new login
--   3. Starting data: groups, permissions, instruments, roster rules
--   4. The private `songsheets` storage bucket
--
-- New changes go in new migration files after this one; never edit this file once
-- it has run on the hosted database.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Structure
-- -----------------------------------------------------------------------------



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."permission_effect" AS ENUM (
    'allow',
    'deny'
);


ALTER TYPE "public"."permission_effect" OWNER TO "postgres";


CREATE TYPE "public"."scan_status" AS ENUM (
    'pending',
    'scanning',
    'done',
    'failed'
);


ALTER TYPE "public"."scan_status" OWNER TO "postgres";


CREATE TYPE "public"."song_language" AS ENUM (
    'en',
    'zh'
);


ALTER TYPE "public"."song_language" OWNER TO "postgres";


CREATE TYPE "public"."song_type" AS ENUM (
    'praise',
    'worship',
    'praise_worship'
);


ALTER TYPE "public"."song_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."developer_reset_app_data"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Session tracking (root's record of past sessions)
  delete from session_records where true;

  -- Sessions and their plans
  delete from worship_session_revision_dismissals where true;
  delete from worship_session_revisions where true;
  delete from worship_sessions where true;  -- sections and items cascade

  -- Notifications and requests
  delete from roster_updates where true;
  delete from handover_requests where true;
  delete from swap_proposals where true;
  delete from cover_requests where true;
  delete from serve_requests where true;

  -- Rosters (sessions, assignments and roster-only rules cascade; the shared rule library stays)
  delete from rosters where true;

  -- Broadcasts (responses cascade)
  delete from broadcasts where true;

  -- Absences
  delete from absence_declarations where true;
  delete from absences where true;

  -- Song library
  delete from song_events where true;
  delete from song_issues where true;
  delete from drive_files where true;
  delete from drive_sync_runs where true;
  delete from transposed_songsheets where true;
  delete from song_versions where true;
  delete from songs where true;  -- links, key instruments cascade

  update profiles set updates_seen_at = null, song_updates_seen_at = null, sessions_seen_at = null where true;
end;
$$;


ALTER FUNCTION "public"."developer_reset_app_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."effective_permissions"("p_user_id" "uuid") RETURNS SETOF "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with me as (
    select is_root or is_developer as is_all, is_active from public.profiles where id = p_user_id
  )
  -- Root and developers get every permission.
  select p.key from public.permissions p, me where me.is_all and me.is_active
  union
  select granted.key
  from (
    select gp.permission_key as key
    from public.user_groups ug
    join public.group_permissions gp on gp.group_id = ug.group_id
    where ug.user_id = p_user_id
    union
    select o.permission_key
    from public.user_permission_overrides o
    where o.user_id = p_user_id and o.effect = 'allow'
  ) granted, me
  where me.is_active and not me.is_all
    and not exists (
      select 1 from public.user_permission_overrides d
      where d.user_id = p_user_id
        and d.permission_key = granted.key
        and d.effect = 'deny'
    );
$$;


ALTER FUNCTION "public"."effective_permissions"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_permissions"() RETURNS SETOF "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.effective_permissions(auth.uid());
$$;


ALTER FUNCTION "public"."my_permissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_worship_session_plan"("p_session_id" "uuid", "p_user_id" "uuid", "p_plan" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  sec jsonb;
  itm jsonb;
  si integer := 0;
  ii integer;
begin
  delete from worship_session_sections where session_id = p_session_id;
  for sec in select * from jsonb_array_elements(coalesce(p_plan, '[]'::jsonb)) loop
    insert into worship_session_sections (id, session_id, name, position)
    values ((sec->>'id')::uuid, p_session_id, coalesce(nullif(trim(sec->>'name'), ''), 'Section'), si);
    ii := 0;
    for itm in select * from jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) loop
      insert into worship_session_items
        (id, section_id, position, kind, song_id, lead_id, title, type, bpm, key, transpose_to, artist, sequence, custom_elements, links, notes)
      values (
        (itm->>'id')::uuid,
        (sec->>'id')::uuid,
        ii,
        coalesce(itm->>'kind', 'song'),
        nullif(itm->>'song_id', '')::uuid,
        nullif(itm->>'lead_id', '')::uuid,
        coalesce(itm->>'title', ''),
        nullif(itm->>'type', '')::song_type,
        nullif(itm->>'bpm', '')::numeric,
        nullif(itm->>'key', ''),
        nullif(itm->>'transpose_to', ''),
        nullif(itm->>'artist', ''),
        case when jsonb_typeof(itm->'sequence') = 'array' then itm->'sequence' end,
        case when jsonb_typeof(itm->'custom_elements') = 'array'
             then array(select jsonb_array_elements_text(itm->'custom_elements')) else '{}' end,
        case when jsonb_typeof(itm->'links') = 'array' then itm->'links' end,
        coalesce(itm->>'notes', '')
      );
      ii := ii + 1;
    end loop;
    si := si + 1;
  end loop;
  update worship_sessions set updated_at = now(), updated_by = p_user_id where id = p_session_id;
end;
$$;


ALTER FUNCTION "public"."save_worship_session_plan"("p_session_id" "uuid", "p_user_id" "uuid", "p_plan" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_root"("p_from" "uuid", "p_to" "uuid", "p_from_group" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_from = p_to then
    raise exception 'Choose someone else to become root.';
  end if;
  if not exists (select 1 from public.profiles where id = p_from and is_root and is_active) then
    raise exception 'Only the current root can hand over root.';
  end if;
  if not exists (select 1 from public.profiles where id = p_to and is_active) then
    raise exception 'The new root must be an active member.';
  end if;
  if p_from_group is not null and not exists (select 1 from public.groups where id = p_from_group) then
    raise exception 'That permission group doesn''t exist.';
  end if;

  update public.profiles set is_root = false, updated_at = now() where id = p_from;
  update public.profiles set is_root = true, updated_at = now() where id = p_to;

  if p_from_group is not null then
    insert into public.user_groups (user_id, group_id) values (p_from, p_from_group)
    on conflict do nothing;
  end if;
end;
$$;


ALTER FUNCTION "public"."transfer_root"("p_from" "uuid", "p_to" "uuid", "p_from_group" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."absence_declarations" (
    "member_id" "uuid" NOT NULL,
    "quarter_start" "date" NOT NULL,
    "declared_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."absence_declarations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."absences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "starts_on" "date" NOT NULL,
    "ends_on" "date" NOT NULL,
    "reason" "text" DEFAULT 'Absence'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "absences_check" CHECK (("ends_on" >= "starts_on")),
    CONSTRAINT "absences_reason_check" CHECK ((("char_length"("reason") >= 1) AND ("char_length"("reason") <= 80)))
);


ALTER TABLE "public"."absences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" bigint NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "target" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


ALTER TABLE "public"."audit_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."broadcast_responses" (
    "broadcast_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "responded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."broadcast_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."broadcasts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "requires_ack" boolean DEFAULT false NOT NULL,
    "ack_message" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "broadcasts_ack_message" CHECK (((NOT "requires_ack") OR ("btrim"(COALESCE("ack_message", ''::"text")) <> ''::"text"))),
    CONSTRAINT "broadcasts_message_check" CHECK (("btrim"("message") <> ''::"text")),
    CONSTRAINT "broadcasts_title_check" CHECK (("btrim"("title") <> ''::"text"))
);


ALTER TABLE "public"."broadcasts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cover_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "target_id" "uuid",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "taken_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "swap_session_id" "uuid",
    CONSTRAINT "cover_requests_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'taken'::"text", 'refused'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."cover_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drive_files" (
    "drive_file_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "fingerprint" "text",
    "modified_time" timestamp with time zone,
    "song_id" "uuid",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "error" "text",
    "last_synced_at" timestamp with time zone,
    "missing_since" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "drive_files_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'synced'::"text", 'failed'::"text", 'removed'::"text"])))
);


ALTER TABLE "public"."drive_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drive_sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "trigger" "text" NOT NULL,
    "started_by" "uuid",
    "summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error" "text",
    CONSTRAINT "drive_sync_runs_trigger_check" CHECK (("trigger" = ANY (ARRAY['manual'::"text", 'schedule'::"text"])))
);


ALTER TABLE "public"."drive_sync_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_permissions" (
    "group_id" "uuid" NOT NULL,
    "permission_key" "text" NOT NULL
);


ALTER TABLE "public"."group_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."handover_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    CONSTRAINT "handover_requests_role_check" CHECK (("role" = 'band leader'::"text")),
    CONSTRAINT "handover_requests_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'accepted'::"text", 'refused'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."handover_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."instruments" (
    "id" smallint NOT NULL,
    "name" "text" NOT NULL,
    "position" smallint DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."instruments" OWNER TO "postgres";


ALTER TABLE "public"."instruments" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."instruments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "key" "text" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text" NOT NULL,
    CONSTRAINT "permissions_key_check" CHECK (("key" ~ '^[a-z_]+(\.[a-z_]+)+$'::"text"))
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text" DEFAULT ''::"text" NOT NULL,
    "is_root" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uid" integer,
    "instruments" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "em_percent" smallint,
    "gender" "text",
    "serves" "text" DEFAULT 'both'::"text" NOT NULL,
    "is_developer" boolean DEFAULT false NOT NULL,
    "must_change_password" boolean DEFAULT false NOT NULL,
    "updates_seen_at" timestamp with time zone,
    "song_updates_seen_at" timestamp with time zone,
    "sessions_seen_at" timestamp with time zone,
    CONSTRAINT "profiles_em_percent_check" CHECK ((("em_percent" >= 0) AND ("em_percent" <= 100))),
    CONSTRAINT "profiles_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text"]))),
    CONSTRAINT "profiles_instruments_valid" CHECK (("instruments" <@ ARRAY['keys'::"text", 'synth/pads'::"text", 'electric guitar'::"text", 'acoustic guitar'::"text", 'bass'::"text", 'drums'::"text", 'worship leader'::"text", 'vocalist'::"text", 'band leader'::"text"])),
    CONSTRAINT "profiles_serves_check" CHECK (("serves" = ANY (ARRAY['both'::"text", 'sunday'::"text", 'pnp'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."profiles_uid_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."profiles_uid_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."profiles_uid_seq" OWNED BY "public"."profiles"."uid";



CREATE TABLE IF NOT EXISTS "public"."roster_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "also_roles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."roster_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roster_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template" "text" NOT NULL,
    "params" "jsonb" NOT NULL,
    "hard" boolean DEFAULT false NOT NULL,
    "weight" numeric(3,2) DEFAULT 0.5 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "permanent" boolean DEFAULT false NOT NULL,
    "roster_id" "uuid",
    CONSTRAINT "roster_rules_permanent_is_default" CHECK (((NOT "permanent") OR ("roster_id" IS NULL))),
    CONSTRAINT "roster_rules_template_check" CHECK (("template" = ANY (ARRAY['frequency'::"text", 'pair'::"text", 'break'::"text", 'date'::"text", 'fairness'::"text", 'spacing'::"text", 'variety'::"text", 'singer_balance'::"text", 'bl_backup'::"text"]))),
    CONSTRAINT "roster_rules_weight_check" CHECK ((("weight" >= (0)::numeric) AND ("weight" <= (1)::numeric)))
);


ALTER TABLE "public"."roster_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roster_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "roster_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "kind" "text" NOT NULL,
    "name" "text" NOT NULL,
    "ministry" "text" NOT NULL,
    "weight" numeric(3,2) DEFAULT 1 NOT NULL,
    "composition" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "cancelled" boolean DEFAULT false NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rehearsal_date" "date",
    "start_time" time without time zone,
    "rehearsal_time" time without time zone,
    "source_session_id" "uuid",
    "cancel_reason" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "roster_sessions_kind_check" CHECK (("kind" = ANY (ARRAY['em_sunday'::"text", 'cm_sunday'::"text", 'em_pnp'::"text", 'cm_pnp'::"text", 'custom'::"text"]))),
    CONSTRAINT "roster_sessions_ministry_check" CHECK (("ministry" = ANY (ARRAY['em'::"text", 'cm'::"text", 'any'::"text"]))),
    CONSTRAINT "roster_sessions_rehearsal_before" CHECK ((("rehearsal_date" IS NULL) OR ("rehearsal_date" <= "date"))),
    CONSTRAINT "roster_sessions_weight_check" CHECK ((("weight" >= (0)::numeric) AND ("weight" <= (1)::numeric)))
);


ALTER TABLE "public"."roster_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roster_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "session_id" "uuid",
    "role" "text",
    "actor_id" "uuid",
    "member_id" "uuid",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "other_session_id" "uuid",
    "resolved_at" timestamp with time zone,
    "detail" "text",
    CONSTRAINT "roster_updates_kind_check" CHECK (("kind" = ANY (ARRAY['declined'::"text", 'asked'::"text", 'posted'::"text", 'taken'::"text", 'refused'::"text", 'cancelled'::"text", 'swap_proposed'::"text", 'swap_declined'::"text", 'swapped'::"text", 'band_role_asked'::"text", 'band_role_taken'::"text", 'band_role_refused'::"text", 'band_role_missing'::"text", 'session_updated'::"text", 'roster_added'::"text", 'roster_removed'::"text", 'roster_part_changed'::"text", 'roster_session_changed'::"text", 'roster_band_changed'::"text"])))
);


ALTER TABLE "public"."roster_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rosters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "starts_on" "date" NOT NULL,
    "ends_on" "date" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    "result" "jsonb",
    "generated_at" timestamp with time zone,
    "generated_assignments" "jsonb",
    "check" "jsonb",
    "revision_of" "uuid",
    "revision_base" "jsonb",
    CONSTRAINT "rosters_check" CHECK (("ends_on" >= "starts_on")),
    CONSTRAINT "rosters_revision_of_check" CHECK ((("status" = 'revision'::"text") = ("revision_of" IS NOT NULL))),
    CONSTRAINT "rosters_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text", 'revision'::"text"])))
);


ALTER TABLE "public"."rosters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."serve_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "roster_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reason" "text",
    "responded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "serve_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."serve_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "roster_session_id" "uuid",
    "date" "date" NOT NULL,
    "ministry" "text" DEFAULT 'any'::"text" NOT NULL,
    "kind" "text" DEFAULT 'custom'::"text" NOT NULL,
    "service_name" "text" NOT NULL,
    "band" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "songs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "links" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "comments" "text" DEFAULT ''::"text" NOT NULL,
    "confirmed_by" "uuid",
    "confirmed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_records_links_check" CHECK (("cardinality"("links") <= 2)),
    CONSTRAINT "session_records_ministry_check" CHECK (("ministry" = ANY (ARRAY['em'::"text", 'cm'::"text", 'any'::"text"]))),
    CONSTRAINT "session_records_songs_check" CHECK ((("jsonb_typeof"("songs") = 'array'::"text") AND ("jsonb_array_length"("songs") <= 5)))
);


ALTER TABLE "public"."session_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."song_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "song_id" "uuid",
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "source" "text" DEFAULT 'upload'::"text" NOT NULL,
    "actor_id" "uuid",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "song_events_kind_check" CHECK (("kind" = ANY (ARRAY['song_added'::"text", 'songsheet_reuploaded'::"text", 'issues_flagged'::"text", 'songsheet_missing'::"text", 'issue_raised'::"text"]))),
    CONSTRAINT "song_events_source_check" CHECK (("source" = ANY (ARRAY['upload'::"text", 'drive'::"text"])))
);


ALTER TABLE "public"."song_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."song_issues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "song_id" "uuid" NOT NULL,
    "raised_by" "uuid",
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    CONSTRAINT "song_issues_message_check" CHECK ((("length"(TRIM(BOTH FROM "message")) >= 1) AND ("length"(TRIM(BOTH FROM "message")) <= 2000)))
);


ALTER TABLE "public"."song_issues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."song_key_instruments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "song_id" "uuid" NOT NULL,
    "instrument_id" smallint NOT NULL,
    "section" "text",
    "note" "text"
);


ALTER TABLE "public"."song_key_instruments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."song_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "song_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "url" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "song_links_url_check" CHECK (("url" ~* '^https?://'::"text"))
);


ALTER TABLE "public"."song_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."song_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "song_id" "uuid",
    "file_name" "text" NOT NULL,
    "file_sha256" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "original_path" "text" NOT NULL,
    "docx_path" "text",
    "key_display" "text",
    "keys" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "alternate_keys" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "scan" "jsonb",
    "issues" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "scan_status" "public"."scan_status" DEFAULT 'pending'::"public"."scan_status" NOT NULL,
    "scan_error" "text",
    "scanner_version" integer,
    "scanned_at" timestamp with time zone,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "preview_pages" integer,
    "preview_error" "text",
    "key_confirmed_at" timestamp with time zone,
    "key_confirmed_by" "uuid"
);


ALTER TABLE "public"."song_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."songs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "title_key" "text" NOT NULL,
    "artist" "text",
    "type" "public"."song_type",
    "type_is_estimate" boolean DEFAULT true NOT NULL,
    "bpm" numeric(5,1),
    "time_signature" "text",
    "language" "public"."song_language" DEFAULT 'en'::"public"."song_language" NOT NULL,
    "sections" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "standard_sequence" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "themes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "original_key" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "missing_from_drive_at" timestamp with time zone,
    "standard_steps" "jsonb",
    "lyrics" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."songs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."swap_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cover_id" "uuid" NOT NULL,
    "counterpart_id" "uuid" NOT NULL,
    "offer_session_id" "uuid" NOT NULL,
    "proposed_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    CONSTRAINT "swap_proposals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'replaced'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."swap_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transposed_songsheets" (
    "version_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transposed_songsheets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_groups" (
    "user_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_permission_overrides" (
    "user_id" "uuid" NOT NULL,
    "permission_key" "text" NOT NULL,
    "effect" "public"."permission_effect" NOT NULL
);


ALTER TABLE "public"."user_permission_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."worship_session_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "section_id" "uuid" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "kind" "text" DEFAULT 'song'::"text" NOT NULL,
    "song_id" "uuid",
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "type" "public"."song_type",
    "bpm" numeric(5,1),
    "key" "text",
    "artist" "text",
    "sequence" "jsonb",
    "links" "jsonb",
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "lead_id" "uuid",
    "custom_elements" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "transpose_to" "text",
    CONSTRAINT "worship_session_items_kind_check" CHECK (("kind" = ANY (ARRAY['song'::"text", 'transition'::"text"])))
);


ALTER TABLE "public"."worship_session_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."worship_session_revision_dismissals" (
    "revision_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "dismissed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."worship_session_revision_dismissals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."worship_session_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_by" "uuid",
    "changes" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."worship_session_revisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."worship_session_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."worship_session_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."worship_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "service" "text" NOT NULL,
    "service_name" "text" NOT NULL,
    "roster_session_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "locked_by" "uuid",
    "locked_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    "published_by" "uuid",
    "draft_plan" "jsonb",
    "draft_updated_at" timestamp with time zone,
    "draft_updated_by" "uuid",
    CONSTRAINT "worship_sessions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."worship_sessions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."absence_declarations"
    ADD CONSTRAINT "absence_declarations_pkey" PRIMARY KEY ("member_id", "quarter_start");



ALTER TABLE ONLY "public"."absences"
    ADD CONSTRAINT "absences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."broadcast_responses"
    ADD CONSTRAINT "broadcast_responses_pkey" PRIMARY KEY ("broadcast_id", "member_id");



ALTER TABLE ONLY "public"."broadcasts"
    ADD CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cover_requests"
    ADD CONSTRAINT "cover_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drive_files"
    ADD CONSTRAINT "drive_files_pkey" PRIMARY KEY ("drive_file_id");



ALTER TABLE ONLY "public"."drive_sync_runs"
    ADD CONSTRAINT "drive_sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_permissions"
    ADD CONSTRAINT "group_permissions_pkey" PRIMARY KEY ("group_id", "permission_key");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."handover_requests"
    ADD CONSTRAINT "handover_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instruments"
    ADD CONSTRAINT "instruments_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."instruments"
    ADD CONSTRAINT "instruments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_uid_key" UNIQUE ("uid");



ALTER TABLE ONLY "public"."roster_assignments"
    ADD CONSTRAINT "roster_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roster_assignments"
    ADD CONSTRAINT "roster_assignments_session_id_member_id_key" UNIQUE ("session_id", "member_id");



ALTER TABLE ONLY "public"."roster_rules"
    ADD CONSTRAINT "roster_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roster_sessions"
    ADD CONSTRAINT "roster_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roster_updates"
    ADD CONSTRAINT "roster_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rosters"
    ADD CONSTRAINT "rosters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."serve_requests"
    ADD CONSTRAINT "serve_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."serve_requests"
    ADD CONSTRAINT "serve_requests_session_id_member_id_key" UNIQUE ("session_id", "member_id");



ALTER TABLE ONLY "public"."session_records"
    ADD CONSTRAINT "session_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_records"
    ADD CONSTRAINT "session_records_roster_session_id_key" UNIQUE ("roster_session_id");



ALTER TABLE ONLY "public"."song_events"
    ADD CONSTRAINT "song_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."song_issues"
    ADD CONSTRAINT "song_issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."song_key_instruments"
    ADD CONSTRAINT "song_key_instruments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."song_links"
    ADD CONSTRAINT "song_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."song_links"
    ADD CONSTRAINT "song_links_song_id_url_key" UNIQUE ("song_id", "url");



ALTER TABLE ONLY "public"."song_versions"
    ADD CONSTRAINT "song_versions_file_sha256_key" UNIQUE ("file_sha256");



ALTER TABLE ONLY "public"."song_versions"
    ADD CONSTRAINT "song_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."songs"
    ADD CONSTRAINT "songs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."swap_proposals"
    ADD CONSTRAINT "swap_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transposed_songsheets"
    ADD CONSTRAINT "transposed_songsheets_pkey" PRIMARY KEY ("version_id", "key");



ALTER TABLE ONLY "public"."user_groups"
    ADD CONSTRAINT "user_groups_pkey" PRIMARY KEY ("user_id", "group_id");



ALTER TABLE ONLY "public"."user_permission_overrides"
    ADD CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("user_id", "permission_key");



ALTER TABLE ONLY "public"."worship_session_items"
    ADD CONSTRAINT "worship_session_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."worship_session_revision_dismissals"
    ADD CONSTRAINT "worship_session_revision_dismissals_pkey" PRIMARY KEY ("revision_id", "member_id");



ALTER TABLE ONLY "public"."worship_session_revisions"
    ADD CONSTRAINT "worship_session_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."worship_session_sections"
    ADD CONSTRAINT "worship_session_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."worship_sessions"
    ADD CONSTRAINT "worship_sessions_date_service_service_name_key" UNIQUE ("date", "service", "service_name");



ALTER TABLE ONLY "public"."worship_sessions"
    ADD CONSTRAINT "worship_sessions_pkey" PRIMARY KEY ("id");



CREATE INDEX "absence_declarations_quarter" ON "public"."absence_declarations" USING "btree" ("quarter_start");



CREATE INDEX "absences_ends_on" ON "public"."absences" USING "btree" ("ends_on");



CREATE INDEX "absences_member" ON "public"."absences" USING "btree" ("member_id");



CREATE INDEX "audit_log_created_at" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "broadcast_responses_member" ON "public"."broadcast_responses" USING "btree" ("member_id");



CREATE INDEX "broadcasts_created_at" ON "public"."broadcasts" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "cover_requests_one_board" ON "public"."cover_requests" USING "btree" ("session_id", "member_id") WHERE (("status" = 'open'::"text") AND ("target_id" IS NULL));



CREATE UNIQUE INDEX "cover_requests_one_direct" ON "public"."cover_requests" USING "btree" ("session_id", "member_id") WHERE (("status" = 'open'::"text") AND ("target_id" IS NOT NULL));



CREATE INDEX "cover_requests_open" ON "public"."cover_requests" USING "btree" ("status", "session_id");



CREATE INDEX "drive_files_song_idx" ON "public"."drive_files" USING "btree" ("song_id");



CREATE INDEX "handover_requests_open" ON "public"."handover_requests" USING "btree" ("status", "session_id");



CREATE INDEX "handover_requests_target" ON "public"."handover_requests" USING "btree" ("target_id", "status");



CREATE UNIQUE INDEX "profiles_full_name_unique" ON "public"."profiles" USING "btree" ("lower"("btrim"("full_name"))) WHERE ("btrim"("full_name") <> ''::"text");



CREATE UNIQUE INDEX "profiles_single_root" ON "public"."profiles" USING "btree" ("is_root") WHERE "is_root";



CREATE UNIQUE INDEX "roster_rules_one_bl_backup" ON "public"."roster_rules" USING "btree" ("template") WHERE ("template" = 'bl_backup'::"text");



CREATE UNIQUE INDEX "roster_rules_one_fairness" ON "public"."roster_rules" USING "btree" ("template") WHERE ("template" = 'fairness'::"text");



CREATE UNIQUE INDEX "roster_rules_one_singer_balance" ON "public"."roster_rules" USING "btree" ("template") WHERE ("template" = 'singer_balance'::"text");



CREATE UNIQUE INDEX "roster_rules_one_spacing" ON "public"."roster_rules" USING "btree" ("template") WHERE ("template" = 'spacing'::"text");



CREATE UNIQUE INDEX "roster_rules_one_variety" ON "public"."roster_rules" USING "btree" ("template") WHERE ("template" = 'variety'::"text");



CREATE INDEX "roster_rules_roster_idx" ON "public"."roster_rules" USING "btree" ("roster_id");



CREATE INDEX "roster_sessions_roster" ON "public"."roster_sessions" USING "btree" ("roster_id", "date");



CREATE INDEX "roster_updates_created" ON "public"."roster_updates" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "rosters_one_draft_per_quarter" ON "public"."rosters" USING "btree" ("starts_on") WHERE ("status" = 'draft'::"text");



CREATE UNIQUE INDEX "rosters_one_published_per_quarter" ON "public"."rosters" USING "btree" ("starts_on") WHERE ("status" = 'published'::"text");



CREATE UNIQUE INDEX "rosters_one_revision" ON "public"."rosters" USING "btree" ("revision_of") WHERE ("revision_of" IS NOT NULL);



CREATE INDEX "serve_requests_member" ON "public"."serve_requests" USING "btree" ("member_id", "status");



CREATE INDEX "serve_requests_roster" ON "public"."serve_requests" USING "btree" ("roster_id");



CREATE INDEX "session_records_date" ON "public"."session_records" USING "btree" ("date" DESC);



CREATE INDEX "song_events_created_idx" ON "public"."song_events" USING "btree" ("created_at" DESC);



CREATE INDEX "song_issues_open_idx" ON "public"."song_issues" USING "btree" ("song_id") WHERE ("resolved_at" IS NULL);



CREATE UNIQUE INDEX "song_key_instruments_unique" ON "public"."song_key_instruments" USING "btree" ("song_id", "instrument_id", COALESCE("section", ''::"text"));



CREATE UNIQUE INDEX "song_versions_one_per_song" ON "public"."song_versions" USING "btree" ("song_id") WHERE ("song_id" IS NOT NULL);



CREATE INDEX "song_versions_pending" ON "public"."song_versions" USING "btree" ("scan_status") WHERE ("scan_status" <> 'done'::"public"."scan_status");



CREATE INDEX "song_versions_song" ON "public"."song_versions" USING "btree" ("song_id");



CREATE INDEX "songs_title_key" ON "public"."songs" USING "btree" ("title_key");



CREATE INDEX "songs_title_trgm" ON "public"."songs" USING "gin" ("title" "extensions"."gin_trgm_ops");



CREATE INDEX "swap_proposals_cover" ON "public"."swap_proposals" USING "btree" ("cover_id", "status");



CREATE INDEX "worship_session_items_section" ON "public"."worship_session_items" USING "btree" ("section_id", "position");



CREATE INDEX "worship_session_items_song" ON "public"."worship_session_items" USING "btree" ("song_id");



CREATE INDEX "worship_session_revisions_session" ON "public"."worship_session_revisions" USING "btree" ("session_id", "published_at" DESC);



CREATE INDEX "worship_session_sections_session" ON "public"."worship_session_sections" USING "btree" ("session_id", "position");



CREATE INDEX "worship_sessions_roster_session" ON "public"."worship_sessions" USING "btree" ("roster_session_id");



ALTER TABLE ONLY "public"."absence_declarations"
    ADD CONSTRAINT "absence_declarations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."absences"
    ADD CONSTRAINT "absences_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."broadcast_responses"
    ADD CONSTRAINT "broadcast_responses_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."broadcast_responses"
    ADD CONSTRAINT "broadcast_responses_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."broadcasts"
    ADD CONSTRAINT "broadcasts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cover_requests"
    ADD CONSTRAINT "cover_requests_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cover_requests"
    ADD CONSTRAINT "cover_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cover_requests"
    ADD CONSTRAINT "cover_requests_swap_session_id_fkey" FOREIGN KEY ("swap_session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cover_requests"
    ADD CONSTRAINT "cover_requests_taken_by_fkey" FOREIGN KEY ("taken_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cover_requests"
    ADD CONSTRAINT "cover_requests_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drive_files"
    ADD CONSTRAINT "drive_files_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drive_sync_runs"
    ADD CONSTRAINT "drive_sync_runs_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_permissions"
    ADD CONSTRAINT "group_permissions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_permissions"
    ADD CONSTRAINT "group_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."handover_requests"
    ADD CONSTRAINT "handover_requests_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."handover_requests"
    ADD CONSTRAINT "handover_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."handover_requests"
    ADD CONSTRAINT "handover_requests_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roster_assignments"
    ADD CONSTRAINT "roster_assignments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roster_assignments"
    ADD CONSTRAINT "roster_assignments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roster_rules"
    ADD CONSTRAINT "roster_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roster_rules"
    ADD CONSTRAINT "roster_rules_roster_id_fkey" FOREIGN KEY ("roster_id") REFERENCES "public"."rosters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roster_rules"
    ADD CONSTRAINT "roster_rules_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roster_sessions"
    ADD CONSTRAINT "roster_sessions_roster_id_fkey" FOREIGN KEY ("roster_id") REFERENCES "public"."rosters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roster_sessions"
    ADD CONSTRAINT "roster_sessions_source_session_id_fkey" FOREIGN KEY ("source_session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roster_updates"
    ADD CONSTRAINT "roster_updates_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roster_updates"
    ADD CONSTRAINT "roster_updates_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roster_updates"
    ADD CONSTRAINT "roster_updates_other_session_id_fkey" FOREIGN KEY ("other_session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roster_updates"
    ADD CONSTRAINT "roster_updates_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rosters"
    ADD CONSTRAINT "rosters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rosters"
    ADD CONSTRAINT "rosters_revision_of_fkey" FOREIGN KEY ("revision_of") REFERENCES "public"."rosters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serve_requests"
    ADD CONSTRAINT "serve_requests_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serve_requests"
    ADD CONSTRAINT "serve_requests_roster_id_fkey" FOREIGN KEY ("roster_id") REFERENCES "public"."rosters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."serve_requests"
    ADD CONSTRAINT "serve_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_records"
    ADD CONSTRAINT "session_records_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."session_records"
    ADD CONSTRAINT "session_records_roster_session_id_fkey" FOREIGN KEY ("roster_session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."session_records"
    ADD CONSTRAINT "session_records_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."song_events"
    ADD CONSTRAINT "song_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."song_events"
    ADD CONSTRAINT "song_events_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."song_issues"
    ADD CONSTRAINT "song_issues_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."song_issues"
    ADD CONSTRAINT "song_issues_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."song_issues"
    ADD CONSTRAINT "song_issues_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."song_key_instruments"
    ADD CONSTRAINT "song_key_instruments_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."song_key_instruments"
    ADD CONSTRAINT "song_key_instruments_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."song_links"
    ADD CONSTRAINT "song_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."song_links"
    ADD CONSTRAINT "song_links_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."song_versions"
    ADD CONSTRAINT "song_versions_key_confirmed_by_fkey" FOREIGN KEY ("key_confirmed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."song_versions"
    ADD CONSTRAINT "song_versions_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."song_versions"
    ADD CONSTRAINT "song_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."songs"
    ADD CONSTRAINT "songs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."songs"
    ADD CONSTRAINT "songs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."swap_proposals"
    ADD CONSTRAINT "swap_proposals_counterpart_id_fkey" FOREIGN KEY ("counterpart_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."swap_proposals"
    ADD CONSTRAINT "swap_proposals_cover_id_fkey" FOREIGN KEY ("cover_id") REFERENCES "public"."cover_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."swap_proposals"
    ADD CONSTRAINT "swap_proposals_offer_session_id_fkey" FOREIGN KEY ("offer_session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."swap_proposals"
    ADD CONSTRAINT "swap_proposals_proposed_by_fkey" FOREIGN KEY ("proposed_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transposed_songsheets"
    ADD CONSTRAINT "transposed_songsheets_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "public"."song_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_groups"
    ADD CONSTRAINT "user_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_groups"
    ADD CONSTRAINT "user_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_permission_overrides"
    ADD CONSTRAINT "user_permission_overrides_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_permission_overrides"
    ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worship_session_items"
    ADD CONSTRAINT "worship_session_items_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."worship_session_items"
    ADD CONSTRAINT "worship_session_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."worship_session_sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worship_session_items"
    ADD CONSTRAINT "worship_session_items_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."worship_session_revision_dismissals"
    ADD CONSTRAINT "worship_session_revision_dismissals_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worship_session_revision_dismissals"
    ADD CONSTRAINT "worship_session_revision_dismissals_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."worship_session_revisions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worship_session_revisions"
    ADD CONSTRAINT "worship_session_revisions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."worship_session_revisions"
    ADD CONSTRAINT "worship_session_revisions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."worship_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worship_session_sections"
    ADD CONSTRAINT "worship_session_sections_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."worship_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worship_sessions"
    ADD CONSTRAINT "worship_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."worship_sessions"
    ADD CONSTRAINT "worship_sessions_draft_updated_by_fkey" FOREIGN KEY ("draft_updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."worship_sessions"
    ADD CONSTRAINT "worship_sessions_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."worship_sessions"
    ADD CONSTRAINT "worship_sessions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."worship_sessions"
    ADD CONSTRAINT "worship_sessions_roster_session_id_fkey" FOREIGN KEY ("roster_session_id") REFERENCES "public"."roster_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."worship_sessions"
    ADD CONSTRAINT "worship_sessions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE "public"."absence_declarations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."absences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."broadcast_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."broadcasts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cover_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drive_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drive_sync_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."handover_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instruments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "read permission catalogue" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."roster_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roster_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roster_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roster_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rosters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."serve_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."song_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."song_issues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."song_key_instruments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."song_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."song_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."songs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."swap_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transposed_songsheets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_permission_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."worship_session_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."worship_session_revision_dismissals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."worship_session_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."worship_session_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."worship_sessions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



















































































































































































































































REVOKE ALL ON FUNCTION "public"."developer_reset_app_data"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."developer_reset_app_data"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."effective_permissions"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."effective_permissions"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_permissions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_permissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_permissions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_worship_session_plan"("p_session_id" "uuid", "p_user_id" "uuid", "p_plan" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_worship_session_plan"("p_session_id" "uuid", "p_user_id" "uuid", "p_plan" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."transfer_root"("p_from" "uuid", "p_to" "uuid", "p_from_group" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_root"("p_from" "uuid", "p_to" "uuid", "p_from_group" "uuid") TO "service_role";

-- Server-only functions. Supabase's default privileges hand every new function to anon and
-- authenticated, and the dump above doesn't take those back, so do it explicitly.
revoke all on function public.developer_reset_app_data() from anon, authenticated;
revoke all on function public.effective_permissions(uuid) from anon, authenticated;
revoke all on function public.my_permissions() from anon;
revoke all on function public.save_worship_session_plan(uuid, uuid, jsonb) from anon, authenticated;
revoke all on function public.transfer_root(uuid, uuid, uuid) from anon, authenticated;


















GRANT ALL ON TABLE "public"."absence_declarations" TO "anon";
GRANT ALL ON TABLE "public"."absence_declarations" TO "authenticated";
GRANT ALL ON TABLE "public"."absence_declarations" TO "service_role";



GRANT ALL ON TABLE "public"."absences" TO "anon";
GRANT ALL ON TABLE "public"."absences" TO "authenticated";
GRANT ALL ON TABLE "public"."absences" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."broadcast_responses" TO "anon";
GRANT ALL ON TABLE "public"."broadcast_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."broadcast_responses" TO "service_role";



GRANT ALL ON TABLE "public"."broadcasts" TO "anon";
GRANT ALL ON TABLE "public"."broadcasts" TO "authenticated";
GRANT ALL ON TABLE "public"."broadcasts" TO "service_role";



GRANT ALL ON TABLE "public"."cover_requests" TO "anon";
GRANT ALL ON TABLE "public"."cover_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."cover_requests" TO "service_role";



GRANT ALL ON TABLE "public"."drive_files" TO "anon";
GRANT ALL ON TABLE "public"."drive_files" TO "authenticated";
GRANT ALL ON TABLE "public"."drive_files" TO "service_role";



GRANT ALL ON TABLE "public"."drive_sync_runs" TO "anon";
GRANT ALL ON TABLE "public"."drive_sync_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."drive_sync_runs" TO "service_role";



GRANT ALL ON TABLE "public"."group_permissions" TO "anon";
GRANT ALL ON TABLE "public"."group_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."group_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."groups" TO "anon";
GRANT ALL ON TABLE "public"."groups" TO "authenticated";
GRANT ALL ON TABLE "public"."groups" TO "service_role";



GRANT ALL ON TABLE "public"."handover_requests" TO "anon";
GRANT ALL ON TABLE "public"."handover_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."handover_requests" TO "service_role";



GRANT ALL ON TABLE "public"."instruments" TO "anon";
GRANT ALL ON TABLE "public"."instruments" TO "authenticated";
GRANT ALL ON TABLE "public"."instruments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."instruments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."instruments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."instruments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."profiles_uid_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."profiles_uid_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."profiles_uid_seq" TO "service_role";



GRANT ALL ON TABLE "public"."roster_assignments" TO "anon";
GRANT ALL ON TABLE "public"."roster_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."roster_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."roster_rules" TO "anon";
GRANT ALL ON TABLE "public"."roster_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."roster_rules" TO "service_role";



GRANT ALL ON TABLE "public"."roster_sessions" TO "anon";
GRANT ALL ON TABLE "public"."roster_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."roster_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."roster_updates" TO "anon";
GRANT ALL ON TABLE "public"."roster_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."roster_updates" TO "service_role";



GRANT ALL ON TABLE "public"."rosters" TO "anon";
GRANT ALL ON TABLE "public"."rosters" TO "authenticated";
GRANT ALL ON TABLE "public"."rosters" TO "service_role";



GRANT ALL ON TABLE "public"."serve_requests" TO "anon";
GRANT ALL ON TABLE "public"."serve_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."serve_requests" TO "service_role";



GRANT ALL ON TABLE "public"."session_records" TO "anon";
GRANT ALL ON TABLE "public"."session_records" TO "authenticated";
GRANT ALL ON TABLE "public"."session_records" TO "service_role";



GRANT ALL ON TABLE "public"."song_events" TO "anon";
GRANT ALL ON TABLE "public"."song_events" TO "authenticated";
GRANT ALL ON TABLE "public"."song_events" TO "service_role";



GRANT ALL ON TABLE "public"."song_issues" TO "anon";
GRANT ALL ON TABLE "public"."song_issues" TO "authenticated";
GRANT ALL ON TABLE "public"."song_issues" TO "service_role";



GRANT ALL ON TABLE "public"."song_key_instruments" TO "anon";
GRANT ALL ON TABLE "public"."song_key_instruments" TO "authenticated";
GRANT ALL ON TABLE "public"."song_key_instruments" TO "service_role";



GRANT ALL ON TABLE "public"."song_links" TO "anon";
GRANT ALL ON TABLE "public"."song_links" TO "authenticated";
GRANT ALL ON TABLE "public"."song_links" TO "service_role";



GRANT ALL ON TABLE "public"."song_versions" TO "anon";
GRANT ALL ON TABLE "public"."song_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."song_versions" TO "service_role";



GRANT ALL ON TABLE "public"."songs" TO "anon";
GRANT ALL ON TABLE "public"."songs" TO "authenticated";
GRANT ALL ON TABLE "public"."songs" TO "service_role";



GRANT ALL ON TABLE "public"."swap_proposals" TO "anon";
GRANT ALL ON TABLE "public"."swap_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."swap_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."transposed_songsheets" TO "anon";
GRANT ALL ON TABLE "public"."transposed_songsheets" TO "authenticated";
GRANT ALL ON TABLE "public"."transposed_songsheets" TO "service_role";



GRANT ALL ON TABLE "public"."user_groups" TO "anon";
GRANT ALL ON TABLE "public"."user_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."user_groups" TO "service_role";



GRANT ALL ON TABLE "public"."user_permission_overrides" TO "anon";
GRANT ALL ON TABLE "public"."user_permission_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."user_permission_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."worship_session_items" TO "anon";
GRANT ALL ON TABLE "public"."worship_session_items" TO "authenticated";
GRANT ALL ON TABLE "public"."worship_session_items" TO "service_role";



GRANT ALL ON TABLE "public"."worship_session_revision_dismissals" TO "anon";
GRANT ALL ON TABLE "public"."worship_session_revision_dismissals" TO "authenticated";
GRANT ALL ON TABLE "public"."worship_session_revision_dismissals" TO "service_role";



GRANT ALL ON TABLE "public"."worship_session_revisions" TO "anon";
GRANT ALL ON TABLE "public"."worship_session_revisions" TO "authenticated";
GRANT ALL ON TABLE "public"."worship_session_revisions" TO "service_role";



GRANT ALL ON TABLE "public"."worship_session_sections" TO "anon";
GRANT ALL ON TABLE "public"."worship_session_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."worship_session_sections" TO "service_role";



GRANT ALL ON TABLE "public"."worship_sessions" TO "anon";
GRANT ALL ON TABLE "public"."worship_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."worship_sessions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































-- -----------------------------------------------------------------------------
-- 2. Create a profile automatically whenever an auth user is created
--    (lives on auth.users, so the schema dump above doesn't include it)
-- -----------------------------------------------------------------------------
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 3. Starting data
-- -----------------------------------------------------------------------------
insert into public.groups (name, description) values
  ('admin',  'Can view, edit, review and upload songsheets and songs'),
  ('member', 'Can view songs and use the transposer');

insert into public.permissions (key, category, description) values
  ('groups.manage', 'Accounts', 'Create and edit security groups and their default permissions'),
  ('users.manage', 'Accounts', 'Create, deactivate and edit users, their groups and overrides'),
  ('users.view', 'Accounts', 'See the list of users and their access'),
  ('roster.edit', 'Roster', 'Plan, generate and publish rosters; manage roster rules'),
  ('roster.view', 'Roster', 'See the roster'),
  ('sessions.manage', 'Sessions', 'Create sessions and send session emails'),
  ('sessions.view', 'Sessions', 'See session plans'),
  ('songs.create', 'Songs', 'Upload new songsheets'),
  ('songs.delete', 'Songs', 'Delete songs and songsheet versions'),
  ('songs.edit', 'Songs', 'Edit song details (type, sections, sequence, theme, language, instruments)'),
  ('songs.edit_links', 'Songs', 'Add, rename and remove reference YouTube links'),
  ('songs.issue_reports', 'Songs', 'Get told when someone raises an issue with a song or songsheet'),
  ('songs.library_updates', 'Songs', 'Get song library updates: new songs, re-uploaded songsheets and scanner issues'),
  ('songs.transpose', 'Songs', 'Generate transposed songsheets'),
  ('songs.view', 'Songs', 'Browse the song library and download songsheets'),
  ('team.view', 'Team', 'See the team directory');

insert into public.group_permissions (group_id, permission_key)
select g.id, v.permission_key
from (values
  ('admin', 'roster.edit'),
  ('admin', 'roster.view'),
  ('admin', 'songs.create'),
  ('admin', 'songs.delete'),
  ('admin', 'songs.edit'),
  ('admin', 'songs.edit_links'),
  ('admin', 'songs.issue_reports'),
  ('admin', 'songs.library_updates'),
  ('admin', 'songs.transpose'),
  ('admin', 'songs.view'),
  ('admin', 'team.view'),
  ('member', 'roster.view'),
  ('member', 'songs.transpose'),
  ('member', 'songs.view'),
  ('member', 'team.view')
) as v (group_name, permission_key)
join public.groups g on g.name = v.group_name;

insert into public.instruments (id, name, position) overriding system value values
  (3, 'Keys',            1),
  (5, 'Synth/Pads',      2),
  (7, 'Electric Guitar', 3),
  (6, 'Acoustic Guitar', 4),
  (9, 'Drums',           5),
  (8, 'Bass',            6);
select setval(pg_get_serial_sequence('public.instruments', 'id'), 21);

-- The permanent, roster-wide rules every roster starts with.
insert into public.roster_rules (template, params, hard, weight, enabled, permanent) values
  ('fairness',       '{}', false, 0.5, true, true),
  ('spacing',        '{}', false, 0.5, true, true),
  ('variety',        '{}', false, 0.5, true, true),
  ('singer_balance', '{}', false, 0.5, true, true),
  ('bl_backup',      '{}', false, 0.5, true, true);

-- -----------------------------------------------------------------------------
-- 4. Private bucket for songsheet files, plus their PDF/PNG previews
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'songsheets', 'songsheets', false, 10485760,
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
    'application/pdf',
    'image/png'
  ]
)
on conflict (id) do nothing;
