-- Keep the live registration/check-in roster aligned with the approved
-- participant policy. Source history remains intact, but excluded records and
-- participants aged 20+ do not belong in active participant worklists.
create or replace function public.get_arrival_reconciliation(p_session_id uuid)
returns table(
  participant_id uuid, fsy_id text, full_name text, preferred_name text, sex text, stake_name text, unit_name text,
  company_name text, group_name text, slot_number integer, attendance_status text, checkin_status text,
  source_kind text, verification_status text, is_current boolean
)
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  if not private.has_capability(p_session_id,'registration_view') and not private.has_capability(p_session_id,'registration_manage') then
    raise exception 'Registration access required';
  end if;
  return query
  select p.id,b.fsy_id,trim(concat_ws(' ',p.first_name,p.last_name)),p.preferred_name,p.sex::text,p.stake_name,p.unit_name,
    c.name,g.name,b.slot_number,coalesce(p.attendance_status,'expected'),ci.status::text,p.source_kind,p.verification_status,p.is_current
  from public.participants p
  left join public.participant_badge_assignments b on b.participant_id=p.id and b.session_id=p.session_id and b.state<>'retired'
  left join public.counselor_groups g on g.id=coalesce(b.group_id,p.group_id)
  left join public.companies c on c.id=coalesce(b.company_id,g.company_id)
  left join public.check_ins ci on ci.session_id=p.session_id and ci.participant_id=p.id
  join public.sessions s on s.id=p.session_id
  left join public.participant_private_details d on d.participant_id=p.id
  left join public.participant_operation_decisions od on od.participant_id=p.id
  where p.session_id=p_session_id
    and p.is_current
    and coalesce(od.cohort_state,'normal')<>'excluded'
    and coalesce(
      case when s.starts_on is not null and d.date_of_birth is not null
        then extract(year from age(s.starts_on,d.date_of_birth))::integer
        else p.age end,
      0
    ) between 12 and 19
  order by lower(coalesce(p.stake_name,'')),lower(coalesce(p.unit_name,'')),lower(p.last_name),lower(p.first_name),p.id;
end;
$function$;

revoke all on function public.get_arrival_reconciliation(uuid) from public, anon;
grant execute on function public.get_arrival_reconciliation(uuid) to authenticated;
