-- Live structure republish v68.
-- participants stores first_name / last_name rather than a generated full_name column.
-- Patch the v67 function definition in place so identity ordering and badge naming use
-- the actual participant schema. The guard makes this safe on databases where v67 has
-- already been corrected before these migrations are replayed.

do $fix$
declare
  ddl text;
begin
  select pg_get_functiondef(p.oid)
  into ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'publish_grouping_plan'
    and pg_get_function_identity_arguments(p.oid) = 'p_session_id uuid, p_plan jsonb';

  if ddl is not null and position('p.full_name' in ddl) > 0 then
    ddl := replace(ddl, 'p.full_name', 'concat_ws('' '', p.first_name, p.last_name)');
    execute ddl;
  end if;
end;
$fix$;
