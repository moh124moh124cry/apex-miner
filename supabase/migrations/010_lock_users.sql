begin;

alter table public.users enable row level security;

drop policy if exists "ApexPolicy" on public.users;
drop policy if exists "ApexUsersReadOnly" on public.users;

revoke all privileges
on table public.users
from anon, authenticated;

revoke all privileges
on table public.users
from public;

grant select, insert, update, delete
on table public.users
to service_role;

commit;
