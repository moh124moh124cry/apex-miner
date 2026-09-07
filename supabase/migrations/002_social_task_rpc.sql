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
  -- نقفل صف المستخدم فقط أثناء العملية
  select
    coalesce(u.balance, 0)::numeric,
    case
      when p_task = 'channel' then coalesce(u.channel_joined, false)
      when p_task = 'group' then coalesce(u.group_joined, false)
      when p_task = 'twitter' then coalesce(u.twitter_joined, false)
      else null
    end
  into
    v_balance,
    v_completed
  from public.users as u
  where u.telegram_id = p_telegram_id
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

  -- لا نقبل أي اسم مهمة غير معروف
  if p_task not in ('channel', 'group', 'twitter') then
    return query
    select
      false,
      0::numeric,
      v_balance,
      false,
      'INVALID_TASK'::text;
    return;
  end if;

  -- المهمة حصل المستخدم على مكافأتها مسبقًا
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
    balance = coalesce(u.balance, 0) + v_reward,

    channel_joined =
      case
        when p_task = 'channel' then true
        else u.channel_joined
      end,

    group_joined =
      case
        when p_task = 'group' then true
        else u.group_joined
      end,

    twitter_joined =
      case
        when p_task = 'twitter' then true
        else u.twitter_joined
      end

  where u.telegram_id = p_telegram_id

  returning u.balance::numeric
  into v_balance;

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
  on function public.apex_claim_social_task(bigint, text)
  from public;

revoke execute
  on function public.apex_claim_social_task(bigint, text)
  from anon;

revoke execute
  on function public.apex_claim_social_task(bigint, text)
  from authenticated;

grant execute
  on function public.apex_claim_social_task(bigint, text)
  to service_role;
