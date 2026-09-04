-- Phase 2 hotfix: PostgreSQL requires a UNION query to order by an output
-- column name or ordinal. Keep the RPC behavior unchanged and use ordinals
-- for the two union-backed Food reads.

create or replace function public.get_meal_roster(p_session_id uuid)
returns table(person_type text, person_id uuid, display_name text, fsy_id text, company_name text, group_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_capability(p_session_id, 'food_view') then raise exception 'Food access required'; end if;
  return query
  select 'participant'::text, p.id, trim(concat_ws(' ', p.first_name, p.last_name)), b.fsy_id,
    coalesce(nullif(c.custom_name, ''), c.name), coalesce(nullif(g.custom_name, ''), g.name)
  from public.participants p
  join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id and g.state = 'published'
  join public.companies c on c.id = g.company_id and c.session_id = p.session_id
  left join lateral (select badge.fsy_id from public.participant_badge_assignments badge where badge.session_id = p_session_id and badge.participant_id = p.id and badge.state <> 'retired' order by badge.assigned_at desc limit 1) b on true
  where p.session_id = p_session_id and private.operational_participant_is_eligible(p_session_id, p.id)
    and (not exists(select 1 from public.participant_badge_assignments b where b.session_id = p_session_id and b.participant_id = p.id)
      or exists(select 1 from public.participant_badge_assignments b where b.session_id = p_session_id and b.participant_id = p.id and b.state <> 'retired'))
  union all
  select 'staff'::text, s.id, s.full_name, null::text,
    coalesce(nullif(c.custom_name, ''), c.name), null::text
  from public.staff s
  left join public.companies c on c.id = s.assigned_company_id
  where s.session_id = p_session_id and s.is_current and s.registration_status = 'approved'
  order by 3;
end;
$$;
revoke all on function public.get_meal_roster(uuid) from public, anon;
grant execute on function public.get_meal_roster(uuid) to authenticated;

create or replace function public.get_meal_attendance(p_meal_service_id uuid)
returns table(attendance_id uuid, person_type text, person_id uuid, display_name text, fsy_id text, company_name text, group_name text, served_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_session uuid;
begin
  select m.session_id into target_session from public.meal_services m where m.id = p_meal_service_id;
  if target_session is null then raise exception 'Meal service not found'; end if;
  if not private.has_capability(target_session, 'food_view') then raise exception 'Food access required'; end if;
  return query
  select a.id, 'participant'::text, p.id, trim(concat_ws(' ', p.first_name, p.last_name)), b.fsy_id,
    coalesce(nullif(c.custom_name, ''), c.name), coalesce(nullif(g.custom_name, ''), g.name), a.served_at
  from public.meal_attendance a
  join public.participants p on p.id = a.participant_id
  left join public.counselor_groups g on g.id = p.group_id
  left join public.companies c on c.id = g.company_id
  left join lateral (select badge.fsy_id from public.participant_badge_assignments badge where badge.session_id = target_session and badge.participant_id = p.id and badge.state <> 'retired' order by badge.assigned_at desc limit 1) b on true
  where a.meal_service_id = p_meal_service_id
  union all
  select a.id, 'staff'::text, s.id, s.full_name, null::text,
    coalesce(nullif(c.custom_name, ''), c.name), null::text, a.served_at
  from public.meal_attendance a
  join public.staff s on s.id = a.staff_id
  left join public.companies c on c.id = s.assigned_company_id
  where a.meal_service_id = p_meal_service_id
  order by 8 desc;
end;
$$;
revoke all on function public.get_meal_attendance(uuid) from public, anon;
grant execute on function public.get_meal_attendance(uuid) to authenticated;
