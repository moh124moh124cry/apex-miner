-- ======================================================
-- Apex Network
-- Final Telegram ID type compatibility fixes
--
-- public.users.telegram_id = text
-- public.users.referred_by = text
--
-- This migration intentionally supersedes older RPC
-- definitions that compared text columns with bigint.
-- ======================================================


-- ======================================================
-- 1. Mining Claim
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

  v_cooldown integer := 43200;
  v_retry_after integer := 0;
begin
  perform set_config(
    'TimeZone',
    'UTC',
    true
  );

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

  v_total_rate :=
    v_base_rate +
    (
      v_active_friends *
      (
        v_base_rate *
        0.05
      )
    );

  v_claimed :=
    v_elapsed_seconds *
    v_total_rate;

  v_new_balance :=
    v_balance +
    v_claimed;

  update public.users as u
  set
    balance =
      v_new_balance,

    last_claim =
      v_now
  where
    u.telegram_id =
    p_telegram_id::text;

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


-- ======================================================
-- 2. Daily Tasks
-- Telegram = 100
-- Twitter  = 100
-- ======================================================

create or replace function public.apex_claim_daily_task(
  p_telegram_id bigint,
  p_task text
)
returns table (
  success boolean,
  reward numeric,
  balance numeric,
  last_task_date date,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
  v_last_task date;
  v_reward numeric := 100;
begin
  perform set_config(
    'TimeZone',
    'UTC',
    true
  );

  if
    p_task not in (
      'telegram',
      'twitter'
    )
  then
    return query
    select
      false,
      0::numeric,
      0::numeric,
      null::date,
      'INVALID_TASK'::text;

    return;
  end if;

  select
    coalesce(
      u.balance,
      0
    )::numeric,

    case
      when p_task = 'telegram'
        then u.last_telegram_task

      when p_task = 'twitter'
        then u.last_twitter_task
    end
  into
    v_balance,
    v_last_task
  from public.users as u
  where
    u.telegram_id =
    p_telegram_id::text
  for update;

  if not found then
    return query
    select
      false,
      0::numeric,
      0::numeric,
      null::date,
      'USER_NOT_FOUND'::text;

    return;
  end if;

  if
    v_last_task =
    current_date
  then
    return query
    select
      false,
      0::numeric,
      v_balance,
      v_last_task,
      'ALREADY_CLAIMED'::text;

    return;
  end if;

  update public.users as u
  set
    balance =
      coalesce(
        u.balance,
        0
      ) +
      v_reward,

    last_telegram_task =
      case
        when p_task = 'telegram'
          then current_date
        else u.last_telegram_task
      end,

    last_twitter_task =
      case
        when p_task = 'twitter'
          then current_date
        else u.last_twitter_task
      end
  where
    u.telegram_id =
    p_telegram_id::text
  returning
    u.balance::numeric
  into
    v_balance;

  return query
  select
    true,
    v_reward,
    v_balance,
    current_date,
    null::text;
end;
$$;

revoke execute
  on function
    public.apex_claim_daily_task(
      bigint,
      text
    )
  from public;

revoke execute
  on function
    public.apex_claim_daily_task(
      bigint,
      text
    )
  from anon;

revoke execute
  on function
    public.apex_claim_daily_task(
      bigint,
      text
    )
  from authenticated;

grant execute
  on function
    public.apex_claim_daily_task(
      bigint,
      text
    )
  to service_role;


-- ======================================================
-- 3. One-Time Social Tasks
-- Channel = 500
-- Group   = 500
-- Twitter = 500
-- ======================================================

create or replace function public.apex_claim_social_task(
  p_telegram_id bigint,
  p_task text
)
returns table (
  success boolean,
  reward numeric,
  balance numeric,
  task_completed boolean,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
  v_completed boolean;
  v_reward numeric := 500;
begin
  select
    coalesce(
      u.balance,
      0
    )::numeric,

    case
      when p_task = 'channel'
        then coalesce(
          u.channel_joined,
          false
        )

      when p_task = 'group'
        then coalesce(
          u.group_joined,
          false
        )

      when p_task = 'twitter'
        then coalesce(
          u.twitter_joined,
          false
        )

      else null
    end
  into
    v_balance,
    v_completed
  from public.users as u
  where
    u.telegram_id =
    p_telegram_id::text
  for update;

  if not found then
    return query
    select
      false,
      0::numeric,
      0::numeric,
      false,
      'USER_NOT_FOUND'::text;

    return;
  end if;

  if
    p_task not in (
      'channel',
      'group',
      'twitter'
    )
  then
    return query
    select
      false,
      0::numeric,
      v_balance,
      false,
      'INVALID_TASK'::text;

    return;
  end if;

  if v_completed then
    return query
    select
      false,
      0::numeric,
      v_balance,
      true,
      'ALREADY_CLAIMED'::text;

    return;
  end if;

  update public.users as u
  set
    balance =
      coalesce(
        u.balance,
        0
      ) +
      v_reward,

    channel_joined =
      case
        when p_task = 'channel'
          then true
        else u.channel_joined
      end,

    group_joined =
      case
        when p_task = 'group'
          then true
        else u.group_joined
      end,

    twitter_joined =
      case
        when p_task = 'twitter'
          then true
        else u.twitter_joined
      end
  where
    u.telegram_id =
    p_telegram_id::text
  returning
    u.balance::numeric
  into
    v_balance;

  return query
  select
    true,
    v_reward,
    v_balance,
    true,
    null::text;
end;
$$;

revoke execute
  on function
    public.apex_claim_social_task(
      bigint,
      text
    )
  from public;

revoke execute
  on function
    public.apex_claim_social_task(
      bigint,
      text
    )
  from anon;

revoke execute
  on function
    public.apex_claim_social_task(
      bigint,
      text
    )
  from authenticated;

grant execute
  on function
    public.apex_claim_social_task(
      bigint,
      text
    )
  to service_role;


-- ======================================================
-- 4. Daily Check-In
-- ======================================================

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
  perform set_config(
    'TimeZone',
    'UTC',
    true
  );

  select
    coalesce(
      u.balance,
      0
    )::numeric,

    coalesce(
      u.checkin_streak,
      0
    )::integer,

    u.last_checkin_date::date
  into
    v_balance,
    v_streak,
    v_last_checkin_date
  from public.users as u
  where
    u.telegram_id =
    p_telegram_id::text
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

  if
    v_last_checkin_date =
    current_date
  then
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

  if
    v_last_checkin_date =
    current_date - 1
  then
    v_new_streak :=
      v_streak + 1;
  else
    v_new_streak := 1;
  end if;

  v_reward :=
    (
      (
        (
          (
            v_new_streak - 1
          ) % 7
        ) + 1
      ) * 100
    )::numeric;

  update public.users as u
  set
    balance =
      coalesce(
        u.balance,
        0
      ) +
      v_reward,

    checkin_streak =
      v_new_streak,

    last_checkin_date =
      now()
  where
    u.telegram_id =
    p_telegram_id::text
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

revoke execute
  on function
    public.apex_daily_checkin(bigint)
  from public;

revoke execute
  on function
    public.apex_daily_checkin(bigint)
  from anon;

revoke execute
  on function
    public.apex_daily_checkin(bigint)
  from authenticated;

grant execute
  on function
    public.apex_daily_checkin(bigint)
  to service_role;


-- ======================================================
-- 5. User Registration + Referral
-- ======================================================

create or replace function public.apex_register_user(
  p_telegram_id bigint,
  p_first_name text,
  p_username text,
  p_referrer_id bigint default null
)
returns table (
  success boolean,
  created boolean,
  balance numeric,
  mining_rate numeric,
  welcome_bonus numeric,
  referral_bonus numeric,
  referred_by bigint,
  last_claim timestamptz,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total_users bigint;
  v_welcome_bonus numeric;
  v_referral_bonus numeric := 0;
  v_referrer bigint := null;
  v_balance numeric;
  v_rate numeric := 0.00025;
  v_last_claim timestamptz;
begin
  select
    u.balance,
    u.mining_rate,
    nullif(
      u.referred_by,
      ''
    )::bigint,
    u.last_claim
  into
    v_balance,
    v_rate,
    v_referrer,
    v_last_claim
  from public.users as u
  where
    u.telegram_id =
    p_telegram_id::text;

  if found then
    return query
    select
      true,
      false,
      coalesce(
        v_balance,
        0
      ),
      coalesce(
        v_rate,
        0.00025
      ),
      0::numeric,
      0::numeric,
      v_referrer,
      v_last_claim,
      null::text;

    return;
  end if;

  select
    count(*)
  into
    v_total_users
  from public.users;

  if
    v_total_users < 10000
  then
    v_welcome_bonus := 10000;

  elsif
    v_total_users < 50000
  then
    v_welcome_bonus := 5000;

  elsif
    v_total_users < 100000
  then
    v_welcome_bonus := 2500;

  else
    v_welcome_bonus := 1000;
  end if;

  if
    p_referrer_id is not null
    and
    p_referrer_id <>
      p_telegram_id
    and
    exists (
      select
        1
      from public.users
      where
        telegram_id =
        p_referrer_id::text
    )
  then
    v_referrer :=
      p_referrer_id;

    v_referral_bonus :=
      1000;
  end if;

  v_balance :=
    v_welcome_bonus +
    v_referral_bonus;

  v_last_claim :=
    now();

  begin
    insert into public.users (
      telegram_id,
      first_name,
      username,
      balance,
      mining_rate,
      referred_by,
      channel_joined,
      group_joined,
      twitter_joined,
      checkin_streak,
      last_checkin_date,
      last_claim
    )
    values (
      p_telegram_id::text,

      nullif(
        trim(
          p_first_name
        ),
        ''
      ),

      nullif(
        trim(
          p_username
        ),
        ''
      ),

      v_balance,
      v_rate,

      case
        when v_referrer is null
          then null
        else
          v_referrer::text
      end,

      false,
      false,
      false,
      0,
      null,
      v_last_claim
    );

  exception
    when unique_violation then
      select
        u.balance,
        u.mining_rate,
        nullif(
          u.referred_by,
          ''
        )::bigint,
        u.last_claim
      into
        v_balance,
        v_rate,
        v_referrer,
        v_last_claim
      from public.users as u
      where
        u.telegram_id =
        p_telegram_id::text;

      return query
      select
        true,
        false,
        coalesce(
          v_balance,
          0
        ),
        coalesce(
          v_rate,
          0.00025
        ),
        0::numeric,
        0::numeric,
        v_referrer,
        v_last_claim,
        null::text;

      return;
  end;

  return query
  select
    true,
    true,
    v_balance,
    v_rate,
    v_welcome_bonus,
    v_referral_bonus,
    v_referrer,
    v_last_claim,
    null::text;
end;
$$;

revoke execute
  on function
    public.apex_register_user(
      bigint,
      text,
      text,
      bigint
    )
  from public;

revoke execute
  on function
    public.apex_register_user(
      bigint,
      text,
      text,
      bigint
    )
  from anon;

revoke execute
  on function
    public.apex_register_user(
      bigint,
      text,
      text,
      bigint
    )
  from authenticated;

grant execute
  on function
    public.apex_register_user(
      bigint,
      text,
      text,
      bigint
    )
  to service_role;
