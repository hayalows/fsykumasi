-- v71: qualify tmp_new_companies.company_index inside the PL/pgSQL function.
-- The function also has a company_index variable, so an unqualified reference is
-- ambiguous at runtime even though the function body parses successfully.

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

  old_text := E'  with ranked_companies as (\n    select company_id, company_index,\n      ceil(company_index::numeric / assistant_load)::integer as assistant_rn\n    from tmp_new_companies\n  ), ranked_assistants as (';
  new_text := E'  with ranked_companies as (\n    select nc.company_id, nc.company_index,\n      ceil(nc.company_index::numeric / assistant_load)::integer as assistant_rn\n    from tmp_new_companies nc\n  ), ranked_assistants as (';

  if position(old_text in ddl) > 0 then
    ddl := replace(ddl, old_text, new_text);
    execute ddl;
  elsif position('select nc.company_id, nc.company_index' in ddl) = 0 then
    raise exception 'v71 could not locate company ranking block';
  end if;
end;
$patch$;
