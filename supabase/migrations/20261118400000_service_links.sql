-- Ad hoc services shared between teams. A service is one event that several teams serve at
-- (e.g. a worship band and session plus a media crew). Standard services (EM/CM Sunday, EM/CM PnP,
-- YF Saturday) are the same service on every team just by their kind and date, so they need nothing
-- stored. Ad hoc ones (kind 'custom') are linked by hand by a team's lead: every team's session for
-- that event shares one link_id. Only teams of the same group link, one session per team, all on
-- the same date, and they share the name of whichever team's session was made first.
-- A link with only one session left in it (the others deleted or unlinked) means "not linked".
alter table public.roster_sessions add column link_id uuid;
create index roster_sessions_link_idx on public.roster_sessions (link_id) where link_id is not null;
