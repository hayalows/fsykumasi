-- Use TG_OP explicitly so DELETE triggers never dereference NEW.
create or replace function private.sync_staff_company_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op='DELETE' then
    perform private.sync_staff_login_access(old.staff_id);
    return old;
  end if;
  perform private.sync_staff_login_access(new.staff_id);
  return new;
end;
$$;
