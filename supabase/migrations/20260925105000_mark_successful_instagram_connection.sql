-- Allow only the service role (Edge Function server-side) to clear stale
-- connection errors after the provider and its data pull succeed.
CREATE OR REPLACE FUNCTION public.mark_connection_success(p_connection_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.connections
  SET last_error = NULL,
      last_checked_at = now(),
      last_refreshed_at = now()
  WHERE connection_id = p_connection_id;
$function$;

REVOKE ALL ON FUNCTION public.mark_connection_success(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_connection_success(uuid) TO service_role;
