-- Controlled final-roster apply hotfix.
-- The counselor repair update used the same identifier for a PL/pgSQL variable
-- and a table column. Qualify the variables with the function block name.

do $migration$
declare
  body text;
  old_expr text := 'update public.counselor_groups set counselor_id=counselor_id where id=group_id;';
  new_expr text := 'update public.counselor_groups set counselor_id=apply_controlled_final_roster_rebalance_v3.counselor_id where id=apply_controlled_final_roster_rebalance_v3.group_id;';
begin
  select pg_get_functiondef('public.apply_controlled_final_roster_rebalance_v3(uuid)'::regprocedure)
  into body;

  if body is null then
    raise exception 'controlled final-roster v3 apply function is not installed';
  end if;

  if position(old_expr in body) > 0 then
    body := replace(body, old_expr, new_expr);
    execute body;
  elsif position(new_expr in body) = 0 then
    raise exception 'controlled final-roster counselor assignment is neither repaired nor repairable';
  end if;
end
$migration$;
