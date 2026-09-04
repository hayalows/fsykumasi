-- Staff-linked website access and full Coordinator administration.
-- FSY assignments remain authoritative; website access becomes a separate lifecycle.

alter table public.leader_invites
  add column if not exists staff_id uuid references public.staff(id) on delete set null;
create index if not exists leader_invites_staff_status_idx
  on public.leader_invites(session_id, staff_id, status, created_at desc)
  where staff_id is not null;

create table if not exists public.staff_account_links (
  session_id uuid not null references public.sessions(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  access_enabled boolean not null default true,
  link_method text not null default 'invite',
  linked_by uuid references public.profiles(user_id) on delete set null,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, staff_id),
  unique (session_id, user_id),
  constraint staff_account_links_method_check check (link_method in ('invite','admin_link','legacy_unique_email'))
);
create index if not exists staff_account_links_user_idx
  on public.staff_account_links(user_id, session_id);

alter table public.staff_account_links enable row level security;
revoke all on table public.staff_account_links from anon, authenticated;
grant select on table public.staff_account_links to authenticated;

-- Coordinators are full session administrators in FSY Operations, alongside
-- logistical administrators and the session directing couple.
create or replace function private.effective_capabilities(target_session uuid, target_user uuid default null::uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
with subject as (select coalesce(target_user,(select auth.uid())) user_id), base as (
  select unnest(case
    when aa.role in ('session_director','logistics_admin','coordinator') then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'registration_view','registration_manage','identity_manage','arrival_manage',
      'staff_view','staff_manage','housing_view','housing_manage','housing_export',
      'food_view','food_manage','food_export','meal_attendance_view','meal_attendance_record',
      'wellness_status','wellness_private','wellness_manage','wellness_export',
      'inclusion_view','facilities_view','materials_view','financial_view','publicity_view',
      'reports_export','access_admin'
    ]::text[]
    when aa.role='assistant_coordinator' then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'meal_attendance_view','meal_attendance_record'
    ]::text[]
    else '{}'::text[] end) capability
  from public.access_assignments aa,subject s
  where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
), explicit_caps as (
  select unnest(aa.capabilities) capability
  from public.access_assignments aa,subject s
  where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
), team_caps as (
  select unnest(ot.capabilities) capability
  from public.team_memberships tm
  join public.operational_teams ot on ot.id=tm.team_id
  join subject s on s.user_id=tm.user_id
  where tm.session_id=target_session and tm.active and ot.active
)
select coalesce(array_agg(distinct capability order by capability),'{}'::text[])
from (select capability from base union all select capability from explicit_caps union all select capability from team_caps) caps
where capability is not null;
$$;
revoke all on function private.effective_capabilities(uuid, uuid) from public;
grant execute on function private.effective_capabilities(uuid, uuid) to authenticated;

create or replace function private.can_manage_access(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.access_assignments aa
    where aa.session_id=target_session
      and aa.user_id=(select auth.uid())
      and aa.active
      and aa.role in ('coordinator','logistics_admin','session_director')
  );
$$;

-- Kept for compatibility with existing RPCs. In the application, all three
-- roles are trusted Full Session Administrators.
create or replace function private.is_top_access_admin(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_access(target_session);
$$;

-- Access managers may inspect invite/link lifecycle state. Everyone else sees none.
drop policy if exists "session access managers read invites" on public.leader_invites;
drop policy if exists "full session admins read invites" on public.leader_invites;
create policy "full session admins read invites"
on public.leader_invites for select to authenticated
using (private.can_manage_access(session_id));

drop policy if exists "full session admins read staff account links" on public.staff_account_links;
create policy "full session admins read staff account links"
on public.staff_account_links for select to authenticated
using (private.can_manage_access(session_id));

do $$
begin
  alter publication supabase_realtime add table public.staff_account_links;
exception when duplicate_object then null;
end $$;

create or replace function private.staff_role_to_app_role(p_role text)
returns public.app_role
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'assistant_coordinator' then 'assistant_coordinator'::public.app_role
    when 'coordinator' then 'coordinator'::public.app_role
    when 'logistics_admin' then 'logistics_admin'::public.app_role
    when 'session_director' then 'session_director'::public.app_role
    else null::public.app_role
  end;
$$;

create or replace function private.full_session_admin_count(p_session_id uuid, p_exclude_user uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct aa.user_id)::integer
  from public.access_assignments aa
  where aa.session_id=p_session_id
    and aa.active
    and aa.role in ('coordinator','logistics_admin','session_director')
    and (p_exclude_user is null or aa.user_id<>p_exclude_user);
$$;

-- Keep a linked account synchronized to the current FSY assignment. Pending
-- staff invitations are also refreshed, so accepting an older link never grants
-- a stale role or stale company scope.
create or replace function private.sync_staff_login_access(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  link_row public.staff_account_links%rowtype;
  desired_role public.app_role;
  desired_companies uuid[] := '{}'::uuid[];
  current_is_full boolean := false;
  desired_is_full boolean := false;
begin
  select * into target from public.staff where id=p_staff_id;
  if target.id is null then return; end if;

  if target.is_current and target.registration_status='approved' then
    desired_role := private.staff_role_to_app_role(target.operational_role);
  else
    desired_role := null;
  end if;

  if desired_role='assistant_coordinator' then
    select coalesce(array_agg(sca.company_id order by sca.assigned_at, sca.company_id),'{}'::uuid[])
      into desired_companies
    from public.staff_company_assignments sca
    where sca.session_id=target.session_id and sca.staff_id=target.id;
  end if;

  if desired_role is null then
    update public.leader_invites
      set status='revoked', revoked_at=coalesce(revoked_at,now())
    where session_id=target.session_id and staff_id=target.id
      and purpose='onboarding' and status in ('pending','activating');
  else
    update public.leader_invites
      set role=desired_role,
          company_ids=case when desired_role='assistant_coordinator' then desired_companies else '{}'::uuid[] end,
          display_name=target.full_name
    where session_id=target.session_id and staff_id=target.id
      and purpose='onboarding' and status in ('pending','activating');
  end if;

  select * into link_row
  from public.staff_account_links sal
  where sal.session_id=target.session_id and sal.staff_id=target.id
  for update;
  if link_row.staff_id is null then return; end if;

  select exists(
    select 1 from public.access_assignments aa
    where aa.session_id=target.session_id and aa.user_id=link_row.user_id and aa.active
      and aa.role in ('coordinator','logistics_admin','session_director')
  ) into current_is_full;
  desired_is_full := link_row.access_enabled and desired_role in ('coordinator','logistics_admin','session_director');

  if current_is_full and not desired_is_full
     and private.full_session_admin_count(target.session_id,link_row.user_id)=0 then
    raise exception 'You cannot remove the only Full Session Administrator. Give another leader full access first.';
  end if;

  update public.access_assignments
    set active=false
  where session_id=target.session_id and user_id=link_row.user_id and active;

  if link_row.access_enabled and desired_role is not null then
    insert into public.access_assignments(session_id,user_id,role,company_ids,committee_scope,capabilities,active)
    values(
      target.session_id,
      link_row.user_id,
      desired_role,
      case when desired_role='assistant_coordinator' then desired_companies else '{}'::uuid[] end,
      '{}'::text[],
      '{}'::text[],
      true
    )
    on conflict(session_id,user_id,role) do update
      set company_ids=excluded.company_ids,
          committee_scope=excluded.committee_scope,
          capabilities=excluded.capabilities,
          active=true;
  end if;

  update public.staff_account_links
    set updated_at=now()
  where session_id=target.session_id and staff_id=target.id;
end;
$$;

-- Triggers make assignment edits authoritative even when they come from the
-- bulk assignment helper rather than an individual UI action.
create or replace function private.sync_staff_role_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_staff_login_access(new.id);
  return new;
end;
$$;

drop trigger if exists staff_sync_login_access on public.staff;
create trigger staff_sync_login_access
after update of operational_role, registration_status, is_current on public.staff
for each row
when (
  old.operational_role is distinct from new.operational_role
  or old.registration_status is distinct from new.registration_status
  or old.is_current is distinct from new.is_current
)
execute function private.sync_staff_role_trigger();

create or replace function private.sync_staff_company_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_staff_login_access(coalesce(new.staff_id,old.staff_id));
  return coalesce(new,old);
end;
$$;

drop trigger if exists staff_company_sync_login_access on public.staff_company_assignments;
create trigger staff_company_sync_login_access
after insert or update or delete on public.staff_company_assignments
for each row execute function private.sync_staff_company_trigger();

-- Replace the older email-matching synchronization. Email may verify an invite,
-- but the explicit staff_account_links relation is the ongoing identity link.
create or replace function public.set_staff_company_assignment(p_staff_id uuid, p_company_id uuid, p_assigned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_staff public.staff%rowtype;
  target_company public.companies%rowtype;
  existing_staff uuid;
  existing_name text;
  current_load integer;
  max_load integer;
  has_login_link boolean;
begin
  select * into target_staff from public.staff where id=p_staff_id for update;
  select * into target_company from public.companies where id=p_company_id for update;
  if target_staff.id is null or target_company.id is null or target_staff.session_id<>target_company.session_id then
    raise exception 'Staff member and company must belong to the same session';
  end if;
  if not private.can_manage_access(target_staff.session_id) then raise exception 'Administrative access is required'; end if;
  if target_staff.operational_role<>'assistant_coordinator' then raise exception 'Set this staff member as an Assistant Coordinator first'; end if;
  if not target_staff.is_current or target_staff.registration_status<>'approved' then raise exception 'Only current approved Assistant Coordinators can be assigned'; end if;

  if p_assigned then
    select sca.staff_id into existing_staff
    from public.staff_company_assignments sca
    where sca.session_id=target_staff.session_id and sca.company_id=target_company.id limit 1;
    if existing_staff is not null and existing_staff<>target_staff.id then
      select full_name into existing_name from public.staff where id=existing_staff;
      raise exception 'This company is already supervised by %',coalesce(existing_name,'another Assistant Coordinator');
    end if;
    select count(*) into current_load from public.staff_company_assignments sca
      where sca.session_id=target_staff.session_id and sca.staff_id=target_staff.id;
    select coalesce(s.companies_per_assistant_coordinator,4) into max_load
      from public.session_structure_settings s where s.session_id=target_staff.session_id;
    max_load:=coalesce(max_load,4);
    if existing_staff is null and current_load>=max_load then
      raise exception 'This Assistant Coordinator already supervises the configured maximum of % companies',max_load;
    end if;
    insert into public.staff_company_assignments(session_id,staff_id,company_id,assigned_by)
    values(target_staff.session_id,target_staff.id,target_company.id,(select auth.uid()))
    on conflict(staff_id,company_id) do nothing;
  else
    delete from public.staff_company_assignments where staff_id=target_staff.id and company_id=target_company.id;
  end if;

  update public.staff s set assigned_company_id=(
    select sca.company_id from public.staff_company_assignments sca
    where sca.staff_id=s.id order by sca.assigned_at,sca.company_id limit 1
  ) where s.id=target_staff.id;

  select exists(select 1 from public.staff_account_links sal where sal.session_id=target_staff.session_id and sal.staff_id=target_staff.id)
    into has_login_link;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target_staff.session_id,(select auth.uid()),
    case when p_assigned then 'assistant_coordinator_company_assigned' else 'assistant_coordinator_company_unassigned' end,
    'company',target_company.id::text,
    jsonb_build_object('staff_id',target_staff.id,'login_scope_synced',has_login_link));
end;
$$;
revoke all on function public.set_staff_company_assignment(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_staff_company_assignment(uuid,uuid,boolean) to authenticated;

-- Directory used by both Assignments and Website Access. No confidential staff
-- health/contact detail other than the chosen account email is exposed.
create or replace function public.get_staff_access_directory(p_session_id uuid)
returns table(
  staff_id uuid,
  display_name text,
  operational_role text,
  email text,
  company_ids uuid[],
  company_names text[],
  user_id uuid,
  account_email text,
  access_enabled boolean,
  access_state text,
  invite_id uuid,
  invite_expires_at timestamptz,
  account_role public.app_role
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Website access administration required'; end if;
  return query
  select
    s.id,
    s.full_name,
    s.operational_role,
    coalesce(nullif(trim(spd.email),''),nullif(trim(s.email),'')),
    coalesce(scope.company_ids,'{}'::uuid[]),
    coalesce(scope.company_names,'{}'::text[]),
    sal.user_id,
    p.email,
    coalesce(sal.access_enabled,false),
    case
      when sal.staff_id is not null and not sal.access_enabled then 'disabled'
      when sal.staff_id is not null and aa.id is not null then 'active'
      when pending.id is not null then 'invited'
      else 'not_enabled'
    end,
    pending.id,
    pending.expires_at,
    aa.role
  from public.staff s
  left join public.staff_private_details spd on spd.staff_id=s.id
  left join lateral (
    select
      coalesce(array_agg(sca.company_id order by c.operational_number nulls last,c.name),'{}'::uuid[]) company_ids,
      coalesce(array_agg(coalesce(nullif(c.custom_name,''),c.name) order by c.operational_number nulls last,c.name),'{}'::text[]) company_names
    from public.staff_company_assignments sca
    join public.companies c on c.id=sca.company_id
    where sca.session_id=p_session_id and sca.staff_id=s.id
  ) scope on true
  left join public.staff_account_links sal on sal.session_id=p_session_id and sal.staff_id=s.id
  left join public.profiles p on p.user_id=sal.user_id
  left join lateral (
    select a.id,a.role
    from public.access_assignments a
    where a.session_id=p_session_id and a.user_id=sal.user_id and a.active
    order by a.created_at desc limit 1
  ) aa on true
  left join lateral (
    select li.id,li.expires_at
    from public.leader_invites li
    where li.session_id=p_session_id and li.staff_id=s.id
      and li.purpose='onboarding' and li.status in ('pending','activating') and li.expires_at>now()
    order by li.created_at desc limit 1
  ) pending on true
  where s.session_id=p_session_id
    and s.is_current
    and s.registration_status='approved'
    and private.staff_role_to_app_role(s.operational_role) is not null
  order by
    case s.operational_role when 'session_director' then 1 when 'coordinator' then 2 when 'logistics_admin' then 3 when 'assistant_coordinator' then 4 else 9 end,
    lower(s.full_name),s.id;
end;
$$;
revoke all on function public.get_staff_access_directory(uuid) from public, anon;
grant execute on function public.get_staff_access_directory(uuid) to authenticated;

create or replace function public.create_staff_leader_invite(p_staff_id uuid, p_email text default null)
returns table(invite_id uuid, invite_code text, expires_at timestamptz, existing_account boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  desired_role public.app_role;
  desired_companies uuid[] := '{}'::uuid[];
  normalized_email text;
  raw_code text;
  formatted_code text;
  new_id uuid;
  new_expiry timestamptz := now()+interval '7 days';
  account_exists boolean := false;
begin
  select * into target from public.staff where id=p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Your account cannot give website access'; end if;
  if not target.is_current or target.registration_status<>'approved' then raise exception 'Only current approved staff can receive website access'; end if;
  desired_role:=private.staff_role_to_app_role(target.operational_role);
  if desired_role is null then raise exception 'Assign an account-enabled FSY role first'; end if;

  if exists(select 1 from public.staff_account_links sal where sal.session_id=target.session_id and sal.staff_id=target.id) then
    if exists(select 1 from public.staff_account_links sal where sal.session_id=target.session_id and sal.staff_id=target.id and sal.access_enabled) then
      raise exception 'Website access is already linked for this staff member';
    end if;
    raise exception 'This staff member already has an account. Re-enable website access instead of creating another invite.';
  end if;

  if desired_role='assistant_coordinator' then
    select coalesce(array_agg(sca.company_id order by sca.assigned_at,sca.company_id),'{}'::uuid[])
      into desired_companies
    from public.staff_company_assignments sca
    where sca.session_id=target.session_id and sca.staff_id=target.id;
    if coalesce(array_length(desired_companies,1),0)=0 then
      raise exception 'Assign at least one company before giving this Assistant Coordinator website access';
    end if;
  end if;

  select lower(trim(coalesce(nullif(p_email,''),nullif(spd.email,''),nullif(target.email,''))))
    into normalized_email
  from (select 1) one
  left join public.staff_private_details spd on spd.staff_id=target.id;
  if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address for this leader';
  end if;

  update public.staff set email=normalized_email where id=target.id;
  insert into public.staff_private_details(staff_id,session_id,email)
  values(target.id,target.session_id,normalized_email)
  on conflict(staff_id) do update set email=excluded.email,updated_at=now();

  select exists(select 1 from public.profiles p where lower(trim(coalesce(p.email,'')))=normalized_email)
    into account_exists;

  update public.leader_invites set status='revoked',revoked_at=now()
  where session_id=target.session_id and purpose='onboarding'
    and status in ('pending','activating')
    and (staff_id=target.id or lower(email)=normalized_email);

  raw_code:=upper(encode(extensions.gen_random_bytes(12),'hex'));
  formatted_code:='FSY-'||substr(raw_code,1,4)||'-'||substr(raw_code,5,4)||'-'||substr(raw_code,9,4)
    ||'-'||substr(raw_code,13,4)||'-'||substr(raw_code,17,4)||'-'||substr(raw_code,21,4);
  insert into public.leader_invites(
    session_id,staff_id,email,display_name,role,company_ids,committee_scope,purpose,code_hash,created_by,expires_at
  ) values(
    target.session_id,target.id,normalized_email,target.full_name,desired_role,
    case when desired_role='assistant_coordinator' then desired_companies else '{}'::uuid[] end,
    '{}'::text[],'onboarding',
    encode(extensions.digest(replace(upper(formatted_code),'-',''),'sha256'),'hex'),
    (select auth.uid()),new_expiry
  ) returning id into new_id;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target.session_id,(select auth.uid()),'staff_website_access_invited','staff',target.id::text,
    jsonb_build_object('invite_id',new_id,'role',desired_role,'existing_account',account_exists));
  return query select new_id,formatted_code,new_expiry,account_exists;
end;
$$;
revoke all on function public.create_staff_leader_invite(uuid,text) from public, anon;
grant execute on function public.create_staff_leader_invite(uuid,text) to authenticated;

create or replace function public.set_staff_website_access(p_staff_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.staff%rowtype; link_row public.staff_account_links%rowtype;
begin
  select * into target from public.staff where id=p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Your account cannot manage website access'; end if;
  select * into link_row from public.staff_account_links sal
    where sal.session_id=target.session_id and sal.staff_id=target.id for update;
  if link_row.staff_id is null then raise exception 'This staff member does not have a linked account yet'; end if;
  if p_enabled and (not target.is_current or target.registration_status<>'approved' or private.staff_role_to_app_role(target.operational_role) is null) then
    raise exception 'This staff member needs a current approved account-enabled FSY assignment before access can be enabled';
  end if;
  update public.staff_account_links set access_enabled=p_enabled,updated_at=now()
    where session_id=target.session_id and staff_id=target.id;
  perform private.sync_staff_login_access(target.id);
  if not p_enabled then
    update public.leader_invites set status='revoked',revoked_at=coalesce(revoked_at,now())
    where session_id=target.session_id and staff_id=target.id and purpose='onboarding' and status in ('pending','activating');
  end if;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target.session_id,(select auth.uid()),case when p_enabled then 'staff_website_access_enabled' else 'staff_website_access_disabled' end,
    'staff',target.id::text,jsonb_build_object('user_id',link_row.user_id));
end;
$$;
revoke all on function public.set_staff_website_access(uuid,boolean) from public, anon;
grant execute on function public.set_staff_website_access(uuid,boolean) to authenticated;

-- Allows full-session administrators to add a missing leadership identity first;
-- website access remains a separate follow-up action.
create or replace function public.create_manual_staff_leader(
  p_session_id uuid,
  p_display_name text,
  p_email text default null,
  p_role text default 'assistant_coordinator'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text:=nullif(regexp_replace(trim(coalesce(p_display_name,'')),'\s+',' ','g'),'');
  normalized_email text:=nullif(lower(trim(coalesce(p_email,''))),'');
  new_id uuid;
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Your account cannot add session leaders'; end if;
  if normalized_name is null or length(normalized_name)<2 or length(normalized_name)>120 then raise exception 'Enter the leader''s full name'; end if;
  if p_role not in ('assistant_coordinator','coordinator','logistics_admin','session_director') then raise exception 'Choose an account-enabled FSY role'; end if;
  if normalized_email is not null and normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address or leave it blank'; end if;
  if normalized_email is not null and exists(
    select 1 from public.staff s left join public.staff_private_details spd on spd.staff_id=s.id
    where s.session_id=p_session_id and s.is_current
      and lower(trim(coalesce(spd.email,s.email,'')))=normalized_email
  ) then raise exception 'A current staff record already uses this email address'; end if;

  insert into public.staff(session_id,full_name,email,staff_role,registration_status,is_current,operational_role,source_kind)
  values(p_session_id,normalized_name,normalized_email,'Session leadership','approved',true,p_role,'on_site')
  returning id into new_id;
  if normalized_email is not null then
    insert into public.staff_private_details(staff_id,session_id,email)
    values(new_id,p_session_id,normalized_email)
    on conflict(staff_id) do update set email=excluded.email,updated_at=now();
  end if;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'manual_staff_leader_created','staff',new_id::text,
    jsonb_build_object('role',p_role,'website_access','not_enabled'));
  return new_id;
end;
$$;
revoke all on function public.create_manual_staff_leader(uuid,text,text,text) from public, anon;
grant execute on function public.create_manual_staff_leader(uuid,text,text,text) to authenticated;

-- Staff-aware invite redemption. Email verifies the claimant; the explicit link
-- becomes the durable identity relation, and current Assignments determine scope.
create or replace function public.claim_leader_invite_authenticated(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_row public.leader_invites%rowtype;
  normalized_code text:=replace(upper(trim(p_code)),'-','');
  caller_email text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select lower(coalesce(email,'')) into caller_email from public.profiles where user_id=(select auth.uid());
  select * into invite_row from public.leader_invites li
    where li.code_hash=encode(extensions.digest(normalized_code,'sha256'),'hex') and li.status='pending' limit 1;
  if invite_row.id is null or invite_row.expires_at<=now() or lower(invite_row.email)<>caller_email then
    raise exception 'This invite code is invalid, expired, or belongs to another email address';
  end if;

  if invite_row.purpose='onboarding' and invite_row.staff_id is not null then
    insert into public.staff_account_links(session_id,staff_id,user_id,access_enabled,link_method,linked_by)
    values(invite_row.session_id,invite_row.staff_id,(select auth.uid()),true,'invite',invite_row.created_by)
    on conflict(session_id,staff_id) do update
      set user_id=excluded.user_id,access_enabled=true,link_method='invite',linked_by=excluded.linked_by,updated_at=now();
    update public.profiles p set display_name=coalesce((select s.full_name from public.staff s where s.id=invite_row.staff_id),invite_row.display_name,p.display_name),updated_at=now()
      where p.user_id=(select auth.uid());
    perform private.sync_staff_login_access(invite_row.staff_id);
  else
    update public.access_assignments set active=false
      where session_id=invite_row.session_id and user_id=(select auth.uid()) and active;
    insert into public.access_assignments(session_id,user_id,role,company_ids,committee_scope,active)
    values(invite_row.session_id,(select auth.uid()),invite_row.role,invite_row.company_ids,invite_row.committee_scope,true)
    on conflict(session_id,user_id,role) do update set company_ids=excluded.company_ids,committee_scope=excluded.committee_scope,active=true;
    update public.profiles set display_name=coalesce(invite_row.display_name,display_name),updated_at=now()
      where user_id=(select auth.uid());
  end if;

  update public.leader_invites set status='activated',redeemed_by=(select auth.uid()),redeemed_at=now() where id=invite_row.id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(invite_row.session_id,(select auth.uid()),'leader_invite_claimed','leader_invite',invite_row.id::text,
    jsonb_build_object('role',invite_row.role,'staff_id',invite_row.staff_id));
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
declare invite_row public.leader_invites%rowtype;
begin
  select * into invite_row from public.leader_invites where id=p_invite_id for update;
  if invite_row.id is null or invite_row.status<>'activating' or invite_row.expires_at<=now() then raise exception 'Invite cannot be finalized'; end if;

  if invite_row.purpose='onboarding' and invite_row.staff_id is not null then
    insert into public.staff_account_links(session_id,staff_id,user_id,access_enabled,link_method,linked_by)
    values(invite_row.session_id,invite_row.staff_id,p_user_id,true,'invite',invite_row.created_by)
    on conflict(session_id,staff_id) do update
      set user_id=excluded.user_id,access_enabled=true,link_method='invite',linked_by=excluded.linked_by,updated_at=now();
    update public.profiles p set display_name=coalesce((select s.full_name from public.staff s where s.id=invite_row.staff_id),invite_row.display_name,p.display_name),email=lower(invite_row.email),updated_at=now()
      where p.user_id=p_user_id;
    perform private.sync_staff_login_access(invite_row.staff_id);
  else
    update public.access_assignments set active=false where session_id=invite_row.session_id and user_id=p_user_id and active;
    insert into public.access_assignments(session_id,user_id,role,company_ids,committee_scope,active)
    values(invite_row.session_id,p_user_id,invite_row.role,invite_row.company_ids,invite_row.committee_scope,true)
    on conflict(session_id,user_id,role) do update set company_ids=excluded.company_ids,committee_scope=excluded.committee_scope,active=true;
    update public.profiles set display_name=coalesce(invite_row.display_name,display_name),email=lower(invite_row.email),updated_at=now()
      where user_id=p_user_id;
  end if;

  update public.leader_invites set status='activated',redeemed_by=p_user_id,redeemed_at=now() where id=invite_row.id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(invite_row.session_id,p_user_id,'leader_invite_activated','leader_invite',invite_row.id::text,
    jsonb_build_object('role',invite_row.role,'purpose',invite_row.purpose,'staff_id',invite_row.staff_id));
  return invite_row.session_id;
end;
$$;
revoke all on function public.finalize_leader_invite(uuid,uuid) from public;
grant execute on function public.finalize_leader_invite(uuid,uuid) to service_role;

-- Generic invitations remain available for legacy/exceptional access, but a
-- Coordinator has the same invitation authority as the other full admins.
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
  normalized_email text:=lower(trim(p_email));
  normalized_name text:=nullif(regexp_replace(trim(coalesce(p_display_name,'')),'\s+',' ','g'),'');
  raw_code text; formatted_code text; new_id uuid; new_expiry timestamptz:=now()+interval '7 days';
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Your account cannot invite leaders'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
  if normalized_name is null or length(normalized_name)<2 or length(normalized_name)>80 then raise exception 'Enter the leader''s name'; end if;
  if p_role='assistant_coordinator' then
    if coalesce(array_length(p_company_ids,1),0)=0 then raise exception 'Select at least one company for an Assistant Coordinator'; end if;
    if exists(select 1 from unnest(p_company_ids) company_id where not exists(select 1 from public.companies c where c.id=company_id and c.session_id=p_session_id)) then raise exception 'One or more selected companies do not belong to this session'; end if;
  elsif p_role='committee_viewer' then
    if coalesce(array_length(p_committee_scope,1),0)=0 then raise exception 'Choose at least one FSY team responsibility'; end if;
  elsif p_role not in ('coordinator','logistics_admin','session_director') then raise exception 'Unsupported role'; end if;
  update public.leader_invites set status='revoked',revoked_at=now()
    where session_id=p_session_id and lower(email)=normalized_email and status in ('pending','activating') and purpose='onboarding';
  raw_code:=upper(encode(extensions.gen_random_bytes(12),'hex'));
  formatted_code:='FSY-'||substr(raw_code,1,4)||'-'||substr(raw_code,5,4)||'-'||substr(raw_code,9,4)
    ||'-'||substr(raw_code,13,4)||'-'||substr(raw_code,17,4)||'-'||substr(raw_code,21,4);
  insert into public.leader_invites(session_id,email,display_name,role,company_ids,committee_scope,purpose,code_hash,created_by,expires_at)
  values(p_session_id,normalized_email,normalized_name,p_role,
    case when p_role='assistant_coordinator' then coalesce(p_company_ids,'{}') else '{}'::uuid[] end,
    coalesce(p_committee_scope,'{}'),'onboarding',
    encode(extensions.digest(replace(upper(formatted_code),'-',''),'sha256'),'hex'),(select auth.uid()),new_expiry)
  returning id into new_id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'leader_invite_created','leader_invite',new_id::text,
    jsonb_build_object('email',normalized_email,'role',p_role,'purpose','onboarding'));
  return query select new_id,formatted_code,new_expiry;
end;
$$;
revoke all on function public.create_leader_invite(uuid,text,text,public.app_role,uuid[],text[]) from public;
grant execute on function public.create_leader_invite(uuid,text,text,public.app_role,uuid[],text[]) to authenticated;

-- Existing accounts that are explicitly linked to Staff are edited from
-- Assignments. This legacy RPC remains for committee/exception accounts.
create or replace function public.manage_leader_access(
  p_assignment_id uuid,
  p_role public.app_role,
  p_company_ids uuid[] default '{}',
  p_team_keys text[] default '{}',
  p_access_admin boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.access_assignments%rowtype;
  new_assignment_id uuid;
  normalized_team_keys text[]:=coalesce(p_team_keys,'{}');
  target_is_full boolean;
  new_is_full boolean;
begin
  select * into target from public.access_assignments where id=p_assignment_id and active for update;
  if target.id is null then raise exception 'Active access assignment not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Your account cannot manage leader access'; end if;
  if target.user_id=(select auth.uid()) then raise exception 'Use another authorized leader to change your own access'; end if;
  if exists(select 1 from public.staff_account_links sal where sal.session_id=target.session_id and sal.user_id=target.user_id) then
    raise exception 'This account is linked to Staff. Change the FSY role or companies from Assignments.';
  end if;
  if p_role='assistant_coordinator' then
    if coalesce(array_length(p_company_ids,1),0)=0 then raise exception 'Select at least one company for an Assistant Coordinator'; end if;
    if exists(select 1 from unnest(p_company_ids) cid where not exists(select 1 from public.companies c where c.id=cid and c.session_id=target.session_id)) then raise exception 'One or more companies do not belong to this session'; end if;
  end if;
  if p_role='committee_viewer' and coalesce(array_length(normalized_team_keys,1),0)=0 then raise exception 'Choose at least one team responsibility'; end if;
  if exists(select 1 from unnest(normalized_team_keys) tk where not exists(select 1 from public.operational_teams ot where ot.session_id=target.session_id and ot.team_key=tk and ot.active)) then raise exception 'One or more team assignments are invalid'; end if;

  target_is_full:=target.role in ('coordinator','logistics_admin','session_director');
  new_is_full:=p_role in ('coordinator','logistics_admin','session_director');
  if target_is_full and not new_is_full and private.full_session_admin_count(target.session_id,target.user_id)=0 then
    raise exception 'You cannot remove the only Full Session Administrator. Give another leader full access first.';
  end if;

  update public.access_assignments set active=false where session_id=target.session_id and user_id=target.user_id and active;
  insert into public.access_assignments(session_id,user_id,role,company_ids,committee_scope,capabilities,active)
  values(target.session_id,target.user_id,p_role,
    case when p_role='assistant_coordinator' then coalesce(p_company_ids,'{}') else '{}'::uuid[] end,
    coalesce((select array_agg(ot.display_name order by ot.display_name) from public.operational_teams ot where ot.session_id=target.session_id and ot.team_key=any(normalized_team_keys)),'{}'::text[]),
    case when p_access_admin and p_role='coordinator' then array['access_admin']::text[] else '{}'::text[] end,true)
  on conflict(session_id,user_id,role) do update
    set company_ids=excluded.company_ids,committee_scope=excluded.committee_scope,capabilities=excluded.capabilities,active=true
  returning id into new_assignment_id;
  update public.team_memberships set active=false,updated_at=now() where session_id=target.session_id and user_id=target.user_id and active;
  insert into public.team_memberships(session_id,team_id,user_id,active,assigned_by)
  select target.session_id,ot.id,target.user_id,true,(select auth.uid())
  from public.operational_teams ot where ot.session_id=target.session_id and ot.team_key=any(normalized_team_keys) and ot.active
  on conflict(session_id,team_id,user_id) do update set active=true,assigned_by=excluded.assigned_by,updated_at=now();
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target.session_id,(select auth.uid()),'leader_access_updated','access_assignment',new_assignment_id::text,
    jsonb_build_object('subject_user_id',target.user_id,'role',p_role,'company_ids',coalesce(p_company_ids,'{}'),'team_keys',normalized_team_keys));
  return new_assignment_id;
end;
$$;
revoke all on function public.manage_leader_access(uuid,public.app_role,uuid[],text[],boolean) from public, anon;
grant execute on function public.manage_leader_access(uuid,public.app_role,uuid[],text[],boolean) to authenticated;

-- Legacy self-service requests can also be reviewed by Coordinators now.
create or replace function public.review_access_request(
  p_request_id uuid,
  p_decision public.access_request_status,
  p_company_ids uuid[] default '{}',
  p_committee_scope text[] default '{}',
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.access_requests%rowtype;
  expected_company_count integer;
  valid_company_count integer;
begin
  select * into target from public.access_requests where id=p_request_id for update;
  if target.id is null then raise exception 'Access request not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Only a Full Session Administrator can review access'; end if;
  if target.status<>'pending' then raise exception 'This access request has already been reviewed'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  if p_decision='approved' and target.requested_role='assistant_coordinator' then
    expected_company_count:=cardinality(coalesce(p_company_ids,'{}'::uuid[]));
    if expected_company_count=0 then raise exception 'Assistant coordinators must be assigned at least one company'; end if;
    select count(*) into valid_company_count from public.companies c where c.session_id=target.session_id and c.id=any(coalesce(p_company_ids,'{}'::uuid[]));
    if valid_company_count<>expected_company_count then raise exception 'One or more selected companies do not belong to this session'; end if;
  end if;
  if p_decision='approved' and target.requested_role='committee_viewer' and cardinality(coalesce(p_committee_scope,'{}'::text[]))=0 then
    raise exception 'Committee viewers must be assigned at least one committee scope';
  end if;
  update public.access_requests set
    company_ids=case when target.requested_role='assistant_coordinator' and p_decision='approved' then coalesce(p_company_ids,'{}'::uuid[]) else '{}'::uuid[] end,
    committee_scope=case when target.requested_role='committee_viewer' and p_decision='approved' then array(select distinct trim(x.scope) from unnest(coalesce(p_committee_scope,'{}'::text[])) as x(scope) where trim(x.scope)<>'') else '{}'::text[] end,
    decision_note=nullif(trim(coalesce(p_note,'')),''),status=p_decision
  where id=p_request_id;
end;
$$;
revoke all on function public.review_access_request(uuid,public.access_request_status,uuid[],text[],text) from public, anon;
grant execute on function public.review_access_request(uuid,public.access_request_status,uuid[],text[],text) to authenticated;

-- Conservative one-time backfill: only exact, unique email + role matches become
-- explicit links. Ambiguous or unmatched existing accounts remain untouched.
with candidates as (
  select s.session_id,s.id staff_id,aa.user_id,
    row_number() over(partition by s.session_id,s.id order by aa.created_at desc) staff_rank,
    count(*) over(partition by s.session_id,s.id) staff_matches,
    count(*) over(partition by s.session_id,aa.user_id) user_matches
  from public.staff s
  left join public.staff_private_details spd on spd.staff_id=s.id
  join public.profiles p on lower(trim(coalesce(p.email,'')))=lower(trim(coalesce(spd.email,s.email,'')))
    and nullif(trim(coalesce(spd.email,s.email,'')),'') is not null
  join public.access_assignments aa on aa.session_id=s.session_id and aa.user_id=p.user_id and aa.active
  where s.is_current and s.registration_status='approved'
    and private.staff_role_to_app_role(s.operational_role)=aa.role
)
insert into public.staff_account_links(session_id,staff_id,user_id,access_enabled,link_method,linked_at,updated_at)
select session_id,staff_id,user_id,true,'legacy_unique_email',now(),now()
from candidates where staff_rank=1 and staff_matches=1 and user_matches=1
on conflict do nothing;
