create or replace function public.get_active_connections(p_platform text, p_internal_secret text)
returns table(connection_id uuid, account_id uuid, external_id text, access_token text)
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
begin
  if p_internal_secret is distinct from (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret') then
    raise exception 'invalid internal secret' using errcode = '28000';
  end if;

  return query
    select c.connection_id, c.account_id, c.external_id, s.decrypted_secret
    from connections c
    join vault.decrypted_secrets s on s.id = c.access_token_secret_id
    where c.platform = p_platform;
end;
$function$;
