-- Controlled final-roster planner hotfix.
-- PostgreSQL parses ANY((SELECT text_array ...)) as the subquery form of ANY,
-- which compares text to text[] and fails at runtime. Force the scalar
-- subquery through COALESCE so ANY receives a text[] expression.

do $migration$
declare
  body text;
  old_expr text := 'c.unit_key=any((select unit_keys from tmp_cr_groups where group_key=new_group_row.group_key))';
  new_expr text := 'c.unit_key=any(coalesce((select g_target.unit_keys from tmp_cr_groups g_target where g_target.group_key=new_group_row.group_key limit 1),''{}''::text[]))';
begin
  select pg_get_functiondef('private.controlled_final_roster_plan_v3(uuid)'::regprocedure)
  into body;

  if body is null then
    raise exception 'controlled final-roster v3 planner is not installed';
  end if;

  if position(old_expr in body) > 0 then
    body := replace(body, old_expr, new_expr);
    execute body;
  elsif position(new_expr in body) = 0 then
    raise exception 'controlled final-roster ward array expression is neither repaired nor repairable';
  end if;
end
$migration$;
