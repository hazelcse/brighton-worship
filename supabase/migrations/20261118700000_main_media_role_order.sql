-- Main Media's roles in the order the team uses them (forms, roster columns, crew lists).
-- Same as PRESETS in web/src/lib/team-config.ts.
update public.teams
set config = config || '{"roles": ["media ic", "director", "video mixer", "close up cam", "wide angle cam", "roving cam", "projectionist", "lights"]}'::jsonb
where slug = 'main-media';
