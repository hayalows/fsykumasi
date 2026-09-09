-- The approved youth operating window is 12 through 19 at session start.
-- Keep the structure settings aligned for screens and older planning helpers;
-- the v2 operational eligibility function remains the server authority.

alter table public.session_structure_settings
  alter column participant_min_age set default 12,
  alter column participant_max_age set default 19;

update public.session_structure_settings
set participant_min_age=12,
    participant_max_age=19,
    updated_at=now();
