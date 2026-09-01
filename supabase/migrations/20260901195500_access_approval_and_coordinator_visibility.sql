-- Access approval workflow and updated coordinator visibility.
-- Coordinators have whole-session operational visibility.
-- Only logistical administrators and session directors may approve/reject lower-role access.

create type public.access_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  requested_by uuid not null references public.profiles(user_id) on delete cascade,
  requested_role public.app_role not null,
  company_ids uuid[] not null default '{}',
  committee_scope text[] not null default '{}',
  status public.access_request_status not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(user_id),
  reviewed_at timestamptz,
  decision_note text,
  constraint access_requests_lower_roles_only
    check (requested_role in ('assistant_coordinator', 'coordinator', 'committee_viewer'))
);

create unique index access_requests_one_pending_per_user_session_idx
  on public.access_requests(session_id, requested_by)
  where status = 'pending';
create index access_requests_session_status_idx
  on public.access_requests(session_id, status, requested_at desc);

alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon, authenticated;
grant select, insert, update on public.access_requests to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(user_id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(new.email, ''), 'FSY leader')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function private.has_session_wide_visibility(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_assignments aa
    where aa.session_id = target_session
      and aa.user_id = (select auth.uid())
      and aa.active
      and aa.role in ('coordinator', 'logistics_admin', 'session_director')
  );
$$;

revoke all on function private.has_session_wide_visibility(uuid) from public;
grant execute on function private.has_session_wide_visibility(uuid) to authenticated;

create or replace function private.can_access_company(target_session uuid, target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_assignments aa
    where aa.session_id = target_session
      and aa.user_id = (select auth.uid())
      and aa.active
      and (
        aa.role in ('coordinator', 'logistics_admin', 'session_director')
        or target_company = any(aa.company_ids)
      )
  );
$$;

drop policy if exists "members read scoped participants" on public.participants;
create policy "members read scoped participants" on public.participants for select to authenticated
  using (
    private.has_session_wide_visibility(session_id)
    or exists (
      select 1
      from public.counselor_groups g
      where g.id = group_id
        and private.can_access_company(session_id, g.company_id)
    )
  );

drop policy if exists "members read scoped checkins" on public.check_ins;
create policy "members read scoped checkins" on public.check_ins for select to authenticated
  using (
    private.has_session_wide_visibility(session_id)
    or exists (
      select 1
      from public.participants p
      join public.counselor_groups g on g.id = p.group_id
      where p.id = participant_id
        and private.can_access_company(session_id, g.company_id)
    )
  );

drop policy if exists "top leaders read imports" on public.import_batches;
create policy "session-wide leaders read imports" on public.import_batches for select to authenticated
  using (private.has_session_wide_visibility(session_id));

grant select on public.audit_events to authenticated;
create policy "session-wide leaders read audit" on public.audit_events for select to authenticated
  using (private.has_session_wide_visibility(session_id));

create policy "requester and session-wide leaders read access requests"
  on public.access_requests for select to authenticated
  using (
    requested_by = (select auth.uid())
    or private.has_session_wide_visibility(session_id)
  );

create policy "users submit own access request"
  on public.access_requests for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and requested_role in ('assistant_coordinator', 'coordinator', 'committee_viewer')
    and status = 'pending'
  );

create policy "top leaders review access requests"
  on public.access_requests for update to authenticated
  using (
    private.has_session_role(
      session_id,
      array['logistics_admin', 'session_director']::public.app_role[]
    )
  )
  with check (
    private.has_session_role(
      session_id,
      array['logistics_admin', 'session_director']::public.app_role[]
    )
  );

create or replace function private.apply_approved_access_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if new.reviewed_by is null then
      new.reviewed_by := (select auth.uid());
    end if;
    if new.reviewed_at is null then
      new.reviewed_at := now();
    end if;

    insert into public.access_assignments(
      session_id,
      user_id,
      role,
      company_ids,
      committee_scope,
      active
    )
    values (
      new.session_id,
      new.requested_by,
      new.requested_role,
      new.company_ids,
      new.committee_scope,
      true
    )
    on conflict (session_id, user_id, role)
    do update set
      company_ids = excluded.company_ids,
      committee_scope = excluded.committee_scope,
      active = true;
  elsif new.status in ('rejected', 'cancelled') and old.status is distinct from new.status then
    if new.reviewed_by is null then
      new.reviewed_by := (select auth.uid());
    end if;
    if new.reviewed_at is null then
      new.reviewed_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_approved_access_request() from public;

drop trigger if exists access_request_review_trigger on public.access_requests;
create trigger access_request_review_trigger
  before update of status on public.access_requests
  for each row execute function private.apply_approved_access_request();

do $$ begin
  alter publication supabase_realtime add table public.access_requests;
exception when duplicate_object then null;
end $$;
