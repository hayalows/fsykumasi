-- Phase 1 hardening: keep legacy attendance callers on the guarded arrival path
-- and apply Assistant Coordinator company scope to vacancy visibility.

create or replace function public.set_participant_attendance_status(p_participant_id uuid,p_status text,p_note text default null)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.set_participant_arrival_status(p_participant_id,p_status,p_note);
end;
$$;

create or replace function public.get_arrival_vacancies(p_session_id uuid)
returns table(participant_id uuid, fsy_id text, full_name text, sex text, company_id uuid, company_name text, group_id uuid, group_name text, slot_number integer)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller_role public.app_role;
begin
  if not private.has_capability(p_session_id,'registration_manage') then
    raise exception 'Registration management access required';
  end if;

  select aa.role into caller_role
  from public.access_assignments aa
  where aa.session_id=p_session_id
    and aa.user_id=(select auth.uid())
    and aa.active
  limit 1;

  return query
  select p.id,b.fsy_id,trim(concat_ws(' ',p.first_name,p.last_name)),p.sex::text,
    b.company_id,c.name,b.group_id,g.name,b.slot_number
  from public.participants p
  join public.participant_badge_assignments b
    on b.participant_id=p.id
    and b.session_id=p.session_id
    and b.state<>'retired'
  join public.companies c on c.id=b.company_id
  join public.counselor_groups g on g.id=b.group_id
  left join public.check_ins ci on ci.session_id=p.session_id and ci.participant_id=p.id
  where p.session_id=p_session_id
    and p.attendance_status='confirmed_not_attending'
    and coalesce(ci.status::text,'')<>'arrived'
    and (
      caller_role is distinct from 'assistant_coordinator'::public.app_role
      or private.can_access_company(p_session_id,b.company_id)
    )
  order by c.operational_number,b.slot_number;
end;
$$;

grant execute on function public.set_participant_attendance_status(uuid,text,text) to authenticated;
grant execute on function public.get_arrival_vacancies(uuid) to authenticated;
