-- Youth Worship's musicians get personal rules too (parts someone plays but shouldn't be rostered
-- for), like Main Worship's. The roster worker and the app read this from the team's config.
update public.teams set config = jsonb_set(config, '{memberFields,rules}', 'true'::jsonb, true)
where slug = 'youth-worship';
