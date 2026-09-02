-- A clearly separated synthetic rehearsal workspace on production.
-- The real FSY Kumasi 2026 session remains untouched. Existing top-level
-- administrators receive the same role in this training session so they can
-- test the live Vercel application without importing real youth data.

insert into public.sessions(id, name, year, starts_on, ends_on, status)
values (
  '00000000-0000-4000-9000-000000002026'::uuid,
  'FSY Kumasi 2026 Training Sandbox',
  2026,
  '2026-09-14',
  '2026-09-19',
  'training'
)
on conflict (id) do update set
  name = excluded.name,
  year = excluded.year,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  status = excluded.status;

with synthetic as (
  select
    g,
    (array['Abena','Akosua','Ama','Adwoa','Afia','Esi','Yaa','Nana','Kwame','Kofi','Kojo','Yaw','Kwaku','Kwesi','Fiifi','Elorm','Priscilla','Mabel','Ruth','Grace','Daniel','Joseph','Samuel','Michael'])[((g * 7 + floor(g / 11.0)::int - 1) % 24) + 1] as first_name,
    (array['Mensah','Boateng','Owusu','Asare','Osei','Agyeman','Appiah','Frimpong','Antwi','Acheampong','Opoku','Darko','Adjei','Boadu','Amankwah','Sarpong'])[((g * 5 + floor(g / 13.0)::int - 1) % 16) + 1] as last_name,
    14 + ((g - 1) % 5) as age,
    case when g % 2 = 0 then 'female'::public.participant_sex else 'male'::public.participant_sex end as sex,
    'Training Unit ' || lpad((((g - 1) % 120) + 1)::text, 3, '0') as unit_name,
    'Training Stake ' || lpad((((g - 1) % 8) + 1)::text, 2, '0') as stake_name,
    case when g <= 1590 then 'approved' when g <= 1625 then 'awaiting' else 'cancelled' end as registration_status
  from generate_series(1, 1640) g
)
insert into public.participants(
  session_id, registration_id, source_record_key, first_name, last_name, preferred_name,
  sex, age, unit_name, stake_name, source_kind, registration_status,
  verification_status, is_current, reconciliation_status, source_registered_at
)
select
  '00000000-0000-4000-9000-000000002026'::uuid,
  'TRAIN-' || lpad(g::text, 5, '0'),
  md5('training-a-' || g::text) || md5('training-b-' || g::text),
  first_name, last_name,
  case when g % 11 = 0 then first_name else null end,
  sex, age, unit_name, stake_name,
  'imported', registration_status, 'verified', true, 'current',
  timestamp '2026-08-01 09:00:00' + (g % 25) * interval '1 day'
from synthetic
on conflict (session_id, registration_id) do update set
  source_record_key = excluded.source_record_key,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  preferred_name = excluded.preferred_name,
  sex = excluded.sex,
  age = excluded.age,
  unit_name = excluded.unit_name,
  stake_name = excluded.stake_name,
  source_kind = excluded.source_kind,
  registration_status = excluded.registration_status,
  verification_status = excluded.verification_status,
  is_current = true,
  reconciliation_status = 'current',
  source_registered_at = excluded.source_registered_at,
  updated_at = now();

insert into public.participant_private_details(
  participant_id, session_id, date_of_birth, email, phone, tshirt_size
)
select
  p.id,
  p.session_id,
  case
    when substring(p.registration_id from 7)::int <= 36 then
      make_date(
        2026 - p.age - 1,
        9,
        14 + ((substring(p.registration_id from 7)::int - 1) % 6)
      )
    else
      make_date(
        2026 - p.age,
        1 + (substring(p.registration_id from 7)::int % 8),
        1 + (substring(p.registration_id from 7)::int % 28)
      )
  end,
  lower(p.first_name || '.' || p.last_name || substring(p.registration_id from 7) || '@training.invalid'),
  '+233200' || lpad(substring(p.registration_id from 7), 4, '0'),
  (array['S','M','L','XL'])[((substring(p.registration_id from 7)::int - 1) % 4) + 1]
from public.participants p
where p.session_id = '00000000-0000-4000-9000-000000002026'::uuid
on conflict (participant_id) do update set
  date_of_birth = excluded.date_of_birth,
  email = excluded.email,
  phone = excluded.phone,
  tshirt_size = excluded.tshirt_size,
  updated_at = now();

with synthetic_staff as (
  select
    g,
    (array['Ama','Akosua','Abena','Adwoa','Esi','Yaa','Grace','Ruth','Mabel','Priscilla','Kwame','Kofi','Kojo','Yaw','Kwaku','Kwesi','Daniel','Joseph','Samuel','Michael'])[((g - 1) % 20) + 1] as first_name,
    (array['Mensah','Boateng','Owusu','Asare','Osei','Agyeman','Appiah','Frimpong','Antwi','Acheampong','Opoku','Darko','Adjei','Boadu','Amankwah','Sarpong'])[((g * 7 - 1) % 16) + 1] as last_name
  from generate_series(1, 265) g
)
insert into public.staff(
  session_id, full_name, first_name, last_name, sex, age,
  unit_name, stake_name, staff_role, source_record_key, registration_status,
  is_current, source_registered_at
)
select
  '00000000-0000-4000-9000-000000002026'::uuid,
  first_name || ' ' || last_name,
  first_name, last_name,
  case when g % 2 = 0 then 'female'::public.participant_sex else 'male'::public.participant_sex end,
  19 + ((g - 1) % 10),
  'Training Unit ' || lpad((((g - 1) % 120) + 1)::text, 3, '0'),
  'Training Stake ' || lpad((((g - 1) % 8) + 1)::text, 2, '0'),
  'counselor',
  md5('training-staff-a-' || g::text) || md5('training-staff-b-' || g::text),
  case when g <= 250 then 'approved' when g <= 260 then 'awaiting' else 'cancelled' end,
  true,
  timestamp '2026-08-03 10:00:00' + (g % 20) * interval '1 day'
from synthetic_staff
on conflict (session_id, source_record_key) where source_record_key is not null
do update set
  full_name = excluded.full_name,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  sex = excluded.sex,
  age = excluded.age,
  unit_name = excluded.unit_name,
  stake_name = excluded.stake_name,
  registration_status = excluded.registration_status,
  is_current = true,
  source_registered_at = excluded.source_registered_at;

-- Mirror only real top-level FSY administrators into the sandbox. No synthetic
-- auth accounts are created, and normal coordinators/ACs remain absent until
-- an administrator deliberately invites them while testing.
insert into public.access_assignments(session_id, user_id, role, company_ids, committee_scope, active, capabilities)
select
  '00000000-0000-4000-9000-000000002026'::uuid,
  aa.user_id,
  aa.role,
  '{}'::uuid[],
  '{}'::text[],
  true,
  aa.capabilities
from public.access_assignments aa
join public.sessions s on s.id = aa.session_id
where s.name = 'FSY Kumasi 2026'
  and aa.active
  and aa.role in ('logistics_admin','session_director')
on conflict (session_id, user_id, role) do update set
  active = true,
  capabilities = excluded.capabilities;
