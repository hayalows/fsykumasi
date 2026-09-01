-- Password-first authentication and administrator-issued leader invitations.
-- The invitation code is a one-time secret. Only a SHA-256 hash is stored.

create type public.leader_invite_status as enum ('pending', 'activating', 'activated', 'revoked', 'expired');
create type public.leader_invite_purpose as enum ('onboarding', 'recovery');

create table public.leader_invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  email text not null,
  display_name text,
  role public.app_role not null,
  company_ids uuid[] not null default '{}',
  committee_scope text[] not null default '{}',
  purpose public.leader_invite_purpose not null default 'onboarding',
  code_hash text not null unique,
  status public.leader_invite_status not null default 'pending',
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  redeemed_by uuid references public.profiles(user_id),
  redeemed_at timestamptz,
  revoked_at timestamptz,
  constraint leader_invites_email_not_blank check (length(trim(email)) > 3),
  constraint leader_invites_display_name_length check (display_name is null or length(trim(display_name)) between 2 and 80)
);

create index leader_invites_session_status_idx on public.leader_invites(session_id, status, created_at desc);
create index leader_invites_email_idx on public.leader_invites(lower(email));

alter table public.leader_invites enable row level security;

create policy "session access managers read invites"
on public.leader_invites for select to authenticated
using (
  exists (
    select 1 from public.access_assignments aa
    where aa.session_id = leader_invites.session_id
      and aa.user_id = (select auth.uid())
      and aa.active
      and aa.role in ('logistics_admin', 'session_director')
  )
);

revoke all on table public.leader_invites from anon, authenticated;
grant select on table public.leader_invites to authenticated;

create or replace function public.create_leader_invite(
  p_session_id uuid,
  p_email text,
  p_display_name text,
  p_role public.app_role,
  p_company_ids uuid[] default '{}',
  p_committee_scope text[] default '{}'
)
returns table(invite_id uuid, invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(p_email));
  normalized_name text := nullif(regexp_replace(trim(coalesce(p_display_name, '')), '\s+', ' ', 'g'), '');
  raw_code text;
  formatted_code text;
  new_id uuid;
  new_expiry timestamptz := now() + interval '7 days';
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.access_assignments aa
    where aa.session_id = p_session_id
      and aa.user_id = (select auth.uid())
      and aa.active
      and aa.role in ('logistics_admin', 'session_director')
  ) then
    raise exception 'Only logistical administrators or the session directing couple can invite leaders';
  end if;

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;

  if normalized_name is null or length(normalized_name) < 2 or length(normalized_name) > 80 then
    raise exception 'Enter the leader''s name';
  end if;

  if p_role = 'assistant_coordinator' then
    if coalesce(array_length(p_company_ids, 1), 0) = 0 then
      raise exception 'Select at least one company for an Assistant Coordinator';
    end if;
    if exists (
      select 1 from unnest(p_company_ids) company_id
      where not exists (
        select 1 from public.companies c
        where c.id = company_id and c.session_id = p_session_id
      )
    ) then
      raise exception 'One or more selected companies do not belong to this session';
    end if;
  elsif p_role = 'committee_viewer' then
    if coalesce(array_length(p_committee_scope, 1), 0) = 0 then
      raise exception 'Add at least one committee area';
    end if;
  elsif p_role not in ('coordinator', 'logistics_admin', 'session_director') then
    raise exception 'Unsupported role';
  end if;

  update public.leader_invites
  set status = 'revoked', revoked_at = now()
  where session_id = p_session_id
    and lower(email) = normalized_email
    and status in ('pending', 'activating')
    and purpose = 'onboarding';

  raw_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  formatted_code := 'FSY-' || substr(raw_code, 1, 4) || '-' || substr(raw_code, 5, 4) || '-' || substr(raw_code, 9, 4);

  insert into public.leader_invites(
    session_id, email, display_name, role, company_ids, committee_scope,
    purpose, code_hash, created_by, expires_at
  ) values (
    p_session_id,
    normalized_email,
    normalized_name,
    p_role,
    case when p_role = 'assistant_coordinator' then coalesce(p_company_ids, '{}') else '{}'::uuid[] end,
    case when p_role = 'committee_viewer' then coalesce(p_committee_scope, '{}') else '{}'::text[] end,
    'onboarding',
    encode(extensions.digest(replace(upper(formatted_code), '-', ''), 'sha256'), 'hex'),
    (select auth.uid()),
    new_expiry
  ) returning id into new_id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id,
    (select auth.uid()),
    'leader_invite_created',
    'leader_invite',
    new_id::text,
    jsonb_build_object('email', normalized_email, 'role', p_role, 'purpose', 'onboarding')
  );

  return query select new_id, formatted_code, new_expiry;
end;
$$;

revoke all on function public.create_leader_invite(uuid, text, text, public.app_role, uuid[], text[]) from public;
grant execute on function public.create_leader_invite(uuid, text, text, public.app_role, uuid[], text[]) to authenticated;

create or replace function public.revoke_leader_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session uuid;
begin
  select session_id into target_session from public.leader_invites where id = p_invite_id;
  if target_session is null then raise exception 'Invite not found'; end if;

  if not exists (
    select 1 from public.access_assignments aa
    where aa.session_id = target_session
      and aa.user_id = (select auth.uid())
      and aa.active
      and aa.role in ('logistics_admin', 'session_director')
  ) then
    raise exception 'Not authorized to revoke this invite';
  end if;

  update public.leader_invites
  set status = 'revoked', revoked_at = now()
  where id = p_invite_id and status in ('pending', 'activating');

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id)
  values (target_session, (select auth.uid()), 'leader_invite_revoked', 'leader_invite', p_invite_id::text);
end;
$$;

revoke all on function public.revoke_leader_invite(uuid) from public;
grant execute on function public.revoke_leader_invite(uuid) to authenticated;

create or replace function public.claim_leader_invite_authenticated(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_row public.leader_invites%rowtype;
  normalized_code text := replace(upper(trim(p_code)), '-', '');
  caller_email text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  select lower(coalesce(email, '')) into caller_email from public.profiles where user_id = (select auth.uid());

  select * into invite_row
  from public.leader_invites li
  where li.code_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex')
    and li.status = 'pending'
  limit 1;

  if invite_row.id is null or invite_row.expires_at <= now() or lower(invite_row.email) <> caller_email then
    raise exception 'This invite code is invalid, expired, or belongs to another email address';
  end if;

  update public.access_assignments
  set active = false
  where session_id = invite_row.session_id
    and user_id = (select auth.uid())
    and active;

  insert into public.access_assignments(session_id, user_id, role, company_ids, committee_scope, active)
  values (invite_row.session_id, (select auth.uid()), invite_row.role, invite_row.company_ids, invite_row.committee_scope, true)
  on conflict (session_id, user_id, role)
  do update set company_ids = excluded.company_ids, committee_scope = excluded.committee_scope, active = true;

  update public.profiles
  set display_name = coalesce(invite_row.display_name, display_name), updated_at = now()
  where user_id = (select auth.uid());

  update public.leader_invites
  set status = 'activated', redeemed_by = (select auth.uid()), redeemed_at = now()
  where id = invite_row.id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (invite_row.session_id, (select auth.uid()), 'leader_invite_claimed', 'leader_invite', invite_row.id::text, jsonb_build_object('role', invite_row.role));

  return invite_row.session_id;
end;
$$;

revoke all on function public.claim_leader_invite_authenticated(text) from public;
grant execute on function public.claim_leader_invite_authenticated(text) to authenticated;

create or replace function public.finalize_leader_invite(p_invite_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_row public.leader_invites%rowtype;
begin
  select * into invite_row from public.leader_invites where id = p_invite_id for update;
  if invite_row.id is null or invite_row.status <> 'activating' or invite_row.expires_at <= now() then
    raise exception 'Invite cannot be finalized';
  end if;

  update public.access_assignments
  set active = false
  where session_id = invite_row.session_id and user_id = p_user_id and active;

  insert into public.access_assignments(session_id, user_id, role, company_ids, committee_scope, active)
  values (invite_row.session_id, p_user_id, invite_row.role, invite_row.company_ids, invite_row.committee_scope, true)
  on conflict (session_id, user_id, role)
  do update set company_ids = excluded.company_ids, committee_scope = excluded.committee_scope, active = true;

  update public.profiles
  set display_name = coalesce(invite_row.display_name, display_name), email = lower(invite_row.email), updated_at = now()
  where user_id = p_user_id;

  update public.leader_invites
  set status = 'activated', redeemed_by = p_user_id, redeemed_at = now()
  where id = invite_row.id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (invite_row.session_id, p_user_id, 'leader_invite_activated', 'leader_invite', invite_row.id::text, jsonb_build_object('role', invite_row.role, 'purpose', invite_row.purpose));

  return invite_row.session_id;
end;
$$;

revoke all on function public.finalize_leader_invite(uuid, uuid) from public;
grant execute on function public.finalize_leader_invite(uuid, uuid) to service_role;

do $$
begin
  alter publication supabase_realtime add table public.leader_invites;
exception when duplicate_object then null;
end $$;
