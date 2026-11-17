-- One observer per group (Main, Youth) instead of one in all. Whether an observer may manage its
-- teams' permissions (groups, everyone's access, denying the lead, transferring the lead) is set by
-- root when creating it: on for the Youth observer, off for Main's.
drop index public.profiles_single_observer;
create unique index profiles_single_observer on public.profiles (observer_group) where observer_group is not null;

alter table public.profiles add column observer_manages_permissions boolean not null default false;

-- The Youth observer created before this change keeps managing its teams' permissions.
update public.profiles set observer_manages_permissions = true where observer_group = 'youth';
