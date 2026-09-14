-- v70: serialize full structure replacement with day-of staff and participant arrivals.
-- The first v69 runtime exercise exposed a lock-order deadlock between bulk staff
-- reassignment and a concurrent day-of staff operation. Lock people first, then take
-- the same advisory locks used by day-of placement. Suppress per-row login syncing
-- during the bulk replacement and refresh the final AC scopes once at the end.

create or replace function private.sync_staff_login_access_from_company_assignment_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('fsy.structure_republish', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform private.sync_staff_login_access(old.staff_id);
    return old;
  end if;

  perform private.sync_staff_login_access(new.staff_id);
  return new;
end;
$$;

revoke all on function private.sync_staff_login_access_from_company_assignment_v1() from public, anon, authenticated;

do $patch$
declare
  ddl text;
  old_text text;
  new_text text;
begin
  select pg_get_functiondef(p.oid)
  into ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'publish_grouping_plan'
    and pg_get_function_identity_arguments(p.oid) = 'p_session_id uuid, p_plan jsonb';

  if ddl is null then
    raise exception 'publish_grouping_plan(uuid,jsonb) not found';
  end if;

  if position('fsy-staff-placement:' in ddl) = 0 then
    old_text := E'  select count(*)::integer into arrived_checkin_count\n  from public.check_ins\n  where session_id = p_session_id and status = ''arrived'';';
    new_text := E'  -- Match the lock order used by day-of arrival flows: person row first,\n  -- then the session advisory lock. This blocks new placements briefly while the\n  -- live structure swaps, rather than deadlocking halfway through the replacement.\n  perform 1\n  from public.staff s\n  where s.session_id = p_session_id\n  order by s.id\n  for update;\n\n  perform 1\n  from public.participants p\n  where p.session_id = p_session_id\n  order by p.id\n  for update;\n\n  perform pg_advisory_xact_lock(hashtextextended(''fsy-staff-placement:'' || p_session_id::text, 0));\n  perform pg_advisory_xact_lock(hashtextextended(''fsy-arrival:'' || p_session_id::text, 0));\n\n  select count(*)::integer into arrived_checkin_count\n  from public.check_ins\n  where session_id = p_session_id and status = ''arrived'';';
    if position(old_text in ddl) = 0 then
      raise exception 'v70 could not locate arrival-count insertion point';
    end if;
    ddl := replace(ddl, old_text, new_text);
  end if;

  if position('set_config(''fsy.structure_republish'', ''on''' in ddl) = 0 then
    old_text := E'  delete from public.staff_company_assignments where session_id = p_session_id;';
    new_text := E'  perform set_config(''fsy.structure_republish'', ''on'', true);\n\n  delete from public.staff_company_assignments where session_id = p_session_id;';
    if position(old_text in ddl) = 0 then
      raise exception 'v70 could not locate staff-assignment reset';
    end if;
    ddl := replace(ddl, old_text, new_text);
  end if;

  if position('staff_scope.staff_id' in ddl) = 0 then
    old_text := E'  where s.id = x.staff_id;\n\n  update public.staff_operations o';
    new_text := E'  where s.id = x.staff_id;\n\n  perform set_config(''fsy.structure_republish'', ''off'', true);\n\n  perform private.sync_staff_login_access(staff_scope.staff_id)\n  from (\n    select distinct sca.staff_id\n    from public.staff_company_assignments sca\n    where sca.session_id = p_session_id\n  ) staff_scope;\n\n  update public.staff_operations o';
    if position(old_text in ddl) = 0 then
      raise exception 'v70 could not locate final AC scope refresh point';
    end if;
    ddl := replace(ddl, old_text, new_text);
  end if;

  execute ddl;
end;
$patch$;
