-- Gumroad's public v2 sales endpoint contains sale records, not product page
-- views. The overview visit stage therefore counts only first-party tracked
-- link clicks; it must not imply that the sales API supplied visit analytics.
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

comment on function public.get_overview_sankey_metrics(date, date) is
  'Returns account views, first-party tracked link clicks, and Gumroad sales. Gumroad sales API does not expose product/site view counts.';
