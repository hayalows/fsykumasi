-- Keep the operational team capability allow-list explicit while adding the two
-- new Registration responsibilities used by FSY IDs and arrival reconciliation.

alter table public.operational_teams
  drop constraint if exists operational_teams_capabilities_check;

alter table public.operational_teams
  add constraint operational_teams_capabilities_check
  check (capabilities <@ array[
    'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
    'housing_view','housing_manage','housing_export',
    'wellness_status','wellness_private','wellness_manage',
    'food_view','food_manage','food_export',
    'registration_view','registration_manage','identity_manage','arrival_manage',
    'staff_view','staff_manage','inclusion_view','facilities_view','materials_view',
    'financial_view','publicity_view','reports_export'
  ]::text[]);
