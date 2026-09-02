-- The 2026 Kumasi session dates drive birthday and operational scheduling.
update public.sessions
set starts_on = date '2026-09-14', ends_on = date '2026-09-19'
where year = 2026 and lower(name) like '%kumasi%';

-- Snapshot reconciliation is now safe after grouping: assigned or checked-in
-- omissions are retained as exceptions and on-site rows are never overwritten.
drop trigger if exists participants_lock_import_after_grouping on public.participants;

-- Keep the established, heavily validated grouping transaction and narrow only
-- its eligibility set. Assertions make schema drift fail the migration loudly.
do $$
declare
  definition text := pg_get_functiondef('public.publish_grouping_plan(uuid,jsonb)'::regprocedure);
  original text;
begin
  original := definition;
  definition := replace(definition,
    'from public.participants p where p.session_id = p_session_id;',
    'from public.participants p where p.session_id = p_session_id and p.is_current and p.registration_status = ''approved'' and p.verification_status = ''verified'';');
  if definition = original then raise exception 'Unable to patch grouping eligibility count'; end if;
  original := definition;
  definition := replace(definition,
    'where p.id is null',
    'where p.id is null or not p.is_current or p.registration_status <> ''approved'' or p.verification_status <> ''verified''');
  if definition = original then raise exception 'Unable to patch grouping membership validation'; end if;
  execute definition;
end;
$$;

do $$
declare
  definition text := pg_get_functiondef('public.submit_company_headcount(uuid,uuid,integer,text)'::regprocedure);
  original text;
begin
  original := definition;
  definition := replace(definition,
    'where g.company_id = p_company_id and p.session_id = target_session;',
    'where g.company_id = p_company_id and p.session_id = target_session and p.is_current and p.registration_status = ''approved'' and p.verification_status = ''verified'';');
  if definition = original then raise exception 'Unable to patch head-count eligibility'; end if;
  execute definition;
end;
$$;
