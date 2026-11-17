-- Teams are organised as two groups, Main and Youth, each with a worship team and a media team.
-- Each team keeps its own configuration (see web/src/lib/team-config.ts for what it holds and
-- the presets new teams start from). The app and the roster worker both read it from here.
alter table public.teams add column team_group text not null default 'main' check (team_group in ('main', 'youth'));
alter table public.teams add column config jsonb not null default '{}'::jsonb;

update public.teams set team_group = 'youth' where slug in ('youth-worship', 'youth-media');

-- Main Worship: EM and CM Sunday services and Prayer & Praise; members have an EM/CM share and
-- choose Sunday services and/or P&P.
update public.teams set config = '{
  "sessionKinds": ["em_sunday", "cm_sunday", "em_pnp", "cm_pnp"],
  "memberFields": {"ministry": true, "serves": true}
}'::jsonb where slug = 'main-worship';

-- Youth Worship: one Saturday Service every Saturday; no EM/CM split, no P&P.
update public.teams set config = '{
  "sessionKinds": ["saturday"],
  "memberFields": {"ministry": false, "serves": false}
}'::jsonb where slug = 'youth-worship';

-- Media teams: no regular sessions of their own yet; they follow their group's worship team.
update public.teams set config = '{
  "sessionKinds": [],
  "memberFields": {"ministry": false, "serves": false},
  "sessionsFrom": "main-worship"
}'::jsonb where slug = 'main-media';
update public.teams set config = '{
  "sessionKinds": [],
  "memberFields": {"ministry": false, "serves": false},
  "sessionsFrom": "youth-worship"
}'::jsonb where slug = 'youth-media';

-- Tracking records belong to a team, like rosters: from their roster session's roster where they
-- have one, otherwise (imported or added by hand) Main Worship's, which kept them all until now.
alter table public.session_records add column team_id uuid references public.teams (id) on delete cascade;
update public.session_records r set team_id = ro.team_id
  from public.roster_sessions s join public.rosters ro on ro.id = s.roster_id
  where s.id = r.roster_session_id;
update public.session_records set team_id = (select id from public.teams where slug = 'main-worship') where team_id is null;
alter table public.session_records alter column team_id set not null;
create index session_records_team_idx on public.session_records (team_id);
