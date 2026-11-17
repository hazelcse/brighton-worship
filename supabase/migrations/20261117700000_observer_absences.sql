-- Whether an observer sees everyone's absences on its group's teams (set by root when creating it).
-- Without it, its Absences page shows only the services and rehearsals. On for the Youth observer,
-- off for Main's.
alter table public.profiles add column observer_sees_absences boolean not null default false;
update public.profiles set observer_sees_absences = true where observer_group = 'youth';
