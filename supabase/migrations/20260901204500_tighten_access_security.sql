-- Tighten access-management data after introducing self-service requests.
-- Assistant coordinators and committee viewers keep scoped operational access but cannot browse the full authenticated-user roster or session access code.

create table if not exists private.session_access_codes (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  access_code text not null unique,
  rotated_at timestamptz not null default now()
);

insert into private.session_access_codes(session_id, access_code)
select id, access_code from public.sessions
on conflict (session_id) do update set access_code = excluded.access_code;

alter table public.sessions drop column if exists access_code;

create or replace function public.request_session_access(
  p_access_code text,
  p_role public.app_role,
  p_scope_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session uuid;
  request_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if p_role not in ('assistant_coordinator', 'coordinator', 'committee_viewer') then
    raise exception 'This role cannot be requested';
  end if;

  select s.id into target_session
  from public.sessions s
  join private.session_access_codes sac on sac.session_id = s.id
  where upper(sac.access_code) = upper(trim(p_access_code))
    and s.status in ('planning', 'active')
  limit 1;

  if target_session is null then
    raise exception 'Invalid or inactive session access code';
  end if;

  if exists (
    select 1 from public.access_assignments aa
    where aa.session_id = target_session
      and aa.user_id = (select auth.uid())
      and aa.active
  ) then
    raise exception 'You already have access to this session';
  end if;

  insert into public.access_requests(
    session_id,
    requested_by,
    requested_role,
    requested_scope_note,
    status
  ) values (
    target_session,
    (select auth.uid()),
    p_role,
    nullif(trim(p_scope_note), ''),
    'pending'
  )
  returning id into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_session_access(text, public.app_role, text) from public;
grant execute on function public.request_session_access(text, public.app_role, text) to authenticated;

create or replace function public.get_session_access_code(p_session_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result text;
begin
  if not private.has_session_role(
    p_session_id,
    array['logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Access code is restricted to access approvers';
  end if;

  select access_code into result
  from private.session_access_codes
  where session_id = p_session_id;

  return result;
end;
$$;

revoke all on function public.get_session_access_code(uuid) from public;
grant execute on function public.get_session_access_code(uuid) to authenticated;

-- Full access roster is visible to coordinators and top leaders; scoped roles see only their own assignment.
drop policy if exists "leaders read access roster" on public.access_assignments;
create policy "scoped access roster visibility" on public.access_assignments for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_session_wide_visibility(session_id)
  );

-- Profile visibility follows the same principle, with an extra reviewer path for pending requests.
drop policy if exists "users and reviewers read profiles" on public.profiles;
create policy "scoped profile visibility" on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.access_assignments subject
      where subject.user_id = profiles.user_id
        and subject.active
        and private.has_session_wide_visibility(subject.session_id)
    )
    or exists (
      select 1
      from public.access_requests ar
      where ar.requested_by = profiles.user_id
        and private.has_session_role(
          ar.session_id,
          array['logistics_admin','session_director']::public.app_role[]
        )
    )
  );
