-- Main Media's permanent rules, like the worship teams' (they got theirs in 20261116000000_teams.sql;
-- the media teams got none, so their rosters didn't space people out or mix who serves together):
--   fairness 0.9 (share the load fairly; nobody on a reduced share yet),
--   spacing 0.5 (spread each person's services out),
--   variety 0.5 (mix up who serves together).
-- The band-only ones (singer balance, band leader backup) aren't for a crew.
insert into public.roster_rules (team_id, template, params, hard, weight, enabled, permanent)
select t.id, r.template, '{}'::jsonb, false, r.weight, true, true
from public.teams t
cross join (values ('fairness', 0.9), ('spacing', 0.5), ('variety', 0.5)) as r(template, weight)
where t.slug = 'main-media'
  and not exists (
    select 1 from public.roster_rules x where x.team_id = t.id and x.template = r.template and x.roster_id is null
  );
