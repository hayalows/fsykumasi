-- Area Advisory Couples oversee the whole FSY program represented by this
-- workspace. Keep this enum change separate so later migrations can safely
-- reference the new value inside the same deployment history.
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid=e.enumtypid
    join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public'
      and t.typname='app_role'
      and e.enumlabel='area_advisory_couple'
  ) then
    alter type public.app_role add value 'area_advisory_couple';
  end if;
end;
$$;
