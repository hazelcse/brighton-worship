-- Main Media gets personal rules too (roles someone can serve but shouldn't be rostered for), like
-- Main and Youth Worship. The roster worker and the app read this from the team's config.
update public.teams set config = jsonb_set(config, '{memberFields,rules}', 'true'::jsonb, true)
where slug = 'main-media';
