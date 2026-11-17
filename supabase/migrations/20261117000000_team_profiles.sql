-- Team profiles. Someone on two teams (e.g. Main Worship and Youth Worship) has one login and one
-- person (name, email, gender, on profiles), but a separate profile on each team: what they play
-- or do there, their EM/CM share, which services they serve at, and their personal rule. These
-- move from profiles (shared by every team) to team_members (one row per person per team), so
-- Abigail can be worship leader and vocalist on Main Worship but only worship leader on Youth.
--
-- "instruments" holds a worship team's instruments or a media team's roles. Which ones a team
-- offers is in its config ("roles"; see web/src/lib/team-config.ts).

alter table public.team_members
  add column instruments text[] not null default '{}',
  add column no_roster_roles text[] not null default '{}',
  add column em_percent smallint check (em_percent between 0 and 100),
  add column serves text not null default 'both' check (serves in ('both', 'sunday', 'pnp'));

-- Everyone keeps what they had, on every team they're on today.
update public.team_members tm
set instruments = p.instruments, no_roster_roles = p.no_roster_roles, em_percent = p.em_percent, serves = p.serves
from public.profiles p
where p.id = tm.user_id;

-- Every role any team can offer: the worship band's instruments and the media teams' roles.
alter table public.team_members add constraint team_members_instruments_valid check (instruments <@ array[
  'keys', 'synth/pads', 'electric guitar', 'acoustic guitar', 'bass', 'drums', 'worship leader', 'vocalist', 'band leader',
  'stage camera', 'back camera', 'director', 'video mixer', 'projectionist', 'lights', 'soundboard'
]::text[]);

alter table public.profiles
  drop column instruments,
  drop column no_roster_roles,
  drop column em_percent,
  drop column serves;

-- The roles each team offers on its member form.
update public.teams set config = config || '{"roles": ["keys", "synth/pads", "electric guitar", "acoustic guitar", "bass", "drums", "worship leader", "vocalist", "band leader"]}'::jsonb
where slug in ('main-worship', 'youth-worship');
update public.teams set config = config || '{"roles": ["stage camera", "back camera", "director", "video mixer", "projectionist", "lights"]}'::jsonb
where slug = 'main-media';
update public.teams set config = config || '{"roles": ["projectionist", "soundboard"]}'::jsonb
where slug = 'youth-media';

-- Personal rules (parts someone plays but shouldn't be rostered for) are a Main Worship setting.
update public.teams set config = jsonb_set(config, '{memberFields,rules}', to_jsonb(slug = 'main-worship'), true);
