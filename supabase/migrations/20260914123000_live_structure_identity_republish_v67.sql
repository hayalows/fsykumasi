-- Live structure republish v67.
--
-- A reviewed grouping plan can replace the live structure even after FSY identities
-- have been finalized. The operation is atomic: save a rollback snapshot, retire the
-- current live identity set, rebuild companies/groups, reissue identities against the
-- new structure, preserve participant check-ins and other participant-linked activity,
-- and reconnect staff who are already on the ground.

create or replace function private.sync_staff_login_access_from_company_assignment_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.sync_staff_login_access(old.staff_id);
    return old;
  end if;
  perform private.sync_staff_login_access(new.staff_id);
  return new;
end;
$$;

revoke all on function private.sync_staff_login_access_from_company_assignment_v1() from public, anon, authenticated;

drop trigger if exists staff_company_assignment_sync_login_v1 on public.staff_company_assignments;
create trigger staff_company_assignment_sync_login_v1
after insert or update or delete on public.staff_company_assignments
for each row execute function private.sync_staff_login_access_from_company_assignment_v1();

create or replace function public.publish_grouping_plan(p_session_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_item jsonb;
  group_item jsonb;
  new_company_id uuid;
  new_group_id uuid;
  participant_total integer;
  supplied_total integer;
  distinct_total integer;
  company_count integer;
  group_count integer := 0;
  company_index integer := 0;
  group_index integer;
  min_size integer;
  max_size integer;
  groups_target integer;
  use_bands boolean;
  avoid_units boolean;
  min_age integer;
  max_age integer;
  assistant_load integer;
  had_plan boolean := false;
  session_status text;
  rollback_version_id uuid;
  previous_identity_count integer := 0;
  identity_change_count integer := 0;
  reprint_count integer := 0;
  counselor_assigned_count integer := 0;
  assistant_company_count integer := 0;
  arrived_checkin_count integer := 0;
  uncovered_group_count integer := 0;
  uncovered_company_count integer := 0;
  colors text[] := array['#005175','#007DA5','#8DBF67','#FCB449'];
begin
  if not private.can_manage_access(p_session_id) then
    raise exception 'Administrative access is required to publish groups';
  end if;
  if jsonb_typeof(p_plan) <> 'array' then
    raise exception 'Grouping plan must be an array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fsy-structure-republish:' || p_session_id::text, 0));

  select s.status into session_status
  from public.sessions s
  where s.id = p_session_id
  for update;
  if session_status is null then
    raise exception 'Session not found';
  end if;
  if session_status = 'closed' then
    raise exception 'A closed session structure cannot be replaced';
  end if;

  select group_min_size, group_max_size, groups_per_company, use_age_bands,
         avoid_same_unit, participant_min_age, participant_max_age,
         companies_per_assistant_coordinator
  into min_size, max_size, groups_target, use_bands,
       avoid_units, min_age, max_age, assistant_load
  from public.session_structure_settings
  where session_id = p_session_id;

  min_size := coalesce(min_size, 8);
  max_size := coalesce(max_size, 10);
  groups_target := coalesce(groups_target, 2);
  use_bands := coalesce(use_bands, false);
  avoid_units := coalesce(avoid_units, true);
  min_age := coalesce(min_age, 12);
  max_age := coalesce(max_age, 19);
  assistant_load := greatest(1, coalesce(assistant_load, 1));

  company_count := jsonb_array_length(p_plan);
  if company_count < 1 or company_count > 99 then
    raise exception 'Grouping plan must contain between 1 and 99 companies';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_plan) c(item)
    where jsonb_typeof(c.item->'groups') <> 'array'
       or jsonb_array_length(c.item->'groups') < 1
       or jsonb_array_length(c.item->'groups') > groups_target
       or nullif(trim(c.item->>'name'), '') is null
  ) then
    raise exception 'Each company needs a name and no more than the configured number of counselor groups';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item->'groups') g(item)
    where nullif(trim(g.item->>'name'), '') is null
       or lower(g.item->>'sex') not in ('female','male')
       or jsonb_typeof(g.item->'participant_ids') <> 'array'
       or jsonb_array_length(g.item->'participant_ids') not between min_size and max_size
  ) then
    raise exception 'A counselor group does not match the current group-size rules';
  end if;

  select count(*)::integer into participant_total
  from public.participants p
  where p.session_id = p_session_id
    and private.operational_participant_is_eligible(p_session_id, p.id);

  with supplied as (
    select (jsonb_array_elements_text(g.item->'participant_ids'))::uuid participant_id
    from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item->'groups') g(item)
  )
  select count(*)::integer, count(distinct participant_id)::integer
  into supplied_total, distinct_total
  from supplied;

  if participant_total = 0
     or supplied_total <> participant_total
     or distinct_total <> participant_total then
    raise exception 'Reviewed structure has % youth (% unique), but % are currently eligible. Rebuild the structure and publish again.',
      supplied_total, distinct_total, participant_total;
  end if;

  if exists (
    with supplied as (
      select (jsonb_array_elements_text(g.item->'participant_ids'))::uuid participant_id
      from jsonb_array_elements(p_plan) c(item)
      cross join lateral jsonb_array_elements(c.item->'groups') g(item)
    )
    select 1
    from supplied x
    left join public.participants p
      on p.id = x.participant_id and p.session_id = p_session_id
    where p.id is null
       or not private.operational_participant_is_eligible(p_session_id, p.id)
  ) then
    raise exception 'Grouping plan contains a participant outside the live operational roster';
  end if;

  if avoid_units and exists (
    select 1
    from jsonb_array_elements(p_plan) with ordinality c(item, company_no)
    cross join lateral jsonb_array_elements(c.item->'groups') with ordinality g(item, group_no)
    cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value)
    join public.participants p on p.id = member.value::uuid
    group by company_no, group_no, lower(trim(p.unit_name))
    having count(*) > 1
  ) then
    raise exception 'A counselor group contains youth from the same unit';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item->'groups') g(item)
    cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value)
    join public.participants p on p.id = member.value::uuid
    where p.sex::text <> lower(g.item->>'sex')
  ) then
    raise exception 'A counselor group mixes participant sexes';
  end if;

  if use_bands and exists (
    select 1
    from jsonb_array_elements(p_plan) with ordinality c(item, company_no)
    cross join lateral jsonb_array_elements(c.item->'groups') g(item)
    cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value)
    join public.participants p on p.id = member.value::uuid
    group by company_no
    having count(distinct case
      when p.age between 12 and 15 then '12-15'
      when p.age between 16 and 19 then '16-19'
      else 'other'
    end) > 1
  ) then
    raise exception 'A company mixes configured age bands';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item->'groups') g(item)
    group by c.item
    having sum(jsonb_array_length(g.item->'participant_ids')) > 99
  ) then
    raise exception 'A company cannot contain more than 99 youth because FSY identity slots are two digits';
  end if;

  select exists(select 1 from public.counselor_groups where session_id = p_session_id)
      or exists(select 1 from public.companies where session_id = p_session_id)
  into had_plan;

  if had_plan and exists (
    select 1 from public.headcount_rounds where session_id = p_session_id
  ) then
    raise exception 'A head-count round already exists. Close or restore that operational state before replacing the live structure.';
  end if;

  select count(*)::integer into arrived_checkin_count
  from public.check_ins
  where session_id = p_session_id and status = 'arrived';

  if had_plan then
    rollback_version_id := private.save_session_roster_version_v1(
      p_session_id,
      'Before live structure republish',
      'Automatic safety snapshot before replacing companies, counselor groups and active FSY identities',
      'live-structure-v67'
    );
  end if;

  create temporary table tmp_old_live_identity on commit drop as
  select distinct on (b.participant_id)
    b.participant_id,
    b.fsy_id,
    b.slot_number,
    b.origin_code,
    b.badge_name,
    b.state,
    b.needs_reprint,
    coalesce(c.operational_number, nullif(regexp_replace(c.name, '\D', '', 'g'), '')::integer) as company_number
  from public.participant_badge_assignments b
  join public.companies c on c.id = b.company_id and c.session_id = b.session_id
  where b.session_id = p_session_id and b.state <> 'retired'
  order by b.participant_id, b.assigned_at desc, b.id;

  select count(*)::integer into previous_identity_count from tmp_old_live_identity;

  create temporary table tmp_new_companies (
    company_index integer primary key,
    company_id uuid not null unique
  ) on commit drop;

  create temporary table tmp_new_groups (
    company_index integer not null,
    group_index integer not null,
    group_id uuid primary key,
    company_id uuid not null,
    sex public.participant_sex not null
  ) on commit drop;

  -- Badge rows have restrictive foreign keys to the old company/group rows. The full
  -- badge and history chain is already captured in the rollback snapshot above, so the
  -- current projection can be rebuilt safely and atomically for the new structure.
  delete from public.participant_badge_id_history where session_id = p_session_id;
  delete from public.participant_badge_assignments where session_id = p_session_id;

  -- Remove stale company scope before deleting the old companies. Linked staff accounts
  -- are repopulated automatically as on-ground Assistant Coordinators are reattached.
  update public.access_assignments
  set company_ids = '{}'::uuid[]
  where session_id = p_session_id and role = 'assistant_coordinator'::public.app_role;

  update public.leader_invites
  set company_ids = '{}'::uuid[]
  where session_id = p_session_id
    and role = 'assistant_coordinator'::public.app_role
    and status in ('pending','activating');

  update public.access_requests
  set company_ids = '{}'::uuid[]
  where session_id = p_session_id
    and requested_role = 'assistant_coordinator'::public.app_role
    and status = 'pending';

  delete from public.staff_company_assignments where session_id = p_session_id;
  update public.staff set assigned_company_id = null where session_id = p_session_id;
  update public.participants set group_id = null, updated_at = now() where session_id = p_session_id;
  delete from public.counselor_groups where session_id = p_session_id;
  delete from public.companies where session_id = p_session_id;

  for company_item in select value from jsonb_array_elements(p_plan) loop
    company_index := company_index + 1;
    new_company_id := extensions.gen_random_uuid();

    insert into public.companies(
      id, session_id, name, color, custom_name, scripture_reference,
      meeting_spot, operational_number
    ) values (
      new_company_id,
      p_session_id,
      trim(company_item->>'name'),
      colors[1 + ((company_index - 1) % cardinality(colors))],
      nullif(trim(coalesce(company_item->>'custom_name','')), ''),
      nullif(trim(coalesce(company_item->>'scripture_reference','')), ''),
      nullif(trim(coalesce(company_item->>'meeting_spot','')), ''),
      company_index
    );

    insert into tmp_new_companies(company_index, company_id)
    values(company_index, new_company_id);

    group_index := 0;
    for group_item in select value from jsonb_array_elements(company_item->'groups') loop
      group_index := group_index + 1;
      group_count := group_count + 1;
      new_group_id := extensions.gen_random_uuid();

      insert into public.counselor_groups(
        id, session_id, company_id, name, sex, state, custom_name, operational_number
      ) values (
        new_group_id,
        p_session_id,
        new_company_id,
        trim(group_item->>'name'),
        lower(group_item->>'sex')::public.participant_sex,
        'published',
        nullif(trim(coalesce(group_item->>'custom_name','')), ''),
        group_index
      );

      insert into tmp_new_groups(company_index, group_index, group_id, company_id, sex)
      values(
        company_index,
        group_index,
        new_group_id,
        new_company_id,
        lower(group_item->>'sex')::public.participant_sex
      );

      update public.participants p
      set group_id = new_group_id, updated_at = now()
      where p.session_id = p_session_id
        and p.id in (
          select value::uuid
          from jsonb_array_elements_text(group_item->'participant_ids')
        );
    end loop;
  end loop;

  if (select count(*) from public.participants p
      where p.session_id = p_session_id
        and private.operational_participant_is_eligible(p_session_id, p.id)
        and p.group_id is null) > 0 then
    raise exception 'The reviewed structure left an eligible participant without a counselor group';
  end if;

  create temporary table tmp_badge_slots (
    participant_id uuid primary key,
    company_id uuid not null,
    group_id uuid not null,
    slot_number integer not null
  ) on commit drop;

  -- Keep an existing identity unchanged when the participant remains in the same
  -- numbered company. This avoids needless reprints while still allowing a real
  -- company transfer to receive the company-first identity required by the system.
  insert into tmp_badge_slots(participant_id, company_id, group_id, slot_number)
  select p.id, g.company_id, g.id, old.slot_number
  from public.participants p
  join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  join public.companies c on c.id = g.company_id and c.session_id = g.session_id
  join tmp_old_live_identity old on old.participant_id = p.id
  where p.session_id = p_session_id
    and private.operational_participant_is_eligible(p_session_id, p.id)
    and old.company_number = c.operational_number
    and old.slot_number between 1 and 99;

  with remaining as (
    select
      p.id as participant_id,
      g.company_id,
      g.id as group_id,
      row_number() over (
        partition by g.company_id
        order by p.sex, coalesce(p.full_name, p.first_name || ' ' || p.last_name), p.id
      ) as rn
    from public.participants p
    join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
    where p.session_id = p_session_id
      and private.operational_participant_is_eligible(p_session_id, p.id)
      and not exists (
        select 1 from tmp_badge_slots x where x.participant_id = p.id
      )
  ), available as (
    select
      c.company_id,
      slot.slot_number,
      row_number() over (partition by c.company_id order by slot.slot_number) as rn
    from tmp_new_companies c
    cross join lateral generate_series(1, 99) as slot(slot_number)
    where not exists (
      select 1
      from tmp_badge_slots used
      where used.company_id = c.company_id and used.slot_number = slot.slot_number
    )
  )
  insert into tmp_badge_slots(participant_id, company_id, group_id, slot_number)
  select r.participant_id, r.company_id, r.group_id, a.slot_number
  from remaining r
  join available a on a.company_id = r.company_id and a.rn = r.rn;

  if (select count(*) from tmp_badge_slots) <> participant_total then
    raise exception 'Could not allocate an FSY identity slot for every participant in the new live structure';
  end if;

  insert into public.participant_badge_assignments(
    session_id, participant_id, company_id, group_id, slot_number,
    origin_code, fsy_id, badge_name, state, needs_reprint,
    assigned_by, assigned_at, finalized_by, finalized_at, note
  )
  select
    p_session_id,
    p.id,
    slots.company_id,
    slots.group_id,
    slots.slot_number,
    coalesce(nullif(old.origin_code, ''), nullif(private.origin_code_for_participant(p), ''), 'UNK'),
    'PENDING',
    coalesce(nullif(trim(old.badge_name), ''), nullif(trim(p.preferred_name), ''), nullif(trim(p.full_name), ''), trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,''))),
    'finalized',
    coalesce(old.needs_reprint, false),
    auth.uid(),
    now(),
    auth.uid(),
    now(),
    case when old.participant_id is null
      then 'Issued for live structure v67'
      else 'Reissued for live structure v67'
    end
  from tmp_badge_slots slots
  join public.participants p on p.id = slots.participant_id and p.session_id = p_session_id
  left join tmp_old_live_identity old on old.participant_id = p.id;

  update public.participant_badge_assignments b
  set needs_reprint = true
  from tmp_old_live_identity old
  where b.session_id = p_session_id
    and b.participant_id = old.participant_id
    and b.state <> 'retired'
    and b.fsy_id <> old.fsy_id;

  insert into public.participant_badge_id_history(
    id, session_id, badge_assignment_id, participant_id,
    previous_fsy_id, replacement_fsy_id, changed_at, changed_by, reason
  )
  select
    extensions.gen_random_uuid(),
    p_session_id,
    b.id,
    b.participant_id,
    old.fsy_id,
    b.fsy_id,
    now(),
    auth.uid(),
    'Live structure v67 company/group replacement'
  from public.participant_badge_assignments b
  join tmp_old_live_identity old on old.participant_id = b.participant_id
  where b.session_id = p_session_id
    and b.state <> 'retired'
    and b.fsy_id <> old.fsy_id
  on conflict do nothing;

  select count(*)::integer into identity_change_count
  from public.participant_badge_assignments b
  join tmp_old_live_identity old on old.participant_id = b.participant_id
  where b.session_id = p_session_id and b.state <> 'retired' and b.fsy_id <> old.fsy_id;

  select count(*)::integer into reprint_count
  from public.participant_badge_assignments b
  where b.session_id = p_session_id and b.state <> 'retired' and b.needs_reprint;

  -- Reattach only staff who are physically present and cleared. This keeps the day-of
  -- roster authoritative. Staff who arrive later continue to use the v65 automatic
  -- placement flow and fill the remaining open groups/companies.
  with ranked_groups as (
    select
      g.group_id,
      g.sex,
      row_number() over (partition by g.sex order by g.company_index, g.group_index, g.group_id) as rn
    from tmp_new_groups g
  ), ranked_staff as (
    select
      s.id as staff_id,
      s.sex,
      row_number() over (partition by s.sex order by s.full_name, s.id) as rn
    from public.staff s
    join public.staff_operations o on o.staff_id = s.id
    where s.session_id = p_session_id
      and s.is_current
      and s.registration_status <> 'cancelled'
      and s.operational_role = 'counselor'
      and s.sex in ('female'::public.participant_sex, 'male'::public.participant_sex)
      and o.planning_state <> 'excluded'
      and o.arrival_state = 'arrived'
      and o.service_clearance = 'cleared'
  )
  update public.counselor_groups g
  set counselor_id = s.staff_id
  from ranked_groups rg
  join ranked_staff s on s.sex = rg.sex and s.rn = rg.rn
  where g.id = rg.group_id;

  update public.staff s
  set assigned_company_id = g.company_id
  from public.counselor_groups g
  where g.session_id = p_session_id and g.counselor_id = s.id;

  with ranked_companies as (
    select company_id, company_index,
      ceil(company_index::numeric / assistant_load)::integer as assistant_rn
    from tmp_new_companies
  ), ranked_assistants as (
    select
      s.id as staff_id,
      row_number() over (order by s.full_name, s.id) as rn
    from public.staff s
    join public.staff_operations o on o.staff_id = s.id
    where s.session_id = p_session_id
      and s.is_current
      and s.registration_status <> 'cancelled'
      and s.operational_role = 'assistant_coordinator'
      and o.planning_state <> 'excluded'
      and o.arrival_state = 'arrived'
      and o.service_clearance = 'cleared'
  )
  insert into public.staff_company_assignments(
    session_id, staff_id, company_id, assignment_role, assigned_by
  )
  select p_session_id, a.staff_id, c.company_id, 'assistant_coordinator', auth.uid()
  from ranked_companies c
  join ranked_assistants a on a.rn = c.assistant_rn
  on conflict (staff_id, company_id) do nothing;

  update public.staff s
  set assigned_company_id = x.company_id
  from (
    select distinct on (sca.staff_id) sca.staff_id, sca.company_id
    from public.staff_company_assignments sca
    where sca.session_id = p_session_id
    order by sca.staff_id, sca.assigned_at, sca.company_id
  ) x
  where s.id = x.staff_id;

  update public.staff_operations o
  set planning_state = 'primary', revision = o.revision + 1,
      updated_by = auth.uid(), updated_at = now()
  where o.staff_id in (
    select counselor_id from public.counselor_groups
      where session_id = p_session_id and counselor_id is not null
    union
    select staff_id from public.staff_company_assignments
      where session_id = p_session_id
  ) and o.planning_state <> 'primary';

  select count(*)::integer into counselor_assigned_count
  from public.counselor_groups
  where session_id = p_session_id and state = 'published' and counselor_id is not null;

  select count(distinct company_id)::integer into assistant_company_count
  from public.staff_company_assignments
  where session_id = p_session_id;

  select count(*)::integer into uncovered_group_count
  from public.counselor_groups
  where session_id = p_session_id and state = 'published' and counselor_id is null;

  select count(*)::integer into uncovered_company_count
  from public.companies c
  where c.session_id = p_session_id
    and not exists (
      select 1 from public.staff_company_assignments sca
      where sca.session_id = c.session_id and sca.company_id = c.id
    );

  insert into public.session_roster_finalizations(
    session_id, finalized_by, finalized_at, summary
  ) values (
    p_session_id,
    auth.uid(),
    now(),
    jsonb_build_object(
      'policy_version', 'live-structure-v67',
      'final_participants', participant_total,
      'companies', company_count,
      'groups', group_count,
      'previous_active_identities', previous_identity_count,
      'identity_ids_changed', identity_change_count,
      'identities_needing_reprint', reprint_count,
      'arrived_checkins_preserved', arrived_checkin_count,
      'on_ground_counselors_assigned', counselor_assigned_count,
      'on_ground_companies_with_ac', assistant_company_count,
      'rollback_version_id', rollback_version_id
    )
  )
  on conflict (session_id) do update set
    finalized_by = excluded.finalized_by,
    finalized_at = excluded.finalized_at,
    summary = excluded.summary;

  insert into public.session_roster_freezes(session_id, frozen_by, frozen_at, note)
  values(
    p_session_id,
    auth.uid(),
    now(),
    'Live structure v67 published. Previous live roster is stored in the rollback version recorded in finalization summary.'
  )
  on conflict (session_id) do update set
    frozen_by = excluded.frozen_by,
    frozen_at = excluded.frozen_at,
    note = excluded.note;

  insert into public.audit_events(
    session_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_session_id,
    auth.uid(),
    case when had_plan then 'live_grouping_plan_republished' else 'grouping_plan_published' end,
    'session',
    p_session_id::text,
    jsonb_build_object(
      'company_count', company_count,
      'group_count', group_count,
      'participant_count', participant_total,
      'previous_identity_count', previous_identity_count,
      'identity_change_count', identity_change_count,
      'reprint_count', reprint_count,
      'arrived_checkins_preserved', arrived_checkin_count,
      'on_ground_counselors_assigned', counselor_assigned_count,
      'on_ground_companies_with_ac', assistant_company_count,
      'uncovered_groups', uncovered_group_count,
      'uncovered_companies', uncovered_company_count,
      'rollback_version_id', rollback_version_id,
      'eligibility_basis', 'operational_participant_is_eligible',
      'session_status', session_status
    )
  );

  return jsonb_build_object(
    'company_count', company_count,
    'group_count', group_count,
    'participant_count', participant_total,
    'replaced', had_plan,
    'previous_identity_count', previous_identity_count,
    'identity_change_count', identity_change_count,
    'reprint_count', reprint_count,
    'arrived_checkins_preserved', arrived_checkin_count,
    'on_ground_counselors_assigned', counselor_assigned_count,
    'on_ground_companies_with_ac', assistant_company_count,
    'uncovered_groups', uncovered_group_count,
    'uncovered_companies', uncovered_company_count,
    'rollback_version_id', rollback_version_id
  );
end;
$$;

revoke all on function public.publish_grouping_plan(uuid,jsonb) from public, anon;
grant execute on function public.publish_grouping_plan(uuid,jsonb) to authenticated, service_role;
