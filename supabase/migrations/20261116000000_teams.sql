-- Teams. One login can belong to several teams (Brighton Worship, Brighton Media, ...). People pick
-- the team on the login page and see only that team's interface.
--
-- * Each team has a lead (what used to be "root"). The lead can do everything the team is allowed
--   to do, and hands out permissions to the team's members through the team's permission groups.
-- * The root account is now app-wide, like a developer: every permission in every team. Root
--   creates teams (worship or media kind) and sets each team's maximum permissions.
-- * Permission groups, personal allows/denies, rosters and roster rules belong to a team.
--   Absences stay personal: one absence counts for every team someone is on.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]*$'),
  name text not null unique,
  -- Which interface the team gets: the worship app, or the media app.
  kind text not null check (kind in ('worship', 'media')),
  -- The most anyone in the team can do, its lead included: null means every permission.
  permission_ceiling text[],
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.teams enable row level security;
-- The login page lists the teams before anyone signs in.
create policy "anyone can list teams" on public.teams for select to anon, authenticated using (true);

-- The login page shows one title per kind ("Brighton Worship", "Brighton Media"); logging in opens
-- the team of that kind the person is on.
insert into public.teams (slug, name, kind, position, permission_ceiling) values
  ('main-worship', 'Main Worship', 'worship', 0, null),
  -- Youth plans its own rosters and sessions and reads the song library, but can't change it.
  ('youth-worship', 'Youth Worship', 'worship', 1,
   array['users.view', 'users.manage', 'groups.manage', 'songs.view', 'songs.transpose', 'songs.library_updates',
         'songs.issue_reports', 'roster.view', 'roster.edit', 'team.view', 'sessions.view', 'sessions.manage']),
  -- Media rosters its own people and reads the worship team's sessions; no song library changes.
  ('main-media', 'Main Media', 'media', 2,
   array['users.view', 'users.manage', 'groups.manage', 'roster.view', 'roster.edit', 'team.view', 'sessions.view', 'songs.view']),
  ('youth-media', 'Youth Media', 'media', 3,
   array['users.view', 'users.manage', 'groups.manage', 'roster.view', 'roster.edit', 'team.view', 'sessions.view', 'songs.view']);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_lead boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
alter table public.team_members enable row level security;
create policy "read own memberships" on public.team_members for select to authenticated using (user_id = auth.uid());
create unique index team_members_one_lead on public.team_members (team_id) where is_lead;
create index team_members_user_idx on public.team_members (user_id);

-- Everyone on the app today is on the worship team; today's root becomes its lead.
insert into public.team_members (team_id, user_id, is_lead)
select t.id, p.id, p.is_root
from public.profiles p, public.teams t
where t.slug = 'main-worship' and not p.is_developer;

-- profiles.is_root now means the one app-wide root account (set with `npm run create-root`).
update public.profiles set is_root = false where is_root;

-- Root sits above every team and is never a member of one (nor a lead).
create or replace function public.root_is_on_no_team() returns trigger
  language plpgsql
  set search_path to ''
as $$
begin
  if tg_table_name = 'team_members' then
    if exists (select 1 from public.profiles where id = new.user_id and is_root) then
      raise exception 'The root account can''t be on a team.';
    end if;
  elsif new.is_root and exists (select 1 from public.team_members where user_id = new.id) then
    raise exception 'This account is on a team, so it can''t be root. Use an account that isn''t on any team.';
  end if;
  return new;
end;
$$;
create trigger team_members_not_root before insert or update on public.team_members
  for each row execute function public.root_is_on_no_team();
create trigger profiles_root_on_no_team before insert or update of is_root on public.profiles
  for each row when (new.is_root) execute function public.root_is_on_no_team();

-- Permission groups belong to a team (each team names its own).
alter table public.groups add column team_id uuid references public.teams (id) on delete cascade;
update public.groups set team_id = (select id from public.teams where slug = 'main-worship');
alter table public.groups alter column team_id set not null;
alter table public.groups drop constraint groups_name_key;
alter table public.groups add constraint groups_team_name_key unique (team_id, name);
-- The other teams start empty, with a "member" group for their lead to fill in.
insert into public.groups (team_id, name, description)
select id, 'member', 'Everyone on the team' from public.teams where slug <> 'main-worship';

-- A person's own allows and denies are per team too.
alter table public.user_permission_overrides add column team_id uuid references public.teams (id) on delete cascade;
update public.user_permission_overrides set team_id = (select id from public.teams where slug = 'main-worship');
alter table public.user_permission_overrides alter column team_id set not null;
alter table public.user_permission_overrides drop constraint user_permission_overrides_pkey;
alter table public.user_permission_overrides add primary key (team_id, user_id, permission_key);

-- Rosters and their rules belong to a team. Each team has its own drafts, published rosters and
-- default rule library.
alter table public.rosters add column team_id uuid references public.teams (id) on delete cascade;
update public.rosters set team_id = (select id from public.teams where slug = 'main-worship');
alter table public.rosters alter column team_id set not null;
create index rosters_team_idx on public.rosters (team_id);
drop index public.rosters_one_draft_per_quarter;
drop index public.rosters_one_published_per_quarter;
create unique index rosters_one_draft_per_quarter on public.rosters (team_id, starts_on) where status = 'draft';
create unique index rosters_one_published_per_quarter on public.rosters (team_id, starts_on) where status = 'published';

alter table public.roster_rules add column team_id uuid references public.teams (id) on delete cascade;
update public.roster_rules set team_id = (select id from public.teams where slug = 'main-worship');
alter table public.roster_rules alter column team_id set not null;
create index roster_rules_team_idx on public.roster_rules (team_id);
drop index public.roster_rules_one_bl_backup;
drop index public.roster_rules_one_fairness;
drop index public.roster_rules_one_singer_balance;
drop index public.roster_rules_one_spacing;
drop index public.roster_rules_one_variety;
create unique index roster_rules_one_bl_backup on public.roster_rules (team_id) where template = 'bl_backup';
create unique index roster_rules_one_fairness on public.roster_rules (team_id) where template = 'fairness';
create unique index roster_rules_one_singer_balance on public.roster_rules (team_id) where template = 'singer_balance';
create unique index roster_rules_one_spacing on public.roster_rules (team_id) where template = 'spacing';
create unique index roster_rules_one_variety on public.roster_rules (team_id) where template = 'variety';
-- Youth Worship rosters the same kind of band, so it starts with its own copy of the permanent rules.
insert into public.roster_rules (team_id, template, params, hard, weight, enabled, permanent)
select (select id from public.teams where slug = 'youth-worship'), template, params, hard, weight, enabled, permanent
from public.roster_rules
where permanent and roster_id is null and team_id = (select id from public.teams where slug = 'main-worship');

-- Permissions within one team. Root, developers and the team's lead get everything; others get
-- their groups' permissions in that team plus their own allows, minus their denies. Either way,
-- never more than the team's ceiling.
create or replace function public.team_permissions(p_user_id uuid, p_team_id uuid) returns setof text
  language sql stable security definer
  set search_path to ''
as $$
  with me as (
    select pr.is_active,
           pr.is_developer or pr.is_root or coalesce(tm.is_lead, false) as is_all,
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
    and (me.is_all or not exists (
      select 1 from public.user_permission_overrides d
      where d.user_id = p_user_id and d.team_id = p_team_id and d.permission_key = g.key and d.effect = 'deny'
    ));
$$;

create or replace function public.my_team_permissions(p_team_id uuid) returns setof text
  language sql stable security definer
  set search_path to ''
as $$
  select public.team_permissions(auth.uid(), p_team_id);
$$;

drop function public.my_permissions();
drop function public.effective_permissions(uuid);

-- Hand a team's lead to another member of that team. The old lead can join one of the team's
-- groups. Called by the lead, root or a developer (checked in the app).
drop function public.transfer_root(uuid, uuid, uuid);
create or replace function public.transfer_lead(p_team uuid, p_to uuid, p_from_group uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_from uuid;
begin
  select user_id into v_from from public.team_members where team_id = p_team and is_lead;
  if v_from = p_to then
    raise exception 'They''re already the lead.';
  end if;
  if not exists (
    select 1 from public.team_members tm join public.profiles p on p.id = tm.user_id
    where tm.team_id = p_team and tm.user_id = p_to and p.is_active
  ) then
    raise exception 'The new lead must be an active member of this team.';
  end if;
  if p_from_group is not null and not exists (select 1 from public.groups where id = p_from_group and team_id = p_team) then
    raise exception 'That permission group doesn''t exist.';
  end if;

  update public.team_members set is_lead = false where team_id = p_team and is_lead;
  update public.team_members set is_lead = true where team_id = p_team and user_id = p_to;

  if v_from is not null and p_from_group is not null then
    insert into public.user_groups (user_id, group_id) values (v_from, p_from_group)
    on conflict do nothing;
  end if;
end;
$$;
