-- The application uses role-checked RPCs for every mutation. Removing unused
-- table DML grants narrows the browser attack surface and avoids duplicate
-- permissive SELECT policies created by FOR ALL management policies.

revoke insert, update, delete on
  public.companies,
  public.access_assignments,
  public.staff,
  public.counselor_groups,
  public.import_batches,
  public.participants
from authenticated;

drop policy if exists "top leaders manage access" on public.access_assignments;
drop policy if exists "top leaders manage companies" on public.companies;
drop policy if exists "top leaders manage staff" on public.staff;
drop policy if exists "operations manage groups" on public.counselor_groups;
drop policy if exists "top leaders manage imports" on public.import_batches;
drop policy if exists "top leaders manage participants" on public.participants;
