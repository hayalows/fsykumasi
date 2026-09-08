-- Approved staff already have source clearance. Newly captured on-site staff are created Awaiting by v26,
-- so source_kind alone must not force long-standing/manual leadership into confirmation_required.
create or replace function private.initialize_staff_operations() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.staff_operations(staff_id,planning_state,service_clearance)
 values(
  new.id,
  case
   when not new.is_current or new.registration_status='cancelled' then 'excluded'
   when new.registration_status='awaiting' then 'provisional'
   else 'reserve'
  end,
  case when new.registration_status='approved' then 'cleared' else 'confirmation_required' end
 ) on conflict do nothing;
 return new;
end $$;

update public.staff_operations o
set planning_state=case
    when not s.is_current or s.registration_status='cancelled' then 'excluded'
    when s.registration_status='awaiting' then 'provisional'
    when exists(select 1 from public.counselor_groups g where g.counselor_id=s.id)
      or exists(select 1 from public.staff_company_assignments a where a.staff_id=s.id) then 'primary'
    else 'reserve'
  end,
  service_clearance=case when s.registration_status='approved' then 'cleared' else 'confirmation_required' end,
  revision=o.revision+1,
  updated_at=now()
from public.staff s
where s.id=o.staff_id
  and s.source_kind='on_site'
  and s.registration_status='approved'
  and (o.planning_state='provisional' or o.service_clearance='confirmation_required');
