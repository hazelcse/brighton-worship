-- A team's lead hears (in their inbox) when another team's lead links an ad hoc service to one of
-- their sessions, or unlinks it (by hand, by moving it to another day, or by deleting it). The
-- update is about the lead's own session (session_id); team_id is their team, detail names the
-- other team's session ("Main Media's Baptism"), reason says how it left ("deleted", "moved").
alter table public.roster_updates drop constraint roster_updates_kind_check;
alter table public.roster_updates add constraint roster_updates_kind_check check (kind = any (array[
  'declined', 'asked', 'posted', 'taken', 'refused', 'cancelled', 'swap_proposed', 'swap_declined', 'swapped',
  'band_role_asked', 'band_role_taken', 'band_role_refused', 'band_role_missing', 'session_updated',
  'roster_added', 'roster_removed', 'roster_part_changed', 'roster_session_changed', 'roster_band_changed',
  'member_added', 'member_removed', 'service_linked', 'service_unlinked'
]));

create index roster_updates_link_notices_idx on public.roster_updates (team_id, created_at desc) where kind in ('service_linked', 'service_unlinked');
