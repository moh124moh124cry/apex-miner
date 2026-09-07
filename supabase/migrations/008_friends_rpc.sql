create or replace function public.apex_get_friends(
  p_telegram_id bigint,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  total_friends bigint,
  active_friends bigint,
  friends jsonb
)
language sql
security definer
stable
set search_path = ''
as $$
  with stats as (
    select
      count(*)::bigint as total_friends,
      count(*) filter (
        where u.last_claim >= now() - interval '24 hours'
      )::bigint as active_friends
    from public.users as u
    where u.referred_by = p_telegram_id
  ),
  friend_page as (
    select
      u.first_name,
      u.country,
      u.last_claim
    from public.users as u
    where u.referred_by = p_telegram_id
    order by u.last_claim desc nulls last
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    s.total_friends,
    s.active_friends,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'first_name', f.first_name,
            'country', f.country,
            'last_claim', f.last_claim
          )
          order by f.last_claim desc nulls last
        )
        from friend_page as f
      ),
      '[]'::jsonb
    ) as friends
  from stats as s;
$$;

revoke execute
on function public.apex_get_friends(bigint, integer, integer)
from public;

revoke execute
on function public.apex_get_friends(bigint, integer, integer)
from anon;

revoke execute
on function public.apex_get_friends(bigint, integer, integer)
from authenticated;

grant execute
on function public.apex_get_friends(bigint, integer, integer)
to service_role;
