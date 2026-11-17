-- "See session plans" now does something: it opens every published session plan in the team, not
-- only the sessions someone serves at. Say so in Manage permissions.
update public.permissions
set description = 'See every published session plan in the team, not just the sessions they serve at'
where key = 'sessions.view';
