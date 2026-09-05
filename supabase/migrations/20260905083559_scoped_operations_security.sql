-- Keep committee grants additive, with active website access required.
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
    and exists(select 1 from public.access_assignments aa where aa.session_id=target_session and aa.user_id=tm.user_id and aa.active)
)
select coalesce(array_agg(distinct capability order by capability),'{}'::text[])
from (select capability from base union all select capability from explicit_caps union all select capability from team_caps) caps
where capability is not null;
$$;
revoke all on function private.effective_capabilities(uuid, uuid) from public;
grant execute on function private.effective_capabilities(uuid, uuid) to authenticated;


-- Committee responsibilities survive staff changes, but cannot bypass disabled access.
create or replace function private.has_team_capability(target_session uuid, capability text, target_user uuid default null::uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.team_memberships tm
 join public.operational_teams ot on ot.id=tm.team_id and ot.session_id=tm.session_id
 where tm.session_id=target_session and tm.user_id=coalesce(target_user,(select auth.uid()))
 and tm.active and ot.active and capability=any(ot.capabilities)
 and exists(select 1 from public.access_assignments aa where aa.session_id=target_session and aa.user_id=tm.user_id and aa.active));
$$;
revoke all on function private.has_team_capability(uuid,text,uuid) from public,anon;
grant execute on function private.has_team_capability(uuid,text,uuid) to authenticated;

-- Website committee assignments are independent of Staff identity and company scope.
create or replace function public.set_account_teams(p_session_id uuid,p_user_id uuid,p_team_keys text[])
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not private.can_manage_access(p_session_id) then raise exception 'Access administration required'; end if;
 if p_user_id=(select auth.uid()) then raise exception 'Ask another administrator to change your responsibilities'; end if;
 perform 1 from public.access_assignments where session_id=p_session_id and user_id=p_user_id and active for update;
 if not found then raise exception 'Active website account required'; end if;
 if exists(select 1 from unnest(coalesce(p_team_keys,'{}')) k where not exists(select 1 from public.operational_teams t where t.session_id=p_session_id and t.team_key=k and t.active)) then raise exception 'Invalid team assignment'; end if;
 if coalesce(cardinality(p_team_keys),0)=0 and not exists(select 1 from public.access_assignments where session_id=p_session_id and user_id=p_user_id and active and role<>'committee_viewer') then raise exception 'Choose at least one committee'; end if;
 update public.team_memberships set active=false,updated_at=now() where session_id=p_session_id and user_id=p_user_id;
 insert into public.team_memberships(session_id,team_id,user_id,active,assigned_by)
 select p_session_id,t.id,p_user_id,true,(select auth.uid()) from public.operational_teams t where t.session_id=p_session_id and t.active and t.team_key=any(coalesce(p_team_keys,'{}'))
 on conflict(session_id,team_id,user_id) do update set active=true,assigned_by=excluded.assigned_by,updated_at=now();
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_session_id,(select auth.uid()),'account_teams_updated','profile',p_user_id::text,jsonb_build_object('team_keys',p_team_keys));
end; $$;
revoke all on function public.set_account_teams(uuid,uuid,text[]) from public,anon;
grant execute on function public.set_account_teams(uuid,uuid,text[]) to authenticated;
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
  if exists(select 1 from unnest(coalesce(p_committee_scope,'{}')) k where not exists(select 1 from public.operational_teams t where t.session_id=p_session_id and t.team_key=k and t.active)) then raise exception 'Invalid committee assignment'; end if;
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
