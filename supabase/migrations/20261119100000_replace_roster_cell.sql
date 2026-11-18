-- A hand edit of one roster cell (one part of one session) in a single transaction: who was in it
-- goes, who's picked goes in, and any band leader / talkback handed to a bandmate moves with it.
-- Before, these were separate requests, so a failure part-way (e.g. after the delete) left the
-- cell empty. The web app checks the edit first (editCell); this only writes it.
--   p_rows:     [{ "member_id": uuid, "also_roles": [text] }]  the cell's new line-up
--   p_handover: [{ "member_id": uuid, "role": text, "also_roles": [text] }]  bandmates' new also_roles
create or replace function public.replace_roster_cell(p_session_id uuid, p_role text, p_rows jsonb, p_handover jsonb default '[]'::jsonb)
  returns void
  language plpgsql
  set search_path to ''
as $$
begin
  delete from public.roster_assignments where session_id = p_session_id and role = p_role;

  insert into public.roster_assignments (session_id, member_id, role, also_roles)
  select p_session_id,
         (r ->> 'member_id')::uuid,
         p_role,
         coalesce(array(select jsonb_array_elements_text(coalesce(r -> 'also_roles', '[]'::jsonb))), '{}')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  update public.roster_assignments a
  set also_roles = coalesce(array(select jsonb_array_elements_text(coalesce(h -> 'also_roles', '[]'::jsonb))), '{}')
  from jsonb_array_elements(coalesce(p_handover, '[]'::jsonb)) h
  where a.session_id = p_session_id
    and a.member_id = (h ->> 'member_id')::uuid
    and a.role = h ->> 'role';
end;
$$;

-- Server only (the service-role key), like the other write functions.
revoke all on function public.replace_roster_cell(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_roster_cell(uuid, text, jsonb, jsonb) to service_role;
