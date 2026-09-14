-- Check-in refresh is one of the busiest day-of read paths.
-- Keep the same access rules, but evaluate them once per request instead of once per check-in row.

create or replace function public.get_participant_checkin_states(p_session_id uuid)
returns table(
  participant_id uuid,
  status text,
  recorded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_full_access boolean;
  v_is_ac boolean;
  v_caps text[];
  v_company_ids uuid[];
begin
  if not private.has_session_access(p_session_id) then
    return;
  end if;

  v_full_access := private.has_session_role(
    p_session_id,
    array['coordinator','logistics_admin','session_director']::public.app_role[]
  );
  v_is_ac := private.has_session_role(
    p_session_id,
    array['assistant_coordinator']::public.app_role[]
  );
  v_caps := private.effective_capabilities(p_session_id, v_user_id);

  select coalesce(array_agg(distinct cid.company_id), '{}'::uuid[])
  into v_company_ids
  from public.access_assignments aa
  cross join lateral unnest(coalesce(aa.company_ids, '{}'::uuid[])) as cid(company_id)
  where aa.session_id = p_session_id
    and aa.user_id = v_user_id
    and aa.active;

  return query
  select c.participant_id,
         c.status::text,
         c.recorded_at
  from public.check_ins c
  join public.participants p
    on p.id = c.participant_id and p.session_id = c.session_id
  left join public.counselor_groups g
    on g.id = p.group_id and g.session_id = p.session_id
  where c.session_id = p_session_id
    and (
      v_full_access
      or (
        not v_is_ac
        and v_caps && array[
          'people_lookup','registration_view','registration_manage','reports_export'
        ]::text[]
      )
      or (g.company_id is not null and g.company_id = any(v_company_ids))
    );
end;
$$;
