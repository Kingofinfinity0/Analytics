-- Store the Instagram profile's display name separately from its username.
-- The OAuth and ingestion callers can omit p_display_name when the API does
-- not expose it for a particular account/app configuration.
DROP FUNCTION IF EXISTS public.upsert_instagram_account(text, text);

CREATE OR REPLACE FUNCTION public.upsert_instagram_account(
  p_external_id text,
  p_handle text,
  p_display_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_display_name text := COALESCE(NULLIF(p_display_name, ''), p_handle);
BEGIN
  SELECT account_id INTO v_id
  FROM public.instagram_accounts
  WHERE external_id = p_external_id;

  IF v_id IS NULL THEN
    INSERT INTO public.instagram_accounts (platform, external_id, handle, display_name)
    VALUES ('instagram', p_external_id, p_handle, v_display_name)
    RETURNING account_id INTO v_id;
  ELSE
    UPDATE public.instagram_accounts
    SET handle = p_handle,
        display_name = CASE
          WHEN NULLIF(p_display_name, '') IS NOT NULL THEN p_display_name
          ELSE COALESCE(display_name, p_handle)
        END
    WHERE account_id = v_id;
  END IF;

  INSERT INTO public.social_accounts AS existing (account_id, platform, external_id, handle, display_name)
  VALUES (v_id, 'instagram', p_external_id, p_handle, v_display_name)
  ON CONFLICT (platform, external_id)
  DO UPDATE SET handle = EXCLUDED.handle,
                display_name = CASE
                  WHEN NULLIF(p_display_name, '') IS NOT NULL THEN EXCLUDED.display_name
                  ELSE COALESCE(existing.display_name, EXCLUDED.handle)
                END;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_instagram_account(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_instagram_account(text, text, text) TO anon, authenticated, service_role;
