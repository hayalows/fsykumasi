-- Supabase installs pgcrypto in the extensions schema. Security-definer functions
-- in this project use an empty search_path, so extension functions must be qualified.

create or replace function private.ensure_session_access_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.session_access_codes(session_id, access_code)
  values (
    new.id,
    upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10))
  )
  on conflict (session_id) do nothing;
  return new;
end;
$$;

revoke all on function private.ensure_session_access_code() from public;

create or replace function public.rotate_session_access_code(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_code text;
begin
  if not private.has_session_role(
    p_session_id,
    array['logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Only access approvers can rotate the session code';
  end if;

  next_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));

  insert into private.session_access_codes(session_id, access_code, rotated_at)
  values (p_session_id, next_code, now())
  on conflict (session_id) do update
    set access_code = excluded.access_code,
        rotated_at = excluded.rotated_at;

  return next_code;
end;
$$;

revoke all on function public.rotate_session_access_code(uuid) from public;
grant execute on function public.rotate_session_access_code(uuid) to authenticated;
