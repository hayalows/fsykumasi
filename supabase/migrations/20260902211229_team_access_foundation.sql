-- Canonical FSY operational teams and post-onboarding access management.
alter table public.participants
  add column if not exists attendance_status text not null default 'expected',
  add column if not exists attendance_note text,
  add column if not exists attendance_updated_by uuid references public.profiles(user_id) on delete set null,
  add column if not exists attendance_updated_at timestamptz;
alter table public.participants drop constraint if exists participants_attendance_status_check;
alter table public.participants add constraint participants_attendance_status_check check (attendance_status in ('expected','confirmed_not_attending'));

create table if not exists public.operational_teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  team_key text not null,
  display_name text not null,
  description text not null default '',
  preset_key text,
  capabilities text[] not null default '{}',
  active boolean not null default true,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id,team_key),
  constraint operational_teams_key_check check (team_key ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  constraint operational_teams_capabilities_check check (capabilities <@ array[
    'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
    'housing_view','housing_manage','housing_export','wellness_status','wellness_private','wellness_manage',
    'food_view','food_manage','food_export','registration_view','registration_manage','staff_view','staff_manage',
    'inclusion_view','facilities_view','materials_view','financial_view','publicity_view','reports_export'
  ]::text[])
);
create table if not exists public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  team_id uuid not null references public.operational_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  active boolean not null default true,
  assigned_by uuid references public.profiles(user_id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id,team_id,user_id)
);
create index if not exists operational_teams_session_active_idx on public.operational_teams(session_id,active,team_key);
create index if not exists team_memberships_user_session_idx on public.team_memberships(user_id,session_id) where active;
create index if not exists team_memberships_team_active_idx on public.team_memberships(team_id,active);

create or replace function private.seed_default_operational_teams(target_session uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.operational_teams(session_id,team_key,display_name,description,preset_key,capabilities) values
 (target_session,'housing','Housing','Room assignments, occupancy, keys, and housing changes.','housing',array['people_lookup','groups_view','housing_view','housing_manage','housing_export','reports_export']),
 (target_session,'wellness','Wellness','Health support and confidential wellness encounters.','wellness',array['people_lookup','wellness_status','wellness_private','wellness_manage']),
 (target_session,'food','Food','Meal planning and dietary accommodation operations.','food',array['people_lookup','groups_view','food_view','food_manage','food_export','reports_export']),
 (target_session,'registration','Registration','Registration review, on-site additions, and delegated check-in.','registration',array['people_lookup','groups_view','registration_view','registration_manage','checkin_record','reports_export']),
 (target_session,'staff','Staff Administration','Staffing, assignments, and staff readiness.','staff',array['staff_view','staff_manage','groups_view','reports_export']),
 (target_session,'inclusion','Inclusion','Accommodation and accessibility coordination.','inclusion',array['people_lookup','inclusion_view','housing_view']),
 (target_session,'facilities','Facilities','Venue, rooms, spaces, and facility coordination.','facilities',array['facilities_view','housing_view']),
 (target_session,'materials','Materials','Materials preparation and distribution.','materials',array['materials_view']),
 (target_session,'financial','Financial','FSY financial administration.','financial',array['financial_view']),
 (target_session,'publicity','Publicity','Approved session publicity and communications.','publicity',array['publicity_view']),
 (target_session,'logistics','Logistical Administration','Cross-functional logistical coordination without confidential Wellness narrative.','logistics',array['people_lookup','groups_view','checkin_record','headcount_view','headcount_record','housing_view','housing_manage','housing_export','food_view','food_manage','food_export','registration_view','registration_manage','staff_view','staff_manage','inclusion_view','facilities_view','materials_view','reports_export'])
 on conflict(session_id,team_key) do nothing;
end; $$;
select private.seed_default_operational_teams(id) from public.sessions;
create or replace function private.seed_teams_after_session_insert() returns trigger language plpgsql security definer set search_path='' as $$ begin perform private.seed_default_operational_teams(new.id); return new; end; $$;
drop trigger if exists sessions_seed_operational_teams on public.sessions;
create trigger sessions_seed_operational_teams after insert on public.sessions for each row execute function private.seed_teams_after_session_insert();

create or replace function private.has_team_capability(target_session uuid,capability text,target_user uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.team_memberships tm join public.operational_teams ot on ot.id=tm.team_id where tm.session_id=target_session and tm.user_id=coalesce(target_user,(select auth.uid())) and tm.active and ot.active and capability=any(ot.capabilities));
$$;
create or replace function private.effective_capabilities(target_session uuid,target_user uuid default null)
returns text[] language sql stable security definer set search_path='' as $$
 with subject as (select coalesce(target_user,(select auth.uid())) user_id), base as (
  select unnest(case
   when aa.role='session_director' then array['people_lookup','groups_view','checkin_record','headcount_view','headcount_record','registration_view','staff_view','reports_export']::text[]
   when aa.role='logistics_admin' then array['people_lookup','groups_view','checkin_record','headcount_view','headcount_record','registration_view','registration_manage','staff_view','staff_manage','housing_view','housing_manage','housing_export','food_view','food_manage','food_export','inclusion_view','facilities_view','materials_view','reports_export']::text[]
   when aa.role='coordinator' then array['people_lookup','groups_view','checkin_record','headcount_view','headcount_record','registration_view','reports_export']::text[]
   when aa.role='assistant_coordinator' then array['people_lookup','groups_view','checkin_record','headcount_view','headcount_record']::text[]
   else '{}'::text[] end) capability
  from public.access_assignments aa,subject s where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
 ), explicit_caps as (
  select unnest(aa.capabilities) capability from public.access_assignments aa,subject s where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
 ), team_caps as (
  select unnest(ot.capabilities) capability from public.team_memberships tm join public.operational_teams ot on ot.id=tm.team_id join subject s on s.user_id=tm.user_id where tm.session_id=target_session and tm.active and ot.active
 )
 select coalesce(array_agg(distinct capability order by capability),'{}'::text[]) from (select capability from base union all select capability from explicit_caps union all select capability from team_caps) caps where capability is not null;
$$;
create or replace function private.has_capability(target_session uuid,capability text,target_user uuid default null)
returns boolean language sql stable security definer set search_path='' as $$ select capability=any(private.effective_capabilities(target_session,target_user)); $$;

create or replace function public.my_access_state()
returns table(session_id uuid,session_name text,session_status text,role public.app_role,active boolean,capabilities text[],request_status public.access_request_status,requested_role public.app_role,requested_at timestamptz)
language sql stable security definer set search_path='' as $$
 select * from (
  select s.id as session_id,s.name as session_name,s.status as session_status,aa.role as role,aa.active as active,private.effective_capabilities(s.id,(select auth.uid())) as capabilities,null::public.access_request_status as request_status,null::public.app_role as requested_role,null::timestamptz as requested_at
  from public.access_assignments aa join public.sessions s on s.id=aa.session_id where aa.user_id=(select auth.uid()) and aa.active
  union all
  select s.id as session_id,s.name as session_name,s.status as session_status,null::public.app_role as role,false as active,'{}'::text[] as capabilities,ar.status as request_status,ar.requested_role as requested_role,ar.requested_at as requested_at
  from public.access_requests ar join public.sessions s on s.id=ar.session_id
  where ar.requested_by=(select auth.uid()) and ar.status='pending'
    and not exists(select 1 from public.access_assignments aa2 where aa2.session_id=ar.session_id and aa2.user_id=(select auth.uid()) and aa2.active)
 ) access_state order by access_state.active desc,access_state.requested_at desc nulls last;
$$;
create or replace function public.get_session_team_catalog(p_session_id uuid)
returns table(team_id uuid,team_key text,display_name text,description text,preset_key text,capabilities text[],active boolean)
language sql stable security definer set search_path='' as $$
 select ot.id,ot.team_key,ot.display_name,ot.description,ot.preset_key,ot.capabilities,ot.active from public.operational_teams ot where ot.session_id=p_session_id and private.has_session_access(p_session_id) order by ot.display_name;
$$;
create or replace function public.get_access_roster_v2(p_session_id uuid)
returns table(assignment_id uuid,user_id uuid,display_name text,email text,role public.app_role,company_ids uuid[],committee_scope text[],capabilities text[],team_keys text[],team_names text[],active boolean)
language sql stable security definer set search_path='' as $$
 select aa.id,aa.user_id,p.display_name,p.email,aa.role,aa.company_ids,aa.committee_scope,private.effective_capabilities(p_session_id,aa.user_id),
   coalesce((select array_agg(ot.team_key order by ot.display_name) from public.team_memberships tm join public.operational_teams ot on ot.id=tm.team_id where tm.session_id=p_session_id and tm.user_id=aa.user_id and tm.active and ot.active),'{}'::text[]),
   coalesce((select array_agg(ot.display_name order by ot.display_name) from public.team_memberships tm join public.operational_teams ot on ot.id=tm.team_id where tm.session_id=p_session_id and tm.user_id=aa.user_id and tm.active and ot.active),'{}'::text[]),aa.active
 from public.access_assignments aa join public.profiles p on p.user_id=aa.user_id where aa.session_id=p_session_id and aa.active and private.has_session_access(p_session_id) order by p.display_name;
$$;
create or replace function public.manage_leader_access(p_assignment_id uuid,p_role public.app_role,p_company_ids uuid[] default '{}',p_team_keys text[] default '{}',p_access_admin boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare target public.access_assignments%rowtype; caller_top boolean; caller_manage boolean; target_is_elevated boolean; new_assignment_id uuid; normalized_team_keys text[]:=coalesce(p_team_keys,'{}');
begin
 select * into target from public.access_assignments where id=p_assignment_id and active for update;
 if target.id is null then raise exception 'Active access assignment not found'; end if;
 caller_top:=private.is_top_access_admin(target.session_id); caller_manage:=private.can_manage_access(target.session_id);
 if not caller_manage then raise exception 'Your account cannot manage leader access'; end if;
 if target.user_id=(select auth.uid()) then raise exception 'Use another authorized leader to change your own access'; end if;
 target_is_elevated:=target.role in ('logistics_admin','session_director') or 'access_admin'=any(target.capabilities);
 if (target_is_elevated or p_role in ('logistics_admin','session_director') or p_access_admin) and not caller_top then raise exception 'Only a logistical administrator or session directing couple can change elevated access'; end if;
 if p_access_admin and p_role<>'coordinator' then raise exception 'Access administration can only be delegated to a Coordinator'; end if;
 if p_role='assistant_coordinator' then
  if coalesce(array_length(p_company_ids,1),0)=0 then raise exception 'Select at least one company for an Assistant Coordinator'; end if;
  if exists(select 1 from unnest(p_company_ids) cid where not exists(select 1 from public.companies c where c.id=cid and c.session_id=target.session_id)) then raise exception 'One or more companies do not belong to this session'; end if;
 end if;
 if exists(select 1 from unnest(normalized_team_keys) tk where not exists(select 1 from public.operational_teams ot where ot.session_id=target.session_id and ot.team_key=tk and ot.active)) then raise exception 'One or more team assignments are invalid'; end if;
 update public.access_assignments set active=false where session_id=target.session_id and user_id=target.user_id and active;
 insert into public.access_assignments(session_id,user_id,role,company_ids,committee_scope,capabilities,active)
 values(target.session_id,target.user_id,p_role,case when p_role='assistant_coordinator' then coalesce(p_company_ids,'{}') else '{}'::uuid[] end,
   coalesce((select array_agg(ot.display_name order by ot.display_name) from public.operational_teams ot where ot.session_id=target.session_id and ot.team_key=any(normalized_team_keys)),'{}'::text[]),
   case when p_access_admin then array['access_admin']::text[] else '{}'::text[] end,true)
 on conflict(session_id,user_id,role) do update set company_ids=excluded.company_ids,committee_scope=excluded.committee_scope,capabilities=excluded.capabilities,active=true returning id into new_assignment_id;
 update public.team_memberships set active=false,updated_at=now() where session_id=target.session_id and user_id=target.user_id and active;
 insert into public.team_memberships(session_id,team_id,user_id,active,assigned_by)
 select target.session_id,ot.id,target.user_id,true,(select auth.uid()) from public.operational_teams ot where ot.session_id=target.session_id and ot.team_key=any(normalized_team_keys) and ot.active
 on conflict(session_id,team_id,user_id) do update set active=true,assigned_by=excluded.assigned_by,updated_at=now();
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(target.session_id,(select auth.uid()),'leader_access_updated','access_assignment',new_assignment_id::text,jsonb_build_object('subject_user_id',target.user_id,'role',p_role,'company_ids',coalesce(p_company_ids,'{}'),'team_keys',normalized_team_keys,'access_admin',p_access_admin));
 return new_assignment_id;
end; $$;

drop policy if exists "members read scoped participants" on public.participants;
create policy "members read scoped participants" on public.participants for select to authenticated using(
 private.has_session_role(session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
 or private.has_team_capability(session_id,'people_lookup')
 or exists(select 1 from public.counselor_groups g where g.id=participants.group_id and private.can_access_company(participants.session_id,g.company_id))
);
drop policy if exists "members read staff" on public.staff;
create policy "members read staff" on public.staff for select to authenticated using(
 private.has_session_role(session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
 or private.has_team_capability(session_id,'people_lookup') or private.has_team_capability(session_id,'staff_view')
 or (assigned_company_id is not null and private.can_access_company(session_id,assigned_company_id))
);
drop policy if exists "members read scoped groups" on public.counselor_groups;
create policy "members read scoped groups" on public.counselor_groups for select to authenticated using(
 private.has_session_role(session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
 or private.has_team_capability(session_id,'groups_view') or private.can_access_company(session_id,company_id)
);

alter table public.operational_teams enable row level security;
alter table public.team_memberships enable row level security;
revoke all on public.operational_teams,public.team_memberships from anon,authenticated;
grant select on public.operational_teams,public.team_memberships to authenticated;
create policy "session members read operational teams" on public.operational_teams for select to authenticated using(private.has_session_access(session_id));
create policy "users or access managers read team memberships" on public.team_memberships for select to authenticated using(user_id=(select auth.uid()) or private.can_manage_access(session_id));

revoke all on function private.seed_default_operational_teams(uuid) from public;
revoke all on function private.has_team_capability(uuid,text,uuid) from public;
revoke all on function private.effective_capabilities(uuid,uuid) from public;
revoke all on function private.has_capability(uuid,text,uuid) from public;
grant execute on function public.get_session_team_catalog(uuid) to authenticated;
grant execute on function public.get_access_roster_v2(uuid) to authenticated;
grant execute on function public.manage_leader_access(uuid,public.app_role,uuid[],text[],boolean) to authenticated;
