-- Root hears when a team lead adds someone to their team or removes them (kinds member_added /
-- member_removed). These are about a team, not a session: team_id says which, detail holds the
-- person's name (their profile may be gone by the time root reads it).
alter table public.roster_updates add column team_id uuid references public.teams(id) on delete cascade;

alter table public.roster_updates drop constraint roster_updates_kind_check;
alter table public.roster_updates add constraint roster_updates_kind_check check (kind = any (array[
  'declined', 'asked', 'posted', 'taken', 'refused', 'cancelled', 'swap_proposed', 'swap_declined', 'swapped',
  'band_role_asked', 'band_role_taken', 'band_role_refused', 'band_role_missing', 'session_updated',
  'roster_added', 'roster_removed', 'roster_part_changed', 'roster_session_changed', 'roster_band_changed',
  'member_added', 'member_removed'
]));

create index roster_updates_member_notices_idx on public.roster_updates (created_at desc) where kind in ('member_added', 'member_removed');
