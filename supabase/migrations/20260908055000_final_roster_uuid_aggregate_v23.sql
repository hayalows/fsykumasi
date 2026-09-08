-- Final roster v23: PostgreSQL does not define min(uuid).
-- The final-roster apply path only needs the UUID from identity groups whose count is exactly one,
-- so take the sole UUID from array_agg instead of using min(). This preserves the v21 matching semantics.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.apply_final_registration_baseline(uuid,text,text,jsonb)'::regprocedure)
  into v_def;

  if position('min(p.id) as target_id' in v_def) = 0 then
    raise exception 'Expected participant UUID aggregate was not found in apply_final_registration_baseline';
  end if;
  if position('min(st.id) as target_id' in v_def) = 0 then
    raise exception 'Expected Staff UUID aggregate was not found in apply_final_registration_baseline';
  end if;

  v_def := replace(v_def, 'min(p.id) as target_id', '(array_agg(p.id))[1] as target_id');
  v_def := replace(v_def, 'min(st.id) as target_id', '(array_agg(st.id))[1] as target_id');

  execute v_def;
end;
$$;

-- Keep the same explicit API grants after replacing the function definition.
revoke all on function public.apply_final_registration_baseline(uuid,text,text,jsonb) from public, anon;
grant execute on function public.apply_final_registration_baseline(uuid,text,text,jsonb) to authenticated, service_role;
