-- DEVELOPMENT / LOCAL SEED ONLY.
-- This file creates synthetic rehearsal data at the expected FSY Kumasi scale.
-- Never add real participant or staff information to source control.

insert into public.sessions(id, name, year, starts_on, ends_on, status)
values (
  '00000000-0000-4000-8000-000000002026'::uuid,
  'FSY Kumasi 2026 Development',
  2026,
  '2026-12-14',
  '2026-12-19',
  'planning'
)
on conflict (id) do update set
  name = excluded.name,
  year = excluded.year,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  status = excluded.status;

with synthetic as (
  select
    g as n,
    (array['Ama','Akosua','Abena','Adwoa','Esi','Yaa','Grace','Ruth','Mabel','Priscilla','Kwame','Kofi','Kojo','Yaw','Kwaku','Kwesi','Daniel','Joseph','Samuel','Michael'])[((g - 1) % 20) + 1] as first_name,
    (array['Mensah','Boateng','Owusu','Asare','Osei','Agyeman','Appiah','Frimpong','Antwi','Acheampong','Opoku','Darko','Adjei','Boadu','Amankwah','Sarpong'])[((g * 7 - 1) % 16) + 1] as last_name
  from generate_series(1, 1640) g
)
insert into public.participants(
  session_id,
  registration_id,
  first_name,
  last_name,
  sex,
  age,
  unit_name
)
select
  '00000000-0000-4000-8000-000000002026'::uuid,
  'DEV-' || lpad(n::text, 5, '0'),
  first_name,
  last_name,
  case when n % 2 = 0 then 'female'::public.participant_sex else 'male'::public.participant_sex end,
  14 + ((n - 1) % 5),
  'Synthetic Unit ' || lpad((((n - 1) % 120) + 1)::text, 3, '0')
from synthetic
on conflict (session_id, registration_id) do update set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  sex = excluded.sex,
  age = excluded.age,
  unit_name = excluded.unit_name,
  updated_at = now();
