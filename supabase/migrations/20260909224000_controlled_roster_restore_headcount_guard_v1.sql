-- A roster-version restore may remove companies created after the saved point.
-- Never delete a company that has already entered Head count history. This is
-- a central guard, so later restore code cannot accidentally rely on checking
-- only one of the Head count tables.

create or replace function private.prevent_company_delete_with_headcount_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if exists(select 1 from public.headcount_round_people rp where rp.company_id=old.id)
    or exists(select 1 from public.headcount_person_statuses ps where ps.company_id=old.id)
    or exists(select 1 from public.headcount_submissions hs where hs.company_id=old.id)
  then
    raise exception 'Head-count history references this company. Void the related operational round before restoring an earlier roster version';
  end if;
  return old;
end;
$$;

revoke all on function private.prevent_company_delete_with_headcount_v1() from public;

drop trigger if exists company_headcount_delete_guard_v1 on public.companies;
create trigger company_headcount_delete_guard_v1
before delete on public.companies
for each row execute function private.prevent_company_delete_with_headcount_v1();
