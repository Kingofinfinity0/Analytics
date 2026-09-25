create or replace function public.process_daily_aggregates()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  summary_row record;
begin
  for r in select * from instagram_analytics_raw where pulled_at > now() - interval '1 day'
  loop
    insert into instagram_analytics (account_id, date, follower_count, reach, profile_views, accounts_engaged, views)
    select r.account_id, current_date,
      (select (e->'total_value'->>'value')::integer from jsonb_array_elements(r.payload->'data') e where e->>'name' = 'follower_count'),
      (select (e->'total_value'->>'value')::integer from jsonb_array_elements(r.payload->'data') e where e->>'name' = 'reach'),
      (select (e->'total_value'->>'value')::integer from jsonb_array_elements(r.payload->'data') e where e->>'name' = 'profile_views'),
      (select (e->'total_value'->>'value')::integer from jsonb_array_elements(r.payload->'data') e where e->>'name' = 'accounts_engaged'),
      (select (e->'total_value'->>'value')::integer from jsonb_array_elements(r.payload->'data') e where e->>'name' = 'views')
    on conflict (account_id, date) do update set
      follower_count = coalesce(excluded.follower_count, instagram_analytics.follower_count),
      reach = coalesce(excluded.reach, instagram_analytics.reach),
      profile_views = coalesce(excluded.profile_views, instagram_analytics.profile_views),
      accounts_engaged = coalesce(excluded.accounts_engaged, instagram_analytics.accounts_engaged),
      views = coalesce(excluded.views, instagram_analytics.views);
  end loop;

  for r in select * from gumroad_sales_raw where pulled_at > now() - interval '1 day'
  loop
    insert into gumroad_sales (sale_id, product_id, product_name, price_cents, email, created_at, referral_source, utm_source, refunded, quantity)
    select sale_item->>'id', sale_item->>'product_id', sale_item->>'product_name', (sale_item->>'price')::integer, sale_item->>'email',
      (sale_item->>'created_at')::timestamptz, sale_item->>'referrer', sale_item->'url_params'->>'source_url',
      coalesce((sale_item->>'refunded')::boolean, false), coalesce((sale_item->>'quantity')::integer, 1)
    from jsonb_array_elements(r.payload->'sales') as sale_item
    on conflict (sale_id) do update set refunded = excluded.refunded;
  end loop;

  insert into gumroad_daily_summary (date, sales_count, revenue_cents, running_total_cents)
  select created_at::date, count(*), sum(price_cents), sum(sum(price_cents)) over (order by created_at::date)
  from gumroad_sales where not refunded group by created_at::date
  on conflict (date) do update set
    sales_count = excluded.sales_count, revenue_cents = excluded.revenue_cents, running_total_cents = excluded.running_total_cents;

  for summary_row in select * from gumroad_daily_summary
  loop
    perform log_platform_metric('gumroad', summary_row.date, 'sales_count', summary_row.sales_count);
    perform log_platform_metric('gumroad', summary_row.date, 'revenue_cents', summary_row.revenue_cents);
  end loop;
end;
$function$;
