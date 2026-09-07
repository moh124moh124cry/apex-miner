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
  -- إذا المستخدم موجود مسبقًا، لا ننشئه مرة أخرى
  select
    u.balance,
    u.mining_rate,
    u.referred_by,
    u.last_claim
  into
    v_balance,
    v_rate,
    v_referrer,
    v_last_claim
  from public.users as u
  where u.telegram_id = p_telegram_id;

  if found then
    return query
    select
      true,
      false,
      coalesce(v_balance, 0),
      coalesce(v_rate, 0.00025),
      0::numeric,
      0::numeric,
      v_referrer,
      v_last_claim,
      null::text;

    return;
  end if;

  -- حساب Welcome Bonus
  select count(*)
  into v_total_users
  from public.users;

  if v_total_users < 10000 then
    v_welcome_bonus := 10000;
  elsif v_total_users < 50000 then
    v_welcome_bonus := 5000;
  elsif v_total_users < 100000 then
    v_welcome_bonus := 2500;
  else
    v_welcome_bonus := 1000;
  end if;

  -- التحقق من Referral
  if
    p_referrer_id is not null
    and p_referrer_id <> p_telegram_id
    and exists (
      select 1
      from public.users
      where telegram_id = p_referrer_id
    )
  then
    v_referrer := p_referrer_id;
    v_referral_bonus := 1000;
  end if;

  v_balance :=
    v_welcome_bonus + v_referral_bonus;

  v_last_claim := now();

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
      p_telegram_id,
      nullif(trim(p_first_name), ''),
      nullif(trim(p_username), ''),
      v_balance,
      v_rate,
      v_referrer,
      false,
      false,
      false,
      0,
      null,
      v_last_claim
    );

  exception
    when unique_violation then
      -- حماية إضافية إذا حاول طلبان إنشاء المستخدم بنفس اللحظة
      select
        u.balance,
        u.mining_rate,
        u.referred_by,
        u.last_claim
      into
        v_balance,
        v_rate,
        v_referrer,
        v_last_claim
      from public.users as u
      where u.telegram_id = p_telegram_id;

      return query
      select
        true,
        false,
        coalesce(v_balance, 0),
        coalesce(v_rate, 0.00025),
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
  on function public.apex_register_user(bigint, text, text, bigint)
  from public;

revoke execute
  on function public.apex_register_user(bigint, text, text, bigint)
  from anon;

revoke execute
  on function public.apex_register_user(bigint, text, text, bigint)
  from authenticated;

grant execute
  on function public.apex_register_user(bigint, text, text, bigint)
  to service_role;
