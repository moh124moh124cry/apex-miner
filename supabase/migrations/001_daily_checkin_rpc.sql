-- Apex Network - Daily Check-In RPC
-- Purpose:
--   1) One RPC call from the server
--   2) Atomic check-in with row locking
--   3) Prevent duplicate rewards from concurrent clicks
--   4) Keep anon/authenticated clients from executing it directly

create or replace function public.apex_daily_checkin(
  p_telegram_id bigint
)
returns table (
  success boolean,
  reward numeric,
  balance numeric,
  checkin_streak integer,
  last_checkin_date text,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
  v_streak integer;
  v_last_checkin_date date;
  v_reward numeric;
  v_new_streak integer;
  v_updated_balance numeric;
  v_updated_last_checkin text;
begin
  -- Supabase projects use UTC by default, but enforce it for this transaction.
  perform set_config('TimeZone', 'UTC', true);

  -- Lock only this user's row so two simultaneous check-ins cannot both win.
  select
    coalesce(u.balance, 0)::numeric,
    coalesce(u.checkin_streak, 0)::integer,
    u.last_checkin_date::date
  into
    v_balance,
    v_streak,
    v_last_checkin_date
  from public.users as u
  where u.telegram_id = p_telegram_id
  for update;

  if not found then
    return query
    select
      false,
      0::numeric,
      0::numeric,
      0::integer,
      null::text,
      'USER_NOT_FOUND'::text;
    return;
  end if;

  -- Already claimed today.
  if v_last_checkin_date = current_date then
    return query
    select
      false,
      0::numeric,
      v_balance,
      v_streak,
      v_last_checkin_date::text,
      'ALREADY_CLAIMED'::text;
    return;
  end if;

  -- Continue streak only if the previous check-in was yesterday.
  if v_last_checkin_date = current_date - 1 then
    v_new_streak := v_streak + 1;
  else
    v_new_streak := 1;
  end if;

  -- Rewards repeat every 7 days:
  -- Day 1 = 100, Day 2 = 200, ... Day 7 = 700, Day 8 = 100.
  v_reward :=
    ((((v_new_streak - 1) % 7) + 1) * 100)::numeric;

  update public.users as u
  set
    balance = coalesce(u.balance, 0) + v_reward,
    checkin_streak = v_new_streak,
    last_checkin_date = now()
  where u.telegram_id = p_telegram_id
  returning
    u.balance::numeric,
    u.last_checkin_date::text
  into
    v_updated_balance,
    v_updated_last_checkin;

  return query
  select
    true,
    v_reward,
    v_updated_balance,
    v_new_streak,
    v_updated_last_checkin,
    null::text;
end;
$$;

-- Do not expose this reward function to browser roles.
revoke execute
  on function public.apex_daily_checkin(bigint)
  from public;

revoke execute
  on function public.apex_daily_checkin(bigint)
  from anon;

revoke execute
  on function public.apex_daily_checkin(bigint)
  from authenticated;

-- Only trusted server-side code using the Supabase service role may call it.
grant execute
  on function public.apex_daily_checkin(bigint)
  to service_role;

