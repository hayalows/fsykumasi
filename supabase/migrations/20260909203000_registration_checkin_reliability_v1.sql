-- Repair the final-roster settings hotfix and align the approved leadership roles.
-- The source registration snapshot remains unchanged. These changes only restore
-- operational reads/actions and keep the existing audit trail.

do $migration$
declare
  body text;
  replaced text;
begin
  body := pg_get_functiondef('public.get_session_finalization_preview_v2(uuid)'::regprocedure);
  replaced := replace(
    body,
    'groups_per_company:=greatest(coalesce(ss.groups_per_company,2),1);',
    'groups_per_company:=greatest(coalesce(groups_per_company,2),1);'
  );
  if replaced <> body then
    execute replaced;
  elsif position('groups_per_company:=greatest(coalesce(groups_per_company,2),1);' in body) = 0 then
    raise exception 'Final-roster preview settings normalization is neither repaired nor repairable';
  end if;

  body := pg_get_functiondef('public.apply_session_finalization_v2(uuid)'::regprocedure);
  replaced := replace(
    body,
    'groups_per_company:=greatest(coalesce(ss.groups_per_company,2),1);',
    'groups_per_company:=greatest(coalesce(groups_per_company,2),1);'
  );
  if replaced <> body then
    execute replaced;
  elsif position('groups_per_company:=greatest(coalesce(groups_per_company,2),1);' in body) = 0 then
    raise exception 'Final-roster apply settings normalization is neither repaired nor repairable';
  end if;
end;
$migration$;

do $migration$
declare
  body text;
  replaced text;
begin
  body := pg_get_functiondef('public.update_staff_operations(uuid,integer,text,text,text,text,text,text[])'::regprocedure);
  replaced := replace(
    body,
    'array[''logistics_admin'',''session_director'']::public.app_role[]',
    'array[''coordinator'',''logistics_admin'',''session_director'',''area_advisory_couple'']::public.app_role[]'
  );
  if replaced = body and position('array[''coordinator'',''logistics_admin'',''session_director'',''area_advisory_couple'']::public.app_role[]' in body) = 0 then
    raise exception 'Expected staff clearance authority rule was not found';
  end if;
  if replaced <> body then execute replaced; end if;

  body := pg_get_functiondef('public.set_staff_operational_status_v1(uuid,text,integer,text,text)'::regprocedure);
  replaced := replace(
    body,
    'array[''coordinator'',''logistics_admin'',''session_director'']::public.app_role[]',
    'array[''coordinator'',''logistics_admin'',''session_director'',''area_advisory_couple'']::public.app_role[]'
  );
  if replaced = body and position('array[''coordinator'',''logistics_admin'',''session_director'',''area_advisory_couple'']::public.app_role[]' in body) = 0 then
    raise exception 'Expected staff lifecycle authority rule was not found';
  end if;
  if replaced <> body then execute replaced; end if;

  body := pg_get_functiondef('public.assign_participant_to_group(uuid,uuid)'::regprocedure);
  replaced := replace(
    body,
    'array[''coordinator'',''logistics_admin'',''session_director'']::public.app_role[]',
    'array[''coordinator'',''logistics_admin'',''session_director'',''area_advisory_couple'']::public.app_role[]'
  );
  if replaced = body and position('array[''coordinator'',''logistics_admin'',''session_director'',''area_advisory_couple'']::public.app_role[]' in body) = 0 then
    raise exception 'Expected participant placement authority rule was not found';
  end if;
  if replaced <> body then execute replaced; end if;
end;
$migration$;

revoke all on function public.update_staff_operations(uuid,integer,text,text,text,text,text,text[]) from public, anon;
grant execute on function public.update_staff_operations(uuid,integer,text,text,text,text,text,text[]) to authenticated;
revoke all on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) from public, anon;
grant execute on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) to authenticated;
revoke all on function public.set_staff_operational_status_v1(uuid,text,integer,text,text) from public, anon;
grant execute on function public.set_staff_operational_status_v1(uuid,text,integer,text,text) to authenticated;
revoke all on function public.assign_participant_to_group(uuid,uuid) from public, anon;
grant execute on function public.assign_participant_to_group(uuid,uuid) to authenticated;
