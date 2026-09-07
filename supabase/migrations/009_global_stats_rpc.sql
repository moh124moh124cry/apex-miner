create or replace function public.apex_global_stats()
returns table (
  total_users bigint,
  countries jsonb
)
language sql
security definer
stable
set search_path = ''
as $$
  with totals as (
    select count(*)::bigint as total_users
    from public.users
  ),
  country_stats as (
    select
      u.country,
      count(*)::bigint as user_count
    from public.users as u
    where u.country is not null
      and u.country <> ''
      and u.country <> 'Unknown'
    group by u.country
  )
  select
    t.total_users,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'country', c.country,
            'count', c.user_count
          )
          order by c.user_count desc, c.country asc
        )
        from country_stats as c
      ),
      '[]'::jsonb
    ) as countries
  from totals as t;
$$;

revoke execute
on function public.apex_global_stats()
from public;

revoke execute
on function public.apex_global_stats()
from anon;

revoke execute
on function public.apex_global_stats()
from authenticated;

grant execute
on function public.apex_global_stats()
to service_role;
