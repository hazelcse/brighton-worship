-- A worship leader can attach their own songsheet (PDF or .docx) to a song in a session instead
-- of picking one from the song bank. The file stays with the session only (it isn't added to the
-- library): stored in the songsheets bucket under session-uploads/<session id>/<sheet id>.pdf
-- (a .docx is converted to PDF when it's attached), and removed once no plan, revision or open
-- edit of the session uses it any more, and 30 days after the session's date (by the website,
-- in the background of ordinary requests: web/src/lib/session-uploads.ts).
--
-- `sheet` is {id, file_name, format: "pdf" | "docx", sections?: [...], sequence?: [...]}; the
-- sections and sequence are what the scanner read from a .docx, offered in the sequence builder.
ALTER TABLE "public"."worship_session_items" ADD COLUMN IF NOT EXISTS "sheet" "jsonb";

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
        (id, section_id, position, kind, song_id, lead_id, title, type, bpm, key, transpose_to, artist, sequence, custom_elements, links, notes, sheet)
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
        coalesce(itm->>'notes', ''),
        case when jsonb_typeof(itm->'sheet') = 'object' then itm->'sheet' end
      );
      ii := ii + 1;
    end loop;
    si := si + 1;
  end loop;
  update worship_sessions set updated_at = now(), updated_by = p_user_id where id = p_session_id;
end;
$$;
