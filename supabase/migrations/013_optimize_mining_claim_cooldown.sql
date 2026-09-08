-- ======================================================
-- Apex Network
-- Mining Claim cooldown scalability optimization
--
-- Goal:
-- Reduce unnecessary row locks caused by requests that
-- are still inside the 12-hour mining cooldown.
--
-- IMPORTANT:
-- This migration does NOT change:
-- - 12-hour cooldown
-- - Base mining rate
-- - +5% per active referral
-- - Active referral definition (24 hours)
-- - Reward calculation
-- - Balance calculation
-- - RPC parameters
-- - RPC return schema
--
-- Supabase remains the final atomic authority.
-- ======================================================


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

  -- Existing 12-hour cooldown.
  v_cooldown integer := 43200;
  v_retry_after integer := 0;

begin
  perform set_config(
    'TimeZone',
    'UTC',
    true
  );


  -- ====================================================
  -- PHASE 1
  -- Lightweight indexed cooldown pre-check.
  --
  -- No FOR UPDATE here.
  --
  -- The users primary key on telegram_id makes this
  -- a single-row indexed lookup.
  --
  -- Most repeated requests during the 12-hour cooldown
  -- can return here without acquiring a row lock.
  -- ====================================================

  select
    coalesce(
      u.balance,
      0
    )::numeric,

    coalesce(
      u.mining_rate,
      0.00025
    )::numeric,

    u.last_claim

  into
    v_balance,
    v_base_rate,
    v_last_claim

  from public.users as u

  where
    u.telegram_id =
      p_telegram_id::text;


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
    v_last_claim :=
      v_now;
  end if;


  v_elapsed_seconds :=
    greatest(
      0,
      extract(
        epoch from (
          v_now -
          v_last_claim
        )
      )
    );


  -- ====================================================
  -- Fast cooldown exit.
  --
  -- No row lock.
  -- No active-referral count.
  -- No UPDATE.
  -- ====================================================

  if
    v_elapsed_seconds <
    v_cooldown
  then

    v_retry_after :=
      ceil(
        v_cooldown -
        v_elapsed_seconds
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


  -- ====================================================
  -- PHASE 2
  -- The claim appears eligible.
  --
  -- Now acquire the authoritative row lock and re-read
  -- all mutable values.
  --
  -- The second cooldown check below is REQUIRED.
  --
  -- Example:
  -- Two requests arrive simultaneously.
  --
  -- Both may pass PHASE 1.
  -- Only one receives the row lock first.
  -- The second request waits, then re-reads the updated
  -- last_claim and receives COOLDOWN instead of another
  -- reward.
  --
  -- Therefore rewards remain atomic across all Vercel
  -- instances.
  -- ====================================================

  select
    coalesce(
      u.balance,
      0
    )::numeric,

    coalesce(
      u.mining_rate,
      0.00025
    )::numeric,

    u.last_claim

  into
    v_balance,
    v_base_rate,
    v_last_claim

  from public.users as u

  where
    u.telegram_id =
      p_telegram_id::text

  for update;


  -- The user could theoretically disappear between
  -- PHASE 1 and PHASE 2.
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
    v_last_claim :=
      v_now;
  end if;


  -- ====================================================
  -- Authoritative cooldown re-check under row lock.
  -- ====================================================

  v_elapsed_seconds :=
    greatest(
      0,
      extract(
        epoch from (
          v_now -
          v_last_claim
        )
      )
    );


  if
    v_elapsed_seconds <
    v_cooldown
  then

    v_retry_after :=
      ceil(
        v_cooldown -
        v_elapsed_seconds
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


  -- ====================================================
  -- Active referrals
  --
  -- Existing logic remains unchanged:
  -- referral must have claimed during the last 24 hours.
  --
  -- Existing referred_by / last_claim indexes remain
  -- usable by this query.
  -- ====================================================

  select
    count(*)

  into
    v_active_friends

  from public.users as f

  where
    f.referred_by =
      p_telegram_id::text

    and

    f.last_claim >=
      v_now -
      interval '24 hours';


  -- ====================================================
  -- Mining speed
  --
  -- Existing formula:
  -- base rate +5% of base rate per active friend.
  -- ====================================================

  v_total_rate :=
    v_base_rate +
    (
      v_active_friends *
      (
        v_base_rate *
        0.05
      )
    );


  -- ====================================================
  -- Reward
  --
  -- Existing reward formula remains unchanged.
  -- ====================================================

  v_claimed :=
    v_elapsed_seconds *
    v_total_rate;


  v_new_balance :=
    v_balance +
    v_claimed;


  -- ====================================================
  -- Atomic balance / last_claim update while the user's
  -- row remains locked.
  -- ====================================================

  update public.users as u

  set
    balance =
      v_new_balance,

    last_claim =
      v_now

  where
    u.telegram_id =
      p_telegram_id::text;


  -- ====================================================
  -- Successful authoritative response.
  -- ====================================================

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


-- ======================================================
-- RPC permissions
--
-- Keep the function server-only.
-- Browser users must never call the reward RPC directly.
-- ======================================================

revoke execute
  on function
    public.apex_mining_claim(bigint)
  from public;


revoke execute
  on function
    public.apex_mining_claim(bigint)
  from anon;


revoke execute
  on function
    public.apex_mining_claim(bigint)
  from authenticated;


grant execute
  on function
    public.apex_mining_claim(bigint)
  to service_role;
