-- Complete the Area Advisory Couple role across the existing staff/account
-- workflows. The role is whole-program scoped through the v2 access helpers;
-- this migration adds it to the older validation and synchronization paths.

alter table public.staff
  drop constraint if exists staff_operational_role_check;

alter table public.staff
  add constraint staff_operational_role_check
  check (operational_role in (
    'counselor', 'assistant_coordinator', 'coordinator', 'committee_member',
    'logistics_admin', 'session_director', 'area_advisory_couple', 'other'
  ));

do $migration$
declare
  body text;
  replaced text;
begin
  select pg_get_functiondef(p.oid) into body
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='set_staff_operational_role' and p.pronargs=2;
  if body is not null then
    replaced:=replace(
      body,
      $$p_role not in ('counselor','assistant_coordinator','coordinator','committee_member','logistics_admin','session_director','other')$$,
      $$p_role not in ('counselor','assistant_coordinator','coordinator','committee_member','logistics_admin','session_director','area_advisory_couple','other')$$
    );
    if replaced<>body then execute replaced; end if;
  end if;

  select pg_get_functiondef(p.oid) into body
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='transition_staff_operational_role' and p.pronargs=5;
  if body is not null then
    replaced:=replace(
      body,
      $$p_role not in ('counselor','assistant_coordinator','coordinator','committee_member','logistics_admin','session_director','other')$$,
      $$p_role not in ('counselor','assistant_coordinator','coordinator','committee_member','logistics_admin','session_director','area_advisory_couple','other')$$
    );
    if replaced<>body then execute replaced; end if;
  end if;

  select pg_get_functiondef(p.oid) into body
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='create_manual_staff_leader' and p.pronargs=4;
  if body is not null then
    replaced:=replace(
      body,
      $$p_role not in ('assistant_coordinator','coordinator','logistics_admin','session_director')$$,
      $$p_role not in ('assistant_coordinator','coordinator','logistics_admin','session_director','area_advisory_couple')$$
    );
    if replaced<>body then execute replaced; end if;
  end if;

  select pg_get_functiondef(p.oid) into body
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='create_leader_invite' and p.pronargs=6;
  if body is not null then
    replaced:=replace(
      body,
      $$p_role not in ('coordinator','logistics_admin','session_director')$$,
      $$p_role not in ('coordinator','logistics_admin','session_director','area_advisory_couple')$$
    );
    if replaced<>body then execute replaced; end if;
  end if;

  select pg_get_functiondef(p.oid) into body
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='sync_staff_login_access' and p.pronargs=1;
  if body is not null then
    replaced:=replace(
      body,
      $$('coordinator','logistics_admin','session_director')$$,
      $$('coordinator','logistics_admin','session_director','area_advisory_couple')$$
    );
    if replaced<>body then execute replaced; end if;
  end if;

  select pg_get_functiondef(p.oid) into body
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='manage_leader_access' and p.pronargs=5;
  if body is not null then
    replaced:=replace(
      body,
      $$('coordinator','logistics_admin','session_director')$$,
      $$('coordinator','logistics_admin','session_director','area_advisory_couple')$$
    );
    if replaced<>body then execute replaced; end if;
  end if;
end;
$migration$;
