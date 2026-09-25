create or replace function public.get_overview_sankey_metrics(p_start_date date, p_end_date date)
returns table(views bigint, visits bigint, sales bigint)
language sql
stable
set search_path to 'public'
as $function$
  select
    (select coalesce(sum(metric.metric_value), 0)::bigint
       from public.account_metrics as metric
      where metric.metric_name = 'views'
        and metric.date >= p_start_date
        and metric.date <= p_end_date) as views,
    (select count(click.click_id)::bigint
       from public.link_clicks as click
      where click.clicked_at >= p_start_date
        and click.clicked_at < (p_end_date + 1)) as visits,
    (select count(sale.sale_id)::bigint
       from public.gumroad_sales as sale
      where sale.refunded is false
        and sale.created_at >= p_start_date
        and sale.created_at < (p_end_date + 1)) as sales;
$function$;

create or replace function public.get_platform_metric_delta(
  p_platform text,
  p_metric_name text,
  p_target_date date default (current_date - 1)
)
returns table(target_date date, current_value numeric, previous_value numeric, delta numeric)
language sql
security definer
set search_path to 'public'
as $function$
  select p_target_date,
         coalesce((select case p_metric_name
                    when 'sales_count' then summary.sales_count::numeric
                    when 'revenue_cents' then summary.revenue_cents::numeric
                   end
                   from public.gumroad_daily_summary summary
                   where summary.date = p_target_date), 0),
         coalesce((select case p_metric_name
                    when 'sales_count' then summary.sales_count::numeric
                    when 'revenue_cents' then summary.revenue_cents::numeric
                   end
                   from public.gumroad_daily_summary summary
                   where summary.date = p_target_date - 1), 0),
         coalesce((select case p_metric_name
                    when 'sales_count' then summary.sales_count::numeric
                    when 'revenue_cents' then summary.revenue_cents::numeric
                   end
                   from public.gumroad_daily_summary summary
                   where summary.date = p_target_date), 0)
           - coalesce((select case p_metric_name
                    when 'sales_count' then summary.sales_count::numeric
                    when 'revenue_cents' then summary.revenue_cents::numeric
                   end
                   from public.gumroad_daily_summary summary
                   where summary.date = p_target_date - 1), 0)
  where p_platform = 'gumroad'
    and p_metric_name in ('sales_count', 'revenue_cents')

  union all

  select current_metric.date,
         current_metric.metric_value,
         previous_metric.metric_value,
         current_metric.metric_value - previous_metric.metric_value
  from public.platform_metrics current_metric
  left join public.platform_metrics previous_metric
    on previous_metric.platform = current_metric.platform
   and previous_metric.metric_name = current_metric.metric_name
   and previous_metric.date = current_metric.date - 1
  where current_metric.platform = p_platform
    and current_metric.metric_name = p_metric_name
    and current_metric.date = p_target_date
    and not (p_platform = 'gumroad' and p_metric_name in ('sales_count', 'revenue_cents'));
$function$;

insert into public.field_selections(platform, level, field_name, display_as, display_order)
select 'instagram', 'account', 'follows_count', 'chip', 3
where not exists (
  select 1 from public.field_selections
  where platform = 'instagram'
    and level = 'account'
    and field_name = 'follows_count'
    and display_as = 'chip'
);
