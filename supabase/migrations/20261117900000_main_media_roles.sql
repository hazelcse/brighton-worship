-- Main Media's roles: Media IC, and three cameras (wide angle, close up, roving) in place of the
-- stage and back cameras. See ROLE_CATALOGUE and PRESETS in web/src/lib/team-config.ts.
--
-- 'stage camera' and 'back camera' stay allowed in team_members.instruments so members who still
-- have them keep a valid row; Main Media no longer offers them, so their forms don't show them.

alter table public.team_members drop constraint team_members_instruments_valid;
alter table public.team_members add constraint team_members_instruments_valid check (instruments <@ array[
  'keys', 'synth/pads', 'electric guitar', 'acoustic guitar', 'bass', 'drums', 'worship leader', 'vocalist', 'band leader',
  'media ic', 'wide angle cam', 'close up cam', 'roving cam',
  'stage camera', 'back camera',
  'director', 'video mixer', 'projectionist', 'lights', 'soundboard'
]::text[]);

update public.teams
set config = config || '{"roles": ["media ic", "wide angle cam", "roving cam", "close up cam", "director", "video mixer", "projectionist", "lights"]}'::jsonb
where slug = 'main-media';
