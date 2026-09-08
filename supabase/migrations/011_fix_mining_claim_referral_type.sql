create or replace function public.apex_mining_claim(
  p_telegram_id bigint
)
returns table (
  success boolean,
  balance numeric,
  claimed numeric,
  mining_rate numeric,
  base_mining_rate numeric,
  active_friends bigint,
  last_claim timestamptz,
  cooldown integer,
  retry_after integer,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
  v_base_rate numeric;
  v_last_claim timestamptz;
  v_now timestamptz := now();

  v_elapsed_seconds numeric;
  v_active_friends bigint := 0;
  v_total_rate numeric;
  v_claimed numeric;
  v_new_balance numeric;

  v_cooldown integer := 43200;
  v_retry_after integer := 0;
begin
  perform set_config('TimeZone', 'UTC', true);

  -- Lock the user's row to prevent double claims.
  select
    coalesce(u.balance, 0)::numeric,
    coalesce(u.mining_rate, 0.00025)::numeric,
    u.last_claim
  into
    v_balance,
    v_base_rate,
    v_last_claim
  from public.users as u
  where u.telegram_id = p_telegram_id
  for update;

  if not found then
    return query
    select
      false,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      0::bigint,
      null::timestamptz,
      v_cooldown,
      0,
      'USER_NOT_FOUND'::text;

    return;
  end if;

  if v_last_claim is null then
    v_last_claim := v_now;
  end if;

  v_elapsed_seconds :=
    greatest(
      0,
      extract(
        epoch from (v_now - v_last_claim)
      )
    );

  -- Claim is allowed once every 12 hours.
  if v_elapsed_seconds < v_cooldown then
    v_retry_after :=
      ceil(
        v_cooldown - v_elapsed_seconds
      )::integer;

    return query
    select
      false,
      v_balance,
      0::numeric,
      v_base_rate,
      v_base_rate,
      0::bigint,
      v_last_claim,
      v_cooldown,
      v_retry_after,
      'COOLDOWN'::text;

    return;
  end if;

  -- Count active referred friends.
  --
  -- IMPORTANT FIX:
  -- referred_by is stored/used as text in the current project,
  -- while p_telegram_id is bigint.
  -- Cast p_telegram_id to text before comparison.
  select count(*)
  into v_active_friends
  from public.users as f
  where f.referred_by = p_telegram_id::text
    and f.last_claim >=
      v_now - interval '24 hours';

  -- +5% of base mining speed for every active friend.
  v_total_rate :=
    v_base_rate +
    (
      v_active_friends *
      (v_base_rate * 0.05)
    );

  -- Server-side authoritative mining calculation.
  v_claimed :=
    v_elapsed_seconds *
    v_total_rate;

  v_new_balance :=
    v_balance +
    v_claimed;

  update public.users as u
  set
    balance = v_new_balance,
    last_claim = v_now
  where u.telegram_id = p_telegram_id;

  return query
  select
    true,
    v_new_balance,
    v_claimed,
    v_total_rate,
    v_base_rate,
    v_active_friends,
    v_now,
    v_cooldown,
    0,
    null::text;
end;
$$;

revoke execute
  on function public.apex_mining_claim(bigint)
  from public;

revoke execute
  on function public.apex_mining_claim(bigint)
  from anon;

revoke execute
  on function public.apex_mining_claim(bigint)
  from authenticated;

grant execute
  on function public.apex_mining_claim(bigint)
  to service_role;
