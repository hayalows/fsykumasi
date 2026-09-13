-- Staff arrival check-in v59.
-- Registration operators may record physical arrival without receiving broader
-- staff-planning, clearance, assignment, or committee-management powers.

create or replace function public.get_staff_arrival_roster_v1(p_session_id uuid)
returns table(
  staff_id uuid,
  full_name text,
  preferred_name text,
  unit_name text,
  stake_name text,
  operational_role text,
  registration_status text,
  is_current boolean,
  planning_state text,
  arrival_state text,
  service_clearance text,
  operations_revision integer,
  assignment_label text,
  committee_duties text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_session_access(p_session_id) then
    raise exception 'Session access is required';
  end if;

  if not (
    private.has_capability(p_session_id, 'registration_manage')
    or private.has_capability(p_session_id, 'staff_manage')
    or private.has_session_role(
      p_session_id,
      array['coordinator','logistics_admin','session_director']::public.app_role[]
    )
  ) then
    raise exception 'Registration or staff management access is required';
  end if;

  return query
  select
    s.id,
    s.full_name,
    coalesce(s.preferred_name, ''),
    coalesce(s.unit_name, ''),
    coalesce(s.stake_name, ''),
    coalesce(s.operational_role::text, 'other'),
    coalesce(s.registration_status::text, ''),
    s.is_current,
    coalesce(o.planning_state, case when s.registration_status::text = 'awaiting' then 'provisional' else 'reserve' end),
    coalesce(o.arrival_state, 'expected'),
    coalesce(o.service_clearance, case when s.registration_status::text = 'approved' then 'cleared' else 'confirmation_required' end),
    coalesce(o.revision, 0),
    case
      when s.operational_role::text = 'counselor' then coalesce((
        select coalesce(nullif(g.custom_name, ''), g.name)
        from public.counselor_groups g
        where g.session_id = s.session_id and g.counselor_id = s.id
        order by g.name
        limit 1
      ), 'Counselor')
      when s.operational_role::text = 'assistant_coordinator' then coalesce((
        select string_agg(coalesce(nullif(c.custom_name, ''), c.name), ' · ' order by c.name)
        from public.staff_company_assignments sca
        join public.companies c on c.id = sca.company_id and c.session_id = sca.session_id
        where sca.session_id = s.session_id and sca.staff_id = s.id
      ), 'Assistant coordinator')
      when s.operational_role::text = 'committee_member' then coalesce((
        select concat(initcap(d.duty), ' committee')
        from public.staff_committee_duties d
        where d.staff_id = s.id
        order by d.duty
        limit 1
      ), 'Committee member')
      when s.operational_role::text = 'coordinator' then 'Coordinator'
      when s.operational_role::text = 'logistics_admin' then 'Logistical administrator'
      when s.operational_role::text = 'session_director' then 'Session directing couple'
      when s.operational_role::text = 'area_advisory_couple' then 'FSY area advisory couple'
      else 'Staff'
    end,
    coalesce((
      select array_agg(d.duty order by d.duty)
      from public.staff_committee_duties d
      where d.staff_id = s.id
    ), '{}'::text[])
  from public.staff s
  left join public.staff_operations o on o.staff_id = s.id
  where s.session_id = p_session_id
  order by s.full_name, s.id;
end;
$$;

revoke all on function public.get_staff_arrival_roster_v1(uuid) from public, anon;
grant execute on function public.get_staff_arrival_roster_v1(uuid) to authenticated;

create or replace function public.record_staff_arrival_v1(
  p_staff_id uuid,
  p_arrival text,
  p_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  previous public.staff_operations%rowtype;
  result public.staff_operations%rowtype;
begin
  if p_arrival not in ('expected', 'arrived') then
    raise exception 'Registration can only check staff in or undo that check-in';
  end if;

  select * into target from public.staff where id = p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;

  if not (
    private.has_capability(target.session_id, 'registration_manage')
    or private.has_capability(target.session_id, 'staff_manage')
    or private.has_session_role(
      target.session_id,
      array['coordinator','logistics_admin','session_director']::public.app_role[]
    )
  ) then
    raise exception 'Registration or staff management access is required';
  end if;

  if p_arrival = 'arrived' and (not target.is_current or target.registration_status::text = 'cancelled') then
    raise exception 'This person is not in the current staff roster';
  end if;

  select * into previous
  from public.staff_operations
  where staff_id = target.id
  for update;

  if previous.staff_id is null then
    raise exception 'Staff operational status is missing. Ask an administrator to refresh this staff record';
  end if;

  if previous.revision is distinct from p_revision then
    raise exception 'Staff record changed. Refresh and review again.';
  end if;

  if previous.arrival_state = p_arrival then
    return jsonb_build_object(
      'staff_id', target.id,
      'arrival_state', previous.arrival_state,
      'revision', previous.revision,
      'unchanged', true
    );
  end if;

  -- Registration is deliberately limited to arrival. Planning, clearance,
  -- responsibilities, and committee duties are untouched.
  update public.staff_operations
  set arrival_state = p_arrival,
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where staff_id = target.id and revision = p_revision
  returning * into result;

  if result.staff_id is null then
    raise exception 'Staff record changed. Refresh and review again.';
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    target.session_id,
    auth.uid(),
    case when p_arrival = 'arrived' then 'staff_checked_in' else 'staff_checkin_undone' end,
    'staff',
    target.id::text,
    jsonb_build_object(
      'previous_arrival', previous.arrival_state,
      'arrival_state', result.arrival_state,
      'source', 'registration_staff_checkin'
    )
  );

  return jsonb_build_object(
    'staff_id', target.id,
    'arrival_state', result.arrival_state,
    'revision', result.revision,
    'unchanged', false
  );
end;
$$;

revoke all on function public.record_staff_arrival_v1(uuid, text, integer) from public, anon;
grant execute on function public.record_staff_arrival_v1(uuid, text, integer) to authenticated;

-- Let other signed-in desks see a staff arrival without waiting for a manual
-- refresh. RLS on staff_operations remains the read boundary.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'staff_operations'
  ) then
    alter publication supabase_realtime add table public.staff_operations;
  end if;
end;
$$;
