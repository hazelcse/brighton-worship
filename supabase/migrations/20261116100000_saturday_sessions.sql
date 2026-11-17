-- Youth Worship's regular session: one "Saturday Service" every Saturday (no EM/CM split, no
-- Prayer & Praise). Roster sessions may now be of kind 'saturday'.
alter table public.roster_sessions drop constraint roster_sessions_kind_check;
alter table public.roster_sessions add constraint roster_sessions_kind_check
  check (kind = any (array['em_sunday', 'cm_sunday', 'em_pnp', 'cm_pnp', 'saturday', 'custom']));
