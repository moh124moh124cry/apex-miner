-- ======================================================
-- Apex Network
-- Monetag Rewarded Ad - Daily 24h Reward
--
-- Purpose:
--   1) Add secure server-side storage for the last ad reward
--   2) Reward 150 APXN after an approved ad claim
--   3) Allow only one reward every full 24 hours
--   4) Use row locking to stop concurrent duplicate claims
--   5) Keep the RPC available to service_role only
--
-- IMPORTANT:
-- This RPC protects the balance and the 24h cooldown.
-- The API route must authenticate the Telegram user before
-- calling this function.
-- ======================================================


-- ======================================================
-- 1. User columns
-- ======================================================

alter table public.users
  add column if not exists
    last_ad_reward_at timestamptz null;

alter table public.users
  add column if not exists
    ad_reward_count integer not null default 0;


-- ======================================================
-- 2. Rewarded Ad RPC
-- Reward: 150 APXN
-- Cooldown: 24 hours
-- ======================================================

create or replace function public.apex_claim_ad_reward(
  p_telegram_id bigint
)
returns table (
  success boolean,
  reward numeric,
  balance numeric,
  last_ad_reward_at timestamptz,
  ad_reward_count integer,
  retry_after integer,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
  v_last_ad_reward_at timestamptz;
  v_ad_reward_count integer;

  v_now timestamptz := now();
  v_reward numeric := 150;

  v_cooldown_seconds integer := 86400;
  v_elapsed_seconds numeric;
  v_retry_after integer := 0;
begin
  perform set_config(
    'TimeZone',
    'UTC',
    true
  );

  -- Lock the user row so two simultaneous requests
  -- cannot receive the same reward twice.
  select
    coalesce(
      u.balance,
      0
    )::numeric,

    u.last_ad_reward_at,

    coalesce(
      u.ad_reward_count,
      0
    )::integer

  into
    v_balance,
    v_last_ad_reward_at,
    v_ad_reward_count

  from public.users as u

  where
    u.telegram_id =
      p_telegram_id::text

  for update;


  -- User does not exist.
  if not found then
    return query
    select
      false,
      0::numeric,
      0::numeric,
      null::timestamptz,
      0::integer,
      0::integer,
      'USER_NOT_FOUND'::text;

    return;
  end if;


  -- Enforce a real rolling 24-hour cooldown.
  if v_last_ad_reward_at is not null then
    v_elapsed_seconds :=
      greatest(
        0,
        extract(
          epoch from (
            v_now -
            v_last_ad_reward_at
          )
        )
      );

    if
      v_elapsed_seconds <
      v_cooldown_seconds
    then
      v_retry_after :=
        ceil(
          v_cooldown_seconds -
          v_elapsed_seconds
        )::integer;

      return query
      select
        false,
        0::numeric,
        v_balance,
        v_last_ad_reward_at,
        v_ad_reward_count,
        v_retry_after,
        'COOLDOWN'::text;

      return;
    end if;
  end if;


  -- Apply the reward atomically.
  update public.users as u
  set
    balance =
      coalesce(
        u.balance,
        0
      ) +
      v_reward,

    last_ad_reward_at =
      v_now,

    ad_reward_count =
      coalesce(
        u.ad_reward_count,
        0
      ) + 1

  where
    u.telegram_id =
      p_telegram_id::text

  returning
    u.balance::numeric,
    u.last_ad_reward_at,
    u.ad_reward_count::integer

  into
    v_balance,
    v_last_ad_reward_at,
    v_ad_reward_count;


  return query
  select
    true,
    v_reward,
    v_balance,
    v_last_ad_reward_at,
    v_ad_reward_count,
    0::integer,
    null::text;
end;
$$;


-- ======================================================
-- 3. Permissions
-- Only the server-side service role may execute the RPC.
-- ======================================================

revoke execute
  on function
    public.apex_claim_ad_reward(
      bigint
    )
  from public;

revoke execute
  on function
    public.apex_claim_ad_reward(
      bigint
    )
  from anon;

revoke execute
  on function
    public.apex_claim_ad_reward(
      bigint
    )
  from authenticated;

grant execute
  on function
    public.apex_claim_ad_reward(
      bigint
    )
  to service_role;

