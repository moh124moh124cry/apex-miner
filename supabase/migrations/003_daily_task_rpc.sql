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
  perform set_config('TimeZone', 'UTC', true);

  if p_task not in ('telegram', 'twitter') then
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
    coalesce(u.balance, 0)::numeric,
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
  where u.telegram_id = p_telegram_id
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

  if v_last_task = current_date then
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
    balance = coalesce(u.balance, 0) + v_reward,

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

  where u.telegram_id = p_telegram_id
  returning u.balance::numeric
  into v_balance;

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
  on function public.apex_claim_daily_task(bigint, text)
  from public;

revoke execute
  on function public.apex_claim_daily_task(bigint, text)
  from anon;

revoke execute
  on function public.apex_claim_daily_task(bigint, text)
  from authenticated;

grant execute
  on function public.apex_claim_daily_task(bigint, text)
  to service_role;
