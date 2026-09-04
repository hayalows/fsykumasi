-- Phase 3 Housing read model: add FSY ID and live check-in context without changing assignments.
create or replace function public.get_housing_assignments_v2(p_session_id uuid)
returns table(
  assignment_id uuid,
  room_id uuid,
  room_name text,
  person_type text,
  person_id uuid,
  display_name text,
  sex public.participant_sex,
  group_name text,
  company_name text,
  bed_label text,
  assigned_at timestamptz,
  fsy_id text,
  checkin_status text,
  checked_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,a.room_id,r.room_name,'participant'::text,p.id,trim(concat_ws(' ',p.first_name,p.last_name)),p.sex,
    coalesce(nullif(g.custom_name,''),g.name),coalesce(nullif(c.custom_name,''),c.name),a.bed_label,a.assigned_at,
    badge.fsy_id,coalesce(ci.status::text,'not_checked_in'),ci.recorded_at
  from public.housing_assignments a
  join public.housing_rooms r on r.id=a.room_id
  join public.participants p on p.id=a.participant_id
  left join public.counselor_groups g on g.id=p.group_id
  left join public.companies c on c.id=g.company_id
  left join lateral (
    select b.fsy_id from public.participant_badge_assignments b
    where b.session_id=p_session_id and b.participant_id=p.id and b.state<>'retired'
    order by b.assigned_at desc limit 1
  ) badge on true
  left join lateral (
    select x.status,x.recorded_at from public.check_ins x
    where x.session_id=p_session_id and x.participant_id=p.id
    order by x.recorded_at desc limit 1
  ) ci on true
  where a.session_id=p_session_id and a.active and private.has_capability(p_session_id,'housing_view')
  union all
  select a.id,a.room_id,r.room_name,'staff'::text,s.id,s.full_name,s.sex,null::text,
    coalesce(nullif(c.custom_name,''),c.name),a.bed_label,a.assigned_at,null::text,'staff'::text,null::timestamptz
  from public.housing_assignments a
  join public.housing_rooms r on r.id=a.room_id
  join public.staff s on s.id=a.staff_id
  left join public.companies c on c.id=s.assigned_company_id
  where a.session_id=p_session_id and a.active and private.has_capability(p_session_id,'housing_view')
  order by 3,6;
$$;
revoke all on function public.get_housing_assignments_v2(uuid) from public, anon;
grant execute on function public.get_housing_assignments_v2(uuid) to authenticated;
