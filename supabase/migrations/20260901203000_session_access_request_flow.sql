-- Self-service access request flow for authenticated leaders.
-- Users without session access can request a lower role using a session access code.
-- No participant data becomes visible until a logistics administrator or session director approves.

alter table public.sessions
  add column if not exists access_code text;

update public.sessions
set access_code = upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10))
where access_code is null;

alter table public.sessions
  alter column access_code set not null;

create unique index if not exists sessions_access_code_uidx
  on public.sessions(access_code);

alter table public.profiles
  add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.user_id and p.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(user_id, display_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(new.email, ''), 'FSY leader'),
    new.email
  )
  on conflict (user_id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        display_name = case
          when public.profiles.display_name = 'FSY leader' then excluded.display_name
          else public.profiles.display_name
        end,
        updated_at = now();
  return new;
end;
$$;

alter table public.access_requests
  add column if not exists requested_scope_note text;

drop policy if exists "users read own profile" on public.profiles;
create policy "users and reviewers read profiles" on public.profiles for select to authenticated
  using (
    profiles.user_id = (select auth.uid())
    or exists (
      select 1
      from public.access_assignments viewer
      join public.access_assignments subject on subject.session_id = viewer.session_id
      where viewer.user_id = (select auth.uid())
        and viewer.active
        and subject.user_id = profiles.user_id
    )
    or exists (
      select 1
      from public.access_requests ar
      join public.access_assignments reviewer on reviewer.session_id = ar.session_id
      where ar.requested_by = profiles.user_id
        and reviewer.user_id = (select auth.uid())
        and reviewer.active
        and reviewer.role in ('logistics_admin', 'session_director')
    )
  );

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
  where upper(s.access_code) = upper(trim(p_access_code))
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

create or replace function public.my_access_state()
returns table (
  session_id uuid,
  session_name text,
  session_status text,
  role public.app_role,
  active boolean,
  request_status public.access_request_status,
  requested_role public.app_role,
  requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select
      s.id as session_id,
      s.name as session_name,
      s.status as session_status,
      aa.role as role,
      aa.active as active,
      null::public.access_request_status as request_status,
      null::public.app_role as requested_role,
      null::timestamptz as requested_at
    from public.access_assignments aa
    join public.sessions s on s.id = aa.session_id
    where aa.user_id = (select auth.uid()) and aa.active

    union all

    select
      s.id as session_id,
      s.name as session_name,
      s.status as session_status,
      null::public.app_role as role,
      false as active,
      ar.status as request_status,
      ar.requested_role as requested_role,
      ar.requested_at as requested_at
    from public.access_requests ar
    join public.sessions s on s.id = ar.session_id
    where ar.requested_by = (select auth.uid())
      and ar.status = 'pending'
      and not exists (
        select 1 from public.access_assignments aa2
        where aa2.session_id = ar.session_id
          and aa2.user_id = (select auth.uid())
          and aa2.active
      )
  ) access_state
  order by active desc, requested_at desc nulls last;
$$;

revoke all on function public.my_access_state() from public;
grant execute on function public.my_access_state() to authenticated;
