-- Main Media's regular sessions: EM Sunday Service and EM Prayer & Praise, each with Main Media's
-- own crew instead of the catalogue's band (teams.config.compositions; see PRESETS in
-- web/src/lib/team-config.ts). New Main Media rosters start with every one of these in the quarter.
--   EM Sunday: 1 Media IC, 1 director, 1 video mixer, 2 roving cams, 1 wide angle cam, 1 close up
--              cam, 1 projectionist, 1 lights.
--   EM PnP:    1 projectionist, 1 lights.
update public.teams
set config = config || jsonb_build_object(
  'sessionKinds', jsonb_build_array('em_sunday', 'em_pnp'),
  'compositions', jsonb_build_object(
    'em_sunday', jsonb_build_object(
      'media ic', 1, 'director', 1, 'video mixer', 1, 'roving cam', 2,
      'wide angle cam', 1, 'close up cam', 1, 'projectionist', 1, 'lights', 1),
    'em_pnp', jsonb_build_object('projectionist', 1, 'lights', 1)))
where slug = 'main-media';
