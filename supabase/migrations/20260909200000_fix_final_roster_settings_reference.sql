-- Fix the deployed v2 final-roster functions without changing roster data.
-- The functions declare a groups_per_company variable, so the settings column
-- must be qualified or PostgreSQL reports an ambiguous column reference.
do $migration$
declare
  fn text;
begin
  select pg_get_functiondef('public.get_session_finalization_preview_v2(uuid)'::regprocedure)
    into fn;
  fn:=replace(fn,
    'from public.session_structure_settings where session_id=p_session_id;',
    'from public.session_structure_settings ss where ss.session_id=p_session_id;');
  fn:=replace(fn,
    'coalesce(group_min_size,8)',
    'coalesce(ss.group_min_size,8)');
  fn:=replace(fn,
    'coalesce(group_max_size,10)',
    'coalesce(ss.group_max_size,10)');
  fn:=replace(fn,
    'coalesce(groups_per_company,2)',
    'coalesce(ss.groups_per_company,2)');
  fn:=replace(fn,
    'coalesce(avoid_same_unit,true)',
    'coalesce(ss.avoid_same_unit,true)');
  execute fn;

  select pg_get_functiondef('public.apply_session_finalization_v2(uuid)'::regprocedure)
    into fn;
  fn:=replace(fn,
    'from public.session_structure_settings where session_id=p_session_id;',
    'from public.session_structure_settings ss where ss.session_id=p_session_id;');
  fn:=replace(fn,
    'coalesce(group_min_size,8)',
    'coalesce(ss.group_min_size,8)');
  fn:=replace(fn,
    'coalesce(group_max_size,10)',
    'coalesce(ss.group_max_size,10)');
  fn:=replace(fn,
    'coalesce(groups_per_company,2)',
    'coalesce(ss.groups_per_company,2)');
  fn:=replace(fn,
    'coalesce(avoid_same_unit,true)',
    'coalesce(ss.avoid_same_unit,true)');
  execute fn;
end;
$migration$;
