create or replace function public.trigger_gumroad_ingestion()
returns void language sql security definer set search_path to 'public', 'extensions'
as $function$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/gumroad_sales',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
$function$;

create or replace function public.trigger_instagram_ingestion()
returns void language sql security definer set search_path to 'public', 'extensions'
as $function$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/instagram_insights_and_media',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
$function$;

create or replace function public.trigger_token_health_check()
returns void language sql security definer set search_path to 'public', 'extensions'
as $function$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check_token_health',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
$function$;
