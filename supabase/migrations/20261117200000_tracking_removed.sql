-- Deleting a tracked session removes it from tracking for good. Until now, deleting one that came
-- from a roster sent it back to Pending (anything past without a tracking record is pending); this
-- marks its roster session so it stays out of Pending too.
alter table public.roster_sessions add column tracking_removed boolean not null default false;
