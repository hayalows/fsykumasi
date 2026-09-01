-- Administrator-assisted recovery when email delivery is unavailable or rate-limited.
-- Recovery codes expire quickly and preserve the user's current role/scope.

create or replace function public.create_leader_recovery_code(
  p_session_id uuid,
  p_user_id uuid
)
returns table(invite_id uuid, recovery_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_access public.access_assignments%rowtype;
  target_profile public.profiles%rowtype;
  raw_code text;
  formatted_code text;
  new_id uuid;
  new_expiry timestamptz := now() + interval '30 minutes';
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1 from public.access_assignments aa
    where aa.session_id = p_session_id
      and aa.user_id = (select auth.uid())
      and aa.active
      and aa.role in ('logistics_admin', 'session_director')
  ) then
    raise exception 'Only logistical administrators or the session directing couple can issue recovery codes';
  end if;

  select * into target_access
  from public.access_assignments aa
  where aa.session_id = p_session_id and aa.user_id = p_user_id and aa.active
  order by aa.created_at desc
  limit 1;

  if target_access.id is null then raise exception 'This leader does not have active access'; end if;

  select * into target_profile from public.profiles where user_id = p_user_id;
  if target_profile.user_id is null or target_profile.email is null then raise exception 'This leader does not have a recoverable email account'; end if;

  update public.leader_invites
  set status = 'revoked', revoked_at = now()
  where session_id = p_session_id
    and lower(email) = lower(target_profile.email)
    and status in ('pending', 'activating')
    and purpose = 'recovery';

  raw_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  formatted_code := 'FSY-' || substr(raw_code, 1, 4) || '-' || substr(raw_code, 5, 4) || '-' || substr(raw_code, 9, 4);

  insert into public.leader_invites(
    session_id, email, display_name, role, company_ids, committee_scope,
    purpose, code_hash, created_by, expires_at
  ) values (
    p_session_id,
    lower(target_profile.email),
    target_profile.display_name,
    target_access.role,
    target_access.company_ids,
    target_access.committee_scope,
    'recovery',
    encode(extensions.digest(replace(upper(formatted_code), '-', ''), 'sha256'), 'hex'),
    (select auth.uid()),
    new_expiry
  ) returning id into new_id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id,
    (select auth.uid()),
    'leader_recovery_code_created',
    'leader_invite',
    new_id::text,
    jsonb_build_object('target_user_id', p_user_id, 'role', target_access.role)
  );

  return query select new_id, formatted_code, new_expiry;
end;
$$;

revoke all on function public.create_leader_recovery_code(uuid, uuid) from public;
grant execute on function public.create_leader_recovery_code(uuid, uuid) to authenticated;
