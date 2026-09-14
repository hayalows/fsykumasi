-- v72 regression: execute a full live-structure replacement inside a subtransaction
-- using the current published Kumasi structure, then intentionally roll it back. This
-- proves the identity retirement/reissue path, foreign keys, staff reconnect path and
-- rollback snapshot path can all execute together without changing the live roster.

do $test$
declare
  sid uuid;
  admin_uid uuid;
  payload jsonb;
  result jsonb;
  before_companies integer;
  before_groups integer;
  before_grouped integer;
  before_badges integer;
  before_checkins integer;
begin
  select s.id into sid
  from public.sessions s
  where s.name = 'FSY Kumasi 2026'
  order by s.created_at desc
  limit 1;

  if sid is null then
    return;
  end if;

  select aa.user_id into admin_uid
  from public.access_assignments aa
  where aa.session_id = sid
    and aa.active
    and aa.role in (
      'coordinator'::public.app_role,
      'logistics_admin'::public.app_role,
      'session_director'::public.app_role,
      'area_advisory_couple'::public.app_role
    )
  order by aa.user_id
  limit 1;

  if admin_uid is null then
    raise exception 'v72 dry-run could not resolve a full-session administrator';
  end if;

  perform set_config('request.jwt.claim.sub', admin_uid::text, true);

  select count(*)::integer into before_companies from public.companies where session_id = sid;
  select count(*)::integer into before_groups from public.counselor_groups where session_id = sid and state = 'published';
  select count(*)::integer into before_grouped from public.participants where session_id = sid and group_id is not null;
  select count(*)::integer into before_badges from public.participant_badge_assignments where session_id = sid and state <> 'retired';
  select count(*)::integer into before_checkins from public.check_ins where session_id = sid and status = 'arrived';

  select jsonb_agg(
    jsonb_build_object(
      'name', c.name,
      'groups', (
        select jsonb_agg(
          jsonb_build_object(
            'name', g.name,
            'sex', g.sex::text,
            'participant_ids', coalesce((
              select jsonb_agg(p.id order by p.id)
              from public.participants p
              where p.group_id = g.id
            ), '[]'::jsonb)
          )
          order by coalesce(g.operational_number, 999999), g.name, g.id
        )
        from public.counselor_groups g
        where g.session_id = sid and g.company_id = c.id and g.state = 'published'
      )
    )
    order by coalesce(
      c.operational_number,
      nullif(regexp_replace(c.name, '\D', '', 'g'), '')::integer,
      999999
    ), c.name, c.id
  )
  into payload
  from public.companies c
  where c.session_id = sid;

  begin
    update public.session_structure_settings
    set groups_per_company = greatest(groups_per_company, 4),
        group_max_size = greatest(group_max_size, 15)
    where session_id = sid;

    result := public.publish_grouping_plan(sid, payload);

    if coalesce((result->>'participant_count')::integer, 0) <> before_grouped then
      raise exception 'v72 dry-run participant count changed from % to %', before_grouped, result->>'participant_count';
    end if;
    if coalesce((result->>'previous_identity_count')::integer, 0) <> before_badges then
      raise exception 'v72 dry-run identity count changed from % to %', before_badges, result->>'previous_identity_count';
    end if;
    if coalesce((result->>'arrived_checkins_preserved')::integer, -1) <> before_checkins then
      raise exception 'v72 dry-run did not preserve arrived check-ins';
    end if;

    raise exception '__v72_intentional_rollback__';
  exception when others then
    if sqlerrm <> '__v72_intentional_rollback__' then
      raise;
    end if;
  end;

  if (select count(*) from public.companies where session_id = sid) <> before_companies
     or (select count(*) from public.counselor_groups where session_id = sid and state = 'published') <> before_groups
     or (select count(*) from public.participants where session_id = sid and group_id is not null) <> before_grouped
     or (select count(*) from public.participant_badge_assignments where session_id = sid and state <> 'retired') <> before_badges
     or (select count(*) from public.check_ins where session_id = sid and status = 'arrived') <> before_checkins then
    raise exception 'v72 dry-run rollback did not restore the original live structure';
  end if;
end;
$test$;
