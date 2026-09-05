-- Registration -> Housing operational handoff.
-- Registration owns arrival/check-in. Housing owns room assignment.
-- The handoff is derived from check-in + active housing assignment so there is no duplicate queue state to reconcile.

update public.operational_teams
set capabilities = (
  select coalesce(array_agg(capability order by capability), '{}'::text[])
  from (
    select distinct capability
    from unnest(capabilities || array[
      'people_lookup','groups_view','registration_view','registration_manage','checkin_record',
      'identity_manage','arrival_manage','reports_export'
    ]::text[]) capability
    where capability not in ('housing_view','housing_manage')
  ) normalized
),
updated_at = now(),
description = 'Registration, on-site resolution, participant placement, arrival, and check-in. Checked-in participants hand off automatically to Housing.'
where team_key = 'registration';

create or replace function private.seed_default_operational_teams(target_session uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.operational_teams(session_id,team_key,display_name,description,preset_key,capabilities) values
 (target_session,'housing','Housing','Room assignments, occupancy, keys, and housing changes.','housing',array['people_lookup','groups_view','housing_view','housing_manage','housing_export','reports_export']),
 (target_session,'wellness','Wellness','Health support and confidential wellness encounters.','wellness',array['people_lookup','wellness_status','wellness_private','wellness_manage']),
 (target_session,'food','Food','Meal planning and dietary accommodation operations.','food',array['people_lookup','groups_view','food_view','food_manage','food_export','reports_export']),
 (target_session,'registration','Registration','Registration, on-site resolution, participant placement, arrival, and check-in. Checked-in participants hand off automatically to Housing.','registration',array['people_lookup','groups_view','registration_view','registration_manage','checkin_record','identity_manage','arrival_manage','reports_export']),
 (target_session,'staff','Staff Administration','Staffing, assignments, and staff readiness.','staff',array['staff_view','staff_manage','groups_view','reports_export']),
 (target_session,'inclusion','Inclusion','Accommodation and accessibility coordination.','inclusion',array['people_lookup','inclusion_view','housing_view']),
 (target_session,'facilities','Facilities','Venue, rooms, spaces, and facility coordination.','facilities',array['facilities_view','housing_view']),
 (target_session,'materials','Materials','Materials preparation and distribution.','materials',array['materials_view']),
 (target_session,'financial','Financial','FSY financial administration.','financial',array['financial_view']),
 (target_session,'publicity','Publicity','Approved session publicity and communications.','publicity',array['publicity_view']),
 (target_session,'logistics','Logistical Administration','Cross-functional logistical coordination without confidential Wellness narrative.','logistics',array['people_lookup','groups_view','checkin_record','headcount_view','headcount_record','housing_view','housing_manage','housing_export','food_view','food_manage','food_export','registration_view','registration_manage','identity_manage','arrival_manage','staff_view','staff_manage','inclusion_view','facilities_view','materials_view','reports_export'])
 on conflict(session_id,team_key) do nothing;
end; $$;
revoke all on function private.seed_default_operational_teams(uuid) from public;

create or replace function public.get_registration_housing_status(p_session_id uuid)
returns table(
  participant_id uuid,
  room_id uuid,
  room_name text,
  bed_label text,
  assigned_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not (
    private.has_capability(p_session_id,'registration_view')
    or private.has_capability(p_session_id,'registration_manage')
    or private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
  ) then raise exception 'Registration access required'; end if;

  return query
  select ha.participant_id, hr.id, hr.room_name, ha.bed_label, ha.assigned_at
  from public.housing_assignments ha
  join public.housing_rooms hr on hr.id=ha.room_id and hr.session_id=ha.session_id
  where ha.session_id=p_session_id
    and ha.active
    and ha.participant_id is not null;
end;
$$;
revoke all on function public.get_registration_housing_status(uuid) from public, anon;
grant execute on function public.get_registration_housing_status(uuid) to authenticated;

create or replace function public.get_housing_arrival_queue(p_session_id uuid)
returns table(
  participant_id uuid,
  full_name text,
  preferred_name text,
  sex text,
  unit_name text,
  stake_name text,
  fsy_id text,
  company_name text,
  group_name text,
  checked_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not (
    private.has_capability(p_session_id,'housing_view')
    or private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
  ) then raise exception 'Housing access required'; end if;

  return query
  select
    p.id,
    trim(concat_ws(' ',p.first_name,p.last_name)),
    p.preferred_name,
    p.sex::text,
    p.unit_name,
    p.stake_name,
    b.fsy_id,
    c.name,
    g.name,
    ci.recorded_at
  from public.participants p
  join public.check_ins ci
    on ci.session_id=p.session_id and ci.participant_id=p.id and ci.status='arrived'
  left join public.participant_badge_assignments b
    on b.participant_id=p.id and b.session_id=p.session_id and b.state<>'retired'
  left join public.counselor_groups g
    on g.id=coalesce(b.group_id,p.group_id)
  left join public.companies c
    on c.id=coalesce(b.company_id,g.company_id)
  where p.session_id=p_session_id
    and p.is_current
    and coalesce(p.attendance_status,'expected')<>'confirmed_not_attending'
    and not exists (
      select 1
      from public.housing_assignments ha
      where ha.session_id=p.session_id
        and ha.participant_id=p.id
        and ha.active
    )
  order by ci.recorded_at, lower(p.last_name), lower(p.first_name), p.id;
end;
$$;
revoke all on function public.get_housing_arrival_queue(uuid) from public, anon;
grant execute on function public.get_housing_arrival_queue(uuid) to authenticated;

-- Registration and Housing need read visibility to check-in events for their live workspaces.
drop policy if exists "members read scoped checkins" on public.check_ins;
create policy "members read scoped checkins" on public.check_ins
for select to authenticated
using (
  private.has_session_wide_visibility(session_id)
  or private.has_capability(session_id,'checkin_record')
  or private.has_capability(session_id,'registration_view')
  or private.has_capability(session_id,'housing_view')
  or exists(
    select 1
    from public.participants p
    join public.counselor_groups g on g.id=p.group_id
    where p.id=check_ins.participant_id
      and private.can_access_company(check_ins.session_id,g.company_id)
  )
);

-- Keep Housing screens in sync across committee devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='housing_assignments'
  ) then
    alter publication supabase_realtime add table public.housing_assignments;
  end if;
end $$;
