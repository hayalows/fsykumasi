-- Keep invalid or incomplete ages visible for review while continuing to hide
-- age 20+ from the active participant worklist.
do $migration$
declare
  fn text;
begin
  select pg_get_functiondef('public.get_arrival_reconciliation(uuid)'::regprocedure)
    into fn;
  fn:=replace(fn, ') between 12 and 19', ') < 20');
  execute fn;
end;
$migration$;
