-- Broadcasts belong to a team, like rosters: the lead sends one to their own team, and only that
-- team's members see it (and are counted for acknowledgements). Existing ones were all sent by Main
-- Worship.
alter table public.broadcasts add column team_id uuid references public.teams (id) on delete cascade;
update public.broadcasts set team_id = (select id from public.teams where slug = 'main-worship') where team_id is null;
alter table public.broadcasts alter column team_id set not null;
create index broadcasts_team_idx on public.broadcasts (team_id);
