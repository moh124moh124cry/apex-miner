alter table public.app_settings enable row level security;

revoke all
on table public.app_settings
from anon, authenticated;
