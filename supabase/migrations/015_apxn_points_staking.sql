-- APXN POINTS Staking (off-chain points loyalty feature)
-- 20,000 minimum balance to START each cycle; 10,000 shown as a fixed
-- notional amount. The user's 10,000 POINTS are NEVER deducted or locked.
-- One +1,000 point claim after 24 real hours; manual activation starts next cycle.
-- All state transitions are atomic, using a user row lock.

create table if not exists public.apxn_staking_cycles (
  telegram_id text primary key references public.users(telegram_id) on delete cascade,
  cycle_number integer not null default 1 check (cycle_number >= 1),
  fixed_amount numeric not null default 10000 check (fixed_amount = 10000),
  status text not null default 'active' check (status in ('active', 'claimed')),
  started_at timestamptz not null,
  ends_at timestamptz not null,
  claimed_at timestamptz,
  total_claimed numeric not null default 0 check (total_claimed >= 0),
  updated_at timestamptz not null default now(),
  constraint apxn_staking_times_valid check (ends_at = started_at + interval '24 hours'),
  constraint apxn_staking_claimed_valid check (
    (status = 'active' and claimed_at is null) or
    (status = 'claimed' and claimed_at is not null)
  )
);

create table if not exists public.apxn_staking_events (
  id bigint generated always as identity primary key,
  telegram_id text not null references public.users(telegram_id) on delete cascade,
  cycle_number integer not null,
  event_type text not null check (event_type in ('activated', 'claimed')),
  amount numeric not null default 0 check (amount in (0,1000)),
  balance_after numeric not null,
  created_at timestamptz not null default now(),
  unique (telegram_id, cycle_number, event_type)
);

create index if not exists apxn_staking_events_user_date_idx
  on public.apxn_staking_events (telegram_id, created_at desc);

alter table public.apxn_staking_cycles enable row level security;
alter table public.apxn_staking_events enable row level security;
revoke all on public.apxn_staking_cycles from public, anon, authenticated;
revoke all on public.apxn_staking_events from public, anon, authenticated;
grant select, insert, update, delete on public.apxn_staking_cycles to service_role;
grant select, insert, update, delete on public.apxn_staking_events to service_role;
grant usage, select on sequence public.apxn_staking_events_id_seq to service_role;

create or replace function public.apxn_staking_action(
  p_telegram_id bigint,
  p_action text
)
returns table (
  success boolean,
  balance numeric,
  status text,
  started_at timestamptz,
  ends_at timestamptz,
  cycle_number integer,
  reward numeric,
  retry_after integer,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_balance numeric;
  v_cycle public.apxn_staking_cycles%rowtype;
  v_next_cycle integer;
  v_status text;
  v_retry integer := 0;
begin
  if p_action not in ('activate', 'claim') or p_action is null then
    return query select false, 0::numeric, null::text, null::timestamptz,
      null::timestamptz, 0::integer, 0::numeric, 0::integer, 'INVALID_ACTION'::text;
    return;
  end if;

  -- Serializes staking with balance changes and concurrent requests.
  select coalesce(u.balance, 0)::numeric into v_balance
  from public.users u where u.telegram_id = p_telegram_id::text for update;
  if not found then
    return query select false, 0::numeric, null::text, null::timestamptz,
      null::timestamptz, 0::integer, 0::numeric, 0::integer, 'USER_NOT_FOUND'::text;
    return;
  end if;

  select * into v_cycle from public.apxn_staking_cycles s
  where s.telegram_id = p_telegram_id::text for update;

  if p_action = 'activate' then
    if v_balance < 20000 then
      return query select false, v_balance, coalesce(v_cycle.status, 'idle')::text,
        v_cycle.started_at, v_cycle.ends_at, coalesce(v_cycle.cycle_number,0)::integer,
        0::numeric, 0::integer, 'NOT_ELIGIBLE'::text;
      return;
    end if;

    if v_cycle.status = 'active' then
      v_retry := greatest(0, ceil(extract(epoch from (v_cycle.ends_at - v_now)))::integer);
      return query select false, v_balance, 'active'::text,
        v_cycle.started_at, v_cycle.ends_at, v_cycle.cycle_number,
        0::numeric, v_retry, 'CYCLE_ACTIVE'::text;
      return;
    end if;

    v_next_cycle := coalesce(v_cycle.cycle_number, 0) + 1;
    insert into public.apxn_staking_cycles as s (
      telegram_id, cycle_number, fixed_amount, status,
      started_at, ends_at, claimed_at, total_claimed, updated_at
    ) values (
      p_telegram_id::text, v_next_cycle, 10000, 'active',
      v_now, v_now + interval '24 hours', null,
      coalesce(v_cycle.total_claimed,0), v_now
    )
    on conflict (telegram_id) do update set
      cycle_number = excluded.cycle_number,
      fixed_amount = 10000,
      status = 'active',
      started_at = excluded.started_at,
      ends_at = excluded.ends_at,
      claimed_at = null,
      updated_at = excluded.updated_at;

    insert into public.apxn_staking_events
      (telegram_id, cycle_number, event_type, amount, balance_after)
      values (p_telegram_id::text, v_next_cycle, 'activated', 0, v_balance);

    return query select true, v_balance, 'active'::text, v_now,
      (v_now + interval '24 hours'), v_next_cycle, 0::numeric,
      86400::integer, null::text;
    return;
  end if;

  -- Claims remain available for an existing cycle, even if the balance
  -- subsequently dropped below 20k. The NEXT activation checks 20k anew.
  if v_cycle.telegram_id is null or v_cycle.status <> 'active' then
    return query select false, v_balance, coalesce(v_cycle.status, 'idle')::text,
      v_cycle.started_at, v_cycle.ends_at, coalesce(v_cycle.cycle_number,0)::integer,
      0::numeric, 0::integer, 'NO_ACTIVE_CYCLE'::text;
    return;
  end if;

  if v_now < v_cycle.ends_at then
    v_retry := greatest(1, ceil(extract(epoch from (v_cycle.ends_at - v_now)))::integer);
    return query select false, v_balance, 'active'::text,
      v_cycle.started_at, v_cycle.ends_at, v_cycle.cycle_number,
      0::numeric, v_retry, 'TOO_EARLY'::text;
    return;
  end if;

  update public.users u set balance = coalesce(u.balance,0) + 1000
  where u.telegram_id = p_telegram_id::text
  returning u.balance::numeric into v_balance;

  update public.apxn_staking_cycles s set
    status = 'claimed', claimed_at = v_now,
    total_claimed = s.total_claimed + 1000, updated_at = v_now
  where s.telegram_id = p_telegram_id::text and s.status = 'active';

  insert into public.apxn_staking_events
    (telegram_id, cycle_number, event_type, amount, balance_after)
    values (p_telegram_id::text, v_cycle.cycle_number, 'claimed', 1000, v_balance);

  return query select true, v_balance, 'claimed'::text,
    v_cycle.started_at, v_cycle.ends_at, v_cycle.cycle_number,
    1000::numeric, 0::integer, null::text;
end;
$$;

revoke all on function public.apxn_staking_action(bigint,text) from public, anon, authenticated;
grant execute on function public.apxn_staking_action(bigint,text) to service_role;

