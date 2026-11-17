-- The observer: one read-only account (created by root on the Teams page) that oversees one group's
-- teams, e.g. Youth Worship and Youth Media, without being on them. Like root, it's on no team, so
-- it is never counted, rostered or listed in a team's directory (root still sees it there). It sees
-- the group's published sessions, directories, rosters and absences, can't add absences, and manages
-- the permissions of everyone on those teams (their leads too) and can transfer each team's lead.
alter table public.profiles add column observer_group text
  constraint profiles_observer_group_valid check (observer_group in ('main', 'youth'));

-- Only one observer account at a time (whichever group it observes).
create unique index profiles_single_observer on public.profiles ((true)) where observer_group is not null;

-- Observers sit outside every team, like root.
create or replace function public.observer_is_on_no_team() returns trigger
  language plpgsql
  set search_path to ''
as $$
begin
  if tg_table_name = 'team_members' then
    if exists (select 1 from public.profiles where id = new.user_id and observer_group is not null) then
      raise exception 'The observer account can''t be on a team.';
    end if;
  elsif new.observer_group is not null and exists (select 1 from public.team_members where user_id = new.id) then
    raise exception 'This account is on a team, so it can''t be the observer. Use an account that isn''t on any team.';
  end if;
  return new;
end;
$$;
create trigger team_members_not_observer before insert or update on public.team_members
  for each row execute function public.observer_is_on_no_team();
create trigger profiles_observer_on_no_team before insert or update of observer_group on public.profiles
  for each row when (new.observer_group is not null) execute function public.observer_is_on_no_team();

-- A lead still gets everything the team may do, but a "deny" set on them (by the observer, or root)
-- now takes that permission away. Root and developers still can't be denied anything.
create or replace function public.team_permissions(p_user_id uuid, p_team_id uuid) returns setof text
  language sql stable security definer
  set search_path to ''
as $$
  with me as (
    select pr.is_active,
           pr.is_developer or pr.is_root or coalesce(tm.is_lead, false) as is_all,
           pr.is_developer or pr.is_root as is_super,
           tm.user_id is not null or pr.is_developer or pr.is_root as is_member
    from public.profiles pr
    left join public.team_members tm on tm.user_id = pr.id and tm.team_id = p_team_id
    where pr.id = p_user_id
  ),
  ceiling as (select permission_ceiling as keys from public.teams where id = p_team_id),
  granted as (
    select p.key from public.permissions p, me where me.is_all
    union
    select gp.permission_key
    from public.user_groups ug
    join public.groups g on g.id = ug.group_id and g.team_id = p_team_id
    join public.group_permissions gp on gp.group_id = ug.group_id, me
    where ug.user_id = p_user_id and not me.is_all
    union
    select o.permission_key
    from public.user_permission_overrides o, me
    where o.user_id = p_user_id and o.team_id = p_team_id and o.effect = 'allow' and not me.is_all
  )
  select g.key
  from granted g, me, ceiling c
  where me.is_active and me.is_member
    and (c.keys is null or g.key = any (c.keys))
    and (me.is_super or not exists (
      select 1 from public.user_permission_overrides d
      where d.user_id = p_user_id and d.team_id = p_team_id and d.permission_key = g.key and d.effect = 'deny'
    ));
$$;
