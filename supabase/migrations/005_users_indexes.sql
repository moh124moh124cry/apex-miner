create index if not exists idx_users_referred_by
  on public.users (referred_by);

create index if not exists idx_users_referred_by_last_claim
  on public.users (referred_by, last_claim desc)
  where referred_by is not null;
