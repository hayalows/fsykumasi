-- Admin-controlled FSY structure settings, staff assignments, editable names,
-- reversible birthday acknowledgement, and safe grouping replacement.

alter table public.staff
  add column if not exists operational_role text not null default 'counselor';
alter table public.staff drop constraint if exists staff_operational_role_check;
alter table public.staff add constraint staff_operational_role_check
  check (operational_role in ('counselor','assistant_coordinator','coordinator','committee_member','logistics_admin','session_director','other'));

alter table public.companies
  add column if not exists custom_name text,
  add column if not exists scripture_reference text,
  add column if not exists meeting_spot text;

alter table public.counselor_groups
  add column if not exists custom_name text;

create table if not exists public.session_structure_settings (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  group_min_size integer not null default 8,
  group_max_size integer not null default 10,
  groups_per_company integer not null default 2,
  use_age_bands boolean not null default true,
  avoid_same_unit boolean not null default true,
  balance_sexes boolean not null default true,
  updated_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint session_structure_group_min_check check (group_min_size between 6 and 12),
  constraint session_structure_group_max_check check (group_max_size between group_min_size and 15),
  constraint session_structure_company_size_check check (groups_per_company between 1 and 6)
);

create table if not exists public.staff_company_assignments (
  session_id uuid not null references public.sessions(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  assignment_role text not null default 'assistant_coordinator',
  assigned_by uuid references public.profiles(user_id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (staff_id, company_id),
  constraint staff_company_assignment_role_check check (assignment_role in ('assistant_coordinator'))
);
create index if not exists staff_company_assignments_session_company_idx
  on public.staff_company_assignments(session_id, company_id);

alter table public.session_structure_settings enable row level security;
alter table public.staff_company_assignments enable row level security;
revoke all on public.session_structure_settings, public.staff_company_assignments from anon, authenticated;
grant select on public.session_structure_settings, public.staff_company_assignments to authenticated;

drop policy if exists "members read structure settings" on public.session_structure_settings;
create policy "members read structure settings" on public.session_structure_settings
  for select to authenticated using (private.has_session_access(session_id));

drop policy if exists "members read scoped staff company assignments" on public.staff_company_assignments;
create policy "members read scoped staff company assignments" on public.staff_company_assignments
  for select to authenticated using (
    private.has_session_wide_visibility(session_id) or private.can_access_company(session_id, company_id)
  );

insert into public.session_structure_settings(session_id)
select s.id from public.sessions s
on conflict (session_id) do nothing;

create or replace function public.save_session_structure_settings(
  p_session_id uuid,
  p_group_min_size integer,
  p_group_max_size integer,
  p_groups_per_company integer,
  p_use_age_bands boolean,
  p_avoid_same_unit boolean,
  p_balance_sexes boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_access(p_session_id) then
    raise exception 'Administrative access is required to change grouping rules';
  end if;
  if p_group_min_size not between 6 and 12
     or p_group_max_size not between p_group_min_size and 15
     or p_groups_per_company not between 1 and 6 then
    raise exception 'Grouping rules are outside the supported range';
  end if;

  insert into public.session_structure_settings(
    session_id, group_min_size, group_max_size, groups_per_company,
    use_age_bands, avoid_same_unit, balance_sexes, updated_by, updated_at
  ) values (
    p_session_id, p_group_min_size, p_group_max_size, p_groups_per_company,
    p_use_age_bands, p_avoid_same_unit, p_balance_sexes, (select auth.uid()), now()
  )
  on conflict (session_id) do update set
    group_min_size = excluded.group_min_size,
    group_max_size = excluded.group_max_size,
    groups_per_company = excluded.groups_per_company,
    use_age_bands = excluded.use_age_bands,
    avoid_same_unit = excluded.avoid_same_unit,
    balance_sexes = excluded.balance_sexes,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_session_id, (select auth.uid()), 'structure_settings_updated', 'session', p_session_id::text,
    jsonb_build_object('group_min_size', p_group_min_size, 'group_max_size', p_group_max_size,
      'groups_per_company', p_groups_per_company, 'use_age_bands', p_use_age_bands,
      'avoid_same_unit', p_avoid_same_unit, 'balance_sexes', p_balance_sexes));
end;
$$;
revoke all on function public.save_session_structure_settings(uuid,integer,integer,integer,boolean,boolean,boolean) from public, anon;
grant execute on function public.save_session_structure_settings(uuid,integer,integer,integer,boolean,boolean,boolean) to authenticated;

create or replace function public.set_staff_operational_role(p_staff_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.staff%rowtype;
begin
  select * into target from public.staff where id = p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Administrative access is required'; end if;
  if p_role not in ('counselor','assistant_coordinator','coordinator','committee_member','logistics_admin','session_director','other') then
    raise exception 'Choose a supported staff role';
  end if;

  if p_role <> 'counselor' then
    update public.counselor_groups set counselor_id = null
    where session_id = target.session_id and counselor_id = target.id;
  end if;
  if p_role <> 'assistant_coordinator' then
    delete from public.staff_company_assignments where staff_id = target.id;
    update public.staff set assigned_company_id = null where id = target.id;
  end if;

  update public.staff set operational_role = p_role where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.session_id, (select auth.uid()), 'staff_operational_role_updated', 'staff', target.id::text,
    jsonb_build_object('role', p_role));
end;
$$;
revoke all on function public.set_staff_operational_role(uuid,text) from public, anon;
grant execute on function public.set_staff_operational_role(uuid,text) to authenticated;

create or replace function public.assign_counselor_to_group(p_staff_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_staff public.staff%rowtype; target_group public.counselor_groups%rowtype;
begin
  select * into target_staff from public.staff where id = p_staff_id for update;
  select * into target_group from public.counselor_groups where id = p_group_id for update;
  if target_staff.id is null or target_group.id is null or target_staff.session_id <> target_group.session_id then
    raise exception 'Staff member and group must belong to the same session';
  end if;
  if not private.can_manage_access(target_staff.session_id) then raise exception 'Administrative access is required'; end if;
  if not target_staff.is_current or target_staff.registration_status <> 'approved' then
    raise exception 'Only current approved staff can be assigned';
  end if;
  if target_staff.operational_role <> 'counselor' then raise exception 'Set this staff member as a Counselor first'; end if;
  if target_staff.sex is not null and target_staff.sex <> target_group.sex then
    raise exception 'Counselor sex must match the counselor group';
  end if;

  update public.counselor_groups set counselor_id = null
  where session_id = target_staff.session_id and counselor_id = target_staff.id and id <> target_group.id;
  update public.counselor_groups set counselor_id = target_staff.id where id = target_group.id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_staff.session_id, (select auth.uid()), 'counselor_group_staff_assigned', 'counselor_group', target_group.id::text,
    jsonb_build_object('staff_id', target_staff.id));
end;
$$;
revoke all on function public.assign_counselor_to_group(uuid,uuid) from public, anon;
grant execute on function public.assign_counselor_to_group(uuid,uuid) to authenticated;

create or replace function public.unassign_counselor_from_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.counselor_groups%rowtype; previous uuid;
begin
  select * into target from public.counselor_groups where id = p_group_id for update;
  if target.id is null then raise exception 'Counselor group not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Administrative access is required'; end if;
  previous := target.counselor_id;
  update public.counselor_groups set counselor_id = null where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.session_id, (select auth.uid()), 'counselor_group_staff_unassigned', 'counselor_group', target.id::text,
    jsonb_build_object('staff_id', previous));
end;
$$;
revoke all on function public.unassign_counselor_from_group(uuid) from public, anon;
grant execute on function public.unassign_counselor_from_group(uuid) to authenticated;

create or replace function public.set_staff_company_assignment(p_staff_id uuid, p_company_id uuid, p_assigned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_staff public.staff%rowtype; target_company public.companies%rowtype;
begin
  select * into target_staff from public.staff where id = p_staff_id for update;
  select * into target_company from public.companies where id = p_company_id;
  if target_staff.id is null or target_company.id is null or target_staff.session_id <> target_company.session_id then
    raise exception 'Staff member and company must belong to the same session';
  end if;
  if not private.can_manage_access(target_staff.session_id) then raise exception 'Administrative access is required'; end if;
  if target_staff.operational_role <> 'assistant_coordinator' then raise exception 'Set this staff member as an Assistant Coordinator first'; end if;

  if p_assigned then
    insert into public.staff_company_assignments(session_id, staff_id, company_id, assigned_by)
    values (target_staff.session_id, target_staff.id, target_company.id, (select auth.uid()))
    on conflict (staff_id, company_id) do nothing;
  else
    delete from public.staff_company_assignments where staff_id = target_staff.id and company_id = target_company.id;
  end if;

  update public.staff s set assigned_company_id = (
    select sca.company_id from public.staff_company_assignments sca
    where sca.staff_id = s.id order by sca.assigned_at, sca.company_id limit 1
  ) where s.id = target_staff.id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_staff.session_id, (select auth.uid()),
    case when p_assigned then 'assistant_coordinator_company_assigned' else 'assistant_coordinator_company_unassigned' end,
    'company', target_company.id::text, jsonb_build_object('staff_id', target_staff.id));
end;
$$;
revoke all on function public.set_staff_company_assignment(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_staff_company_assignment(uuid,uuid,boolean) to authenticated;

create or replace function public.update_company_details(
  p_company_id uuid, p_custom_name text, p_scripture_reference text, p_meeting_spot text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.companies%rowtype;
begin
  select * into target from public.companies where id = p_company_id for update;
  if target.id is null then raise exception 'Company not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Administrative access is required'; end if;
  if length(coalesce(trim(p_custom_name),'')) > 80 or length(coalesce(trim(p_scripture_reference),'')) > 120 or length(coalesce(trim(p_meeting_spot),'')) > 160 then
    raise exception 'One of the company details is too long';
  end if;
  update public.companies set
    custom_name = nullif(trim(coalesce(p_custom_name,'')),''),
    scripture_reference = nullif(trim(coalesce(p_scripture_reference,'')),''),
    meeting_spot = nullif(trim(coalesce(p_meeting_spot,'')),'')
  where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.session_id, (select auth.uid()), 'company_details_updated', 'company', target.id::text,
    jsonb_build_object('custom_name', nullif(trim(coalesce(p_custom_name,'')),''), 'scripture_reference', nullif(trim(coalesce(p_scripture_reference,'')),''), 'meeting_spot', nullif(trim(coalesce(p_meeting_spot,'')),'')));
end;
$$;
revoke all on function public.update_company_details(uuid,text,text,text) from public, anon;
grant execute on function public.update_company_details(uuid,text,text,text) to authenticated;

create or replace function public.update_group_details(p_group_id uuid, p_custom_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.counselor_groups%rowtype;
begin
  select * into target from public.counselor_groups where id = p_group_id for update;
  if target.id is null then raise exception 'Counselor group not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Administrative access is required'; end if;
  if length(coalesce(trim(p_custom_name),'')) > 80 then raise exception 'Group name is too long'; end if;
  update public.counselor_groups set custom_name = nullif(trim(coalesce(p_custom_name,'')),'') where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.session_id, (select auth.uid()), 'counselor_group_details_updated', 'counselor_group', target.id::text,
    jsonb_build_object('custom_name', nullif(trim(coalesce(p_custom_name,'')),'')));
end;
$$;
revoke all on function public.update_group_details(uuid,text) from public, anon;
grant execute on function public.update_group_details(uuid,text) to authenticated;

create or replace function public.set_birthday_acknowledgement(p_session_id uuid, p_participant_id uuid, p_acknowledged boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.get_session_birthdays(p_session_id) b where b.participant_id = p_participant_id) then
    raise exception 'Birthday is not available in your session scope';
  end if;
  if p_acknowledged then
    insert into public.birthday_acknowledgements(session_id, participant_id, acknowledged_by)
    values (p_session_id, p_participant_id, (select auth.uid()))
    on conflict (session_id, participant_id) do update set acknowledged_by = excluded.acknowledged_by, acknowledged_at = now();
  else
    delete from public.birthday_acknowledgements
    where session_id = p_session_id and participant_id = p_participant_id;
  end if;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id)
  values (p_session_id, (select auth.uid()),
    case when p_acknowledged then 'birthday_acknowledged' else 'birthday_acknowledgement_undone' end,
    'participant', p_participant_id::text);
end;
$$;
revoke all on function public.set_birthday_acknowledgement(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_birthday_acknowledgement(uuid,uuid,boolean) to authenticated;

create or replace function public.get_session_birthdays(p_session_id uuid)
returns table (
  participant_id uuid, display_name text, birthday_date date, turning_age integer,
  unit_name text, group_name text, company_name text, acknowledged boolean, acknowledged_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select p.id as participant_id,
    coalesce(nullif(p.preferred_name, ''), trim(concat_ws(' ', p.first_name, p.last_name))) as display_name,
    private.birthday_in_year(d.date_of_birth, extract(year from s.starts_on)::integer) as birthday_date,
    (extract(year from s.starts_on)::integer - extract(year from d.date_of_birth)::integer)::integer as turning_age,
    p.unit_name as unit_name,
    coalesce(nullif(g.custom_name,''), g.name) as group_name,
    coalesce(nullif(c.custom_name,''), c.name) as company_name,
    (ba.participant_id is not null) as acknowledged, ba.acknowledged_at as acknowledged_at
  from public.sessions s
  join public.participants p on p.session_id = s.id
  join public.participant_private_details d on d.participant_id = p.id
  left join public.counselor_groups g on g.id = p.group_id
  left join public.companies c on c.id = g.company_id
  left join public.birthday_acknowledgements ba on ba.session_id = s.id and ba.participant_id = p.id
  where s.id = p_session_id and private.has_session_access(s.id)
    and p.is_current and p.registration_status = 'approved' and p.verification_status = 'verified'
    and private.birthday_in_year(d.date_of_birth, extract(year from s.starts_on)::integer) between s.starts_on and s.ends_on
    and (
      private.has_session_role(s.id, array['coordinator','logistics_admin','session_director']::public.app_role[])
      or (g.company_id is not null and private.can_access_company(s.id, g.company_id))
    )
  order by birthday_date, display_name;
$$;

create or replace function public.publish_grouping_plan(p_session_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_item jsonb; group_item jsonb; new_company_id uuid; new_group_id uuid;
  participant_total integer; supplied_total integer; distinct_total integer;
  company_count integer; group_count integer := 0; company_index integer := 0;
  min_size integer; max_size integer; groups_target integer; use_bands boolean; avoid_units boolean;
  had_plan boolean := false;
  colors text[] := array['#005175','#007DA5','#8DBF67','#FCB449'];
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Administrative access is required to publish groups'; end if;
  if jsonb_typeof(p_plan) <> 'array' then raise exception 'Grouping plan must be an array'; end if;

  select group_min_size, group_max_size, groups_per_company, use_age_bands, avoid_same_unit
  into min_size, max_size, groups_target, use_bands, avoid_units
  from public.session_structure_settings where session_id = p_session_id;
  if min_size is null then min_size := 8; max_size := 10; groups_target := 2; use_bands := true; avoid_units := true; end if;

  company_count := jsonb_array_length(p_plan);
  if company_count < 1 or company_count > 500 then raise exception 'Grouping plan must contain between 1 and 500 companies'; end if;

  select exists(select 1 from public.counselor_groups where session_id = p_session_id)
      or exists(select 1 from public.companies where session_id = p_session_id)
  into had_plan;

  if had_plan and exists(select 1 from public.check_ins where session_id = p_session_id and status = 'arrived') then
    raise exception 'Undo active check-ins before replacing the published structure';
  end if;
  if had_plan and exists(
    select 1 from public.headcount_submissions hs
    join public.headcount_rounds hr on hr.id = hs.round_id
    where hr.session_id = p_session_id
  ) then raise exception 'A head-count submission exists, so the published structure can no longer be replaced'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_plan) c(item)
    where jsonb_typeof(c.item->'groups') <> 'array'
      or jsonb_array_length(c.item->'groups') < 1
      or jsonb_array_length(c.item->'groups') > groups_target
      or nullif(trim(c.item->>'name'),'') is null
  ) then raise exception 'Each company needs a name and no more than the configured number of counselor groups'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item->'groups') g(item)
    where nullif(trim(g.item->>'name'),'') is null
      or lower(g.item->>'sex') not in ('female','male')
      or jsonb_typeof(g.item->'participant_ids') <> 'array'
      or jsonb_array_length(g.item->'participant_ids') not between min_size and max_size
  ) then raise exception 'A counselor group does not match the current group-size rules'; end if;

  select count(*) into participant_total from public.participants p
  where p.session_id = p_session_id and p.is_current and p.registration_status='approved' and p.verification_status='verified';

  with supplied as (
    select (jsonb_array_elements_text(g.item->'participant_ids'))::uuid participant_id
    from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item->'groups') g(item)
  ) select count(*), count(distinct participant_id) into supplied_total, distinct_total from supplied;
  if participant_total = 0 or supplied_total <> participant_total or distinct_total <> participant_total then
    raise exception 'Every current approved participant must be assigned exactly once';
  end if;

  if exists (
    with supplied as (
      select (jsonb_array_elements_text(g.item->'participant_ids'))::uuid participant_id
      from jsonb_array_elements(p_plan) c(item)
      cross join lateral jsonb_array_elements(c.item->'groups') g(item)
    ) select 1 from supplied s left join public.participants p on p.id=s.participant_id and p.session_id=p_session_id
      where p.id is null or not p.is_current or p.registration_status<>'approved' or p.verification_status<>'verified'
  ) then raise exception 'Grouping plan contains an ineligible participant'; end if;

  if avoid_units and exists (
    select 1 from jsonb_array_elements(p_plan) with ordinality c(item,company_no)
    cross join lateral jsonb_array_elements(c.item->'groups') with ordinality g(item,group_no)
    cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value)
    join public.participants p on p.id=member.value::uuid
    group by company_no, group_no, lower(trim(p.unit_name)) having count(*) > 1
  ) then raise exception 'A counselor group contains youth from the same unit'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item->'groups') g(item)
    cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value)
    join public.participants p on p.id=member.value::uuid
    where p.sex::text <> lower(g.item->>'sex')
  ) then raise exception 'A counselor group mixes participant sexes'; end if;

  if use_bands and exists (
    select 1 from jsonb_array_elements(p_plan) with ordinality c(item,company_no)
    cross join lateral jsonb_array_elements(c.item->'groups') g(item)
    cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value)
    join public.participants p on p.id=member.value::uuid
    group by company_no
    having count(distinct case when p.age between 14 and 15 then '14-15' when p.age between 16 and 18 then '16-18' else 'other' end) > 1
  ) then raise exception 'A company mixes configured age bands'; end if;

  if had_plan then
    delete from public.staff_company_assignments where session_id = p_session_id;
    update public.staff set assigned_company_id = null where session_id = p_session_id;
    update public.participants set group_id = null, updated_at = now() where session_id = p_session_id;
    delete from public.counselor_groups where session_id = p_session_id;
    delete from public.companies where session_id = p_session_id;
  end if;

  for company_item in select value from jsonb_array_elements(p_plan) loop
    company_index := company_index + 1; new_company_id := extensions.gen_random_uuid();
    insert into public.companies(id,session_id,name,color,custom_name,scripture_reference,meeting_spot)
    values (new_company_id,p_session_id,trim(company_item->>'name'),colors[1+((company_index-1)%cardinality(colors))],
      nullif(trim(coalesce(company_item->>'custom_name','')),''), nullif(trim(coalesce(company_item->>'scripture_reference','')),''),
      nullif(trim(coalesce(company_item->>'meeting_spot','')),''));
    for group_item in select value from jsonb_array_elements(company_item->'groups') loop
      group_count := group_count + 1; new_group_id := extensions.gen_random_uuid();
      insert into public.counselor_groups(id,session_id,company_id,name,sex,state,custom_name)
      values (new_group_id,p_session_id,new_company_id,trim(group_item->>'name'),lower(group_item->>'sex')::public.participant_sex,'published',
        nullif(trim(coalesce(group_item->>'custom_name','')),''));
      update public.participants p set group_id=new_group_id, updated_at=now()
      where p.session_id=p_session_id and p.id in (select value::uuid from jsonb_array_elements_text(group_item->'participant_ids'));
    end loop;
  end loop;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_session_id,(select auth.uid()),case when had_plan then 'grouping_plan_republished' else 'grouping_plan_published' end,
    'session',p_session_id::text,jsonb_build_object('company_count',company_count,'group_count',group_count,'participant_count',participant_total,
      'groups_per_company',groups_target,'group_min_size',min_size,'group_max_size',max_size));
  return jsonb_build_object('company_count',company_count,'group_count',group_count,'participant_count',participant_total,'replaced',had_plan);
end;
$$;
revoke all on function public.publish_grouping_plan(uuid,jsonb) from public, anon;
grant execute on function public.publish_grouping_plan(uuid,jsonb) to authenticated;

create or replace function public.assign_participant_to_group(p_participant_id uuid, p_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.participants%rowtype; target_group public.counselor_groups%rowtype; max_size integer; avoid_units boolean;
begin
  select * into target from public.participants where id=p_participant_id for update;
  select * into target_group from public.counselor_groups where id=p_group_id;
  if target.id is null or target_group.id is null or target.session_id<>target_group.session_id then raise exception 'Participant and group must belong to the same session'; end if;
  if not private.has_session_role(target.session_id,array['coordinator','logistics_admin','session_director']::public.app_role[]) then raise exception 'Your role cannot assign participants'; end if;
  if not target.is_current or target.registration_status<>'approved' or target.verification_status<>'verified' then raise exception 'Only current, approved, verified participants can be assigned'; end if;
  if target.sex<>target_group.sex then raise exception 'Participant sex does not match the selected group'; end if;
  select group_max_size, avoid_same_unit into max_size, avoid_units from public.session_structure_settings where session_id=target.session_id;
  max_size := coalesce(max_size,10); avoid_units := coalesce(avoid_units,true);
  if (select count(*) from public.participants p where p.group_id=target_group.id and p.id<>target.id) >= max_size then raise exception 'This counselor group is already at its configured maximum size'; end if;
  if avoid_units and exists(select 1 from public.participants peer where peer.group_id=target_group.id and peer.id<>target.id and lower(trim(peer.unit_name))=lower(trim(target.unit_name))) then raise exception 'This group already contains someone from the same unit'; end if;
  update public.participants set group_id=target_group.id, updated_at=now() where id=target.id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values (target.session_id,(select auth.uid()),'participant_group_assigned','participant',target.id::text,jsonb_build_object('group_id',target_group.id));
end;
$$;
revoke all on function public.assign_participant_to_group(uuid,uuid) from public, anon;
grant execute on function public.assign_participant_to_group(uuid,uuid) to authenticated;

drop policy if exists "scoped staff visibility" on public.staff;
create policy "scoped staff visibility" on public.staff for select to authenticated using (
  private.has_session_wide_visibility(session_id)
  or (assigned_company_id is not null and private.can_access_company(session_id, assigned_company_id))
  or exists (
    select 1 from public.staff_company_assignments sca
    where sca.staff_id = staff.id and private.can_access_company(staff.session_id, sca.company_id)
  )
  or exists (
    select 1 from public.counselor_groups g
    where g.counselor_id = staff.id and private.can_access_company(staff.session_id, g.company_id)
  )
);
