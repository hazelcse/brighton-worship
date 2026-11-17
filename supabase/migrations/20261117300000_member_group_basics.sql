-- The other teams' "member" groups started empty, so their members couldn't see the roster, the
-- team directory or the song library. Give them the basics, like Main Worship's member group (each
-- within its team's maximum permissions):
--   Youth Worship: see the roster, the team directory and the song library; transpose songsheets.
--   Main / Youth Media: see the roster and the team directory.
insert into public.group_permissions (group_id, permission_key)
select g.id, p.key
from public.groups g
join public.teams t on t.id = g.team_id
join (values
  ('youth-worship', 'roster.view'), ('youth-worship', 'team.view'), ('youth-worship', 'songs.view'), ('youth-worship', 'songs.transpose'),
  ('main-media', 'roster.view'), ('main-media', 'team.view'),
  ('youth-media', 'roster.view'), ('youth-media', 'team.view')
) as p(slug, key) on p.slug = t.slug
where g.name = 'member'
on conflict do nothing;

-- Everyone on a team should be in at least one of its groups: anyone in none joins its "member" group.
insert into public.user_groups (user_id, group_id)
select tm.user_id, g.id
from public.team_members tm
join public.groups g on g.team_id = tm.team_id and g.name = 'member'
where not exists (
  select 1 from public.user_groups ug join public.groups g2 on g2.id = ug.group_id
  where ug.user_id = tm.user_id and g2.team_id = tm.team_id
)
on conflict do nothing;
