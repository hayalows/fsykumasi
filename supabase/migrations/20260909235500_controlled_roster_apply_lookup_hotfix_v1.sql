-- Controlled final-roster apply hotfix.
-- PL/pgSQL variables named company_key/group_key collide with the temporary
-- table columns during runtime lookups. Use the source JSON values directly so
-- the lookup is deterministic and cannot be parsed as a variable/column clash.

do $migration$
declare
  body text;
  old_company text := 'where m.company_key=company_key;';
  new_company text := 'where m.company_key=(group_spec->>''company_key'');';
  old_group text := 'from tmp_apply_group_map m where m.group_key=group_key;';
  new_group text := 'from tmp_apply_group_map m where m.group_key=(placement->>''target_group_key'');';
begin
  select pg_get_functiondef('public.apply_controlled_final_roster_rebalance_v3(uuid)'::regprocedure)
  into body;

  if body is null then
    raise exception 'controlled final-roster v3 apply function is not installed';
  end if;

  if position(old_company in body) > 0 then
    body := replace(body, old_company, new_company);
  elsif position(new_company in body) = 0 then
    raise exception 'controlled final-roster company lookup is neither repaired nor repairable';
  end if;

  if position(old_group in body) > 0 then
    body := replace(body, old_group, new_group);
  elsif position(new_group in body) = 0 then
    raise exception 'controlled final-roster group lookup is neither repaired nor repairable';
  end if;

  execute body;
end
$migration$;
