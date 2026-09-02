-- Mixed ages are the normal FSY planning model for this operations tool.
-- Same-sex counselor groups remain unchanged; this only removes the age-band split.

alter table public.session_structure_settings
  alter column use_age_bands set default false;

update public.session_structure_settings settings
set use_age_bands = false,
    updated_at = now()
from public.sessions session
where session.id = settings.session_id
  and session.status = 'planning'
  and settings.use_age_bands = true;
