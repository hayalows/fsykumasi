-- The live workspace asks for participant operational state frequently.
-- Compute authorization and company scope once per request instead of once per participant.

create or replace function public.get_participant_operational_states(p_session_id uuid)
returns table(
  participant_id uuid,
  operational_status text,
  operational_note text,
  operational_revision integer,
  operational_updated_at timestamptz
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
  select p.id,
         coalesce(p.operational_status, 'active'),
         p.operational_note,
         coalesce(p.operational_revision, 0),
         p.operational_updated_at
  from public.participants p
  left join public.counselor_groups g
    on g.id = p.group_id and g.session_id = p.session_id
  where p.session_id = p_session_id
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
