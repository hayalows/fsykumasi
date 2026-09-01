create or replace function public.update_my_profile(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  v_name := trim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));

  if char_length(v_name) < 2 then
    raise exception 'Display name must be at least 2 characters.';
  end if;

  if char_length(v_name) > 80 then
    raise exception 'Display name must be 80 characters or fewer.';
  end if;

  update public.profiles
  set display_name = v_name,
      updated_at = now()
  where user_id = auth.uid();

  if not found then
    raise exception 'Profile not found.';
  end if;

  return jsonb_build_object('display_name', v_name);
end;
$$;

revoke all on function public.update_my_profile(text) from public;
grant execute on function public.update_my_profile(text) to authenticated;
