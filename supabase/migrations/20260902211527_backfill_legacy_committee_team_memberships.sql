insert into public.team_memberships(session_id,team_id,user_id,active,assigned_by)
select distinct aa.session_id,ot.id,aa.user_id,true,null::uuid
from public.access_assignments aa
join public.operational_teams ot on ot.session_id=aa.session_id and ot.active
where aa.active and aa.role='committee_viewer'
  and exists (
    select 1 from unnest(aa.committee_scope) scope_name
    where lower(trim(scope_name)) in (lower(ot.display_name),lower(ot.team_key),lower(coalesce(ot.preset_key,'')))
  )
on conflict(session_id,team_id,user_id)
do update set active=true,updated_at=now();