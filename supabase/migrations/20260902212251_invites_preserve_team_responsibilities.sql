create or replace function public.create_leader_invite(
  p_session_id uuid,
  p_email text,
  p_display_name text,
  p_role public.app_role,
  p_company_ids uuid[] default '{}',
  p_committee_scope text[] default '{}'
)
returns table(invite_id uuid, invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(p_email));
  normalized_name text := nullif(regexp_replace(trim(coalesce(p_display_name, '')), '\s+', ' ', 'g'), '');
  raw_code text; formatted_code text; new_id uuid;
  new_expiry timestamptz := now() + interval '7 days';
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Your account cannot invite leaders'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
  if normalized_name is null or length(normalized_name) < 2 or length(normalized_name) > 80 then raise exception 'Enter the leader''s name'; end if;
  if p_role = 'assistant_coordinator' then
    if coalesce(array_length(p_company_ids, 1), 0) = 0 then raise exception 'Select at least one company for an Assistant Coordinator'; end if;
    if exists (select 1 from unnest(p_company_ids) company_id where not exists (select 1 from public.companies c where c.id = company_id and c.session_id = p_session_id)) then raise exception 'One or more selected companies do not belong to this session'; end if;
  elsif p_role = 'committee_viewer' then
    if coalesce(array_length(p_committee_scope, 1), 0) = 0 then raise exception 'Choose at least one FSY team responsibility'; end if;
  elsif p_role not in ('coordinator','logistics_admin','session_director') then raise exception 'Unsupported role'; end if;
  if p_role in ('logistics_admin','session_director') and not private.is_top_access_admin(p_session_id) then raise exception 'Only top leadership can invite an elevated administrator'; end if;
  if exists(select 1 from unnest(coalesce(p_committee_scope,'{}')) scope_name where not exists(select 1 from public.operational_teams ot where ot.session_id=p_session_id and ot.active and lower(trim(scope_name)) in (lower(ot.team_key),lower(ot.display_name)))) then raise exception 'One or more team responsibilities are invalid'; end if;
  update public.leader_invites set status='revoked',revoked_at=now() where session_id=p_session_id and lower(email)=normalized_email and status in ('pending','activating') and purpose='onboarding';
  raw_code := upper(encode(extensions.gen_random_bytes(12),'hex'));
  formatted_code := 'FSY-'||substr(raw_code,1,4)||'-'||substr(raw_code,5,4)||'-'||substr(raw_code,9,4)||'-'||substr(raw_code,13,4)||'-'||substr(raw_code,17,4)||'-'||substr(raw_code,21,4);
  insert into public.leader_invites(session_id,email,display_name,role,company_ids,committee_scope,purpose,code_hash,created_by,expires_at)
  values(p_session_id,normalized_email,normalized_name,p_role,case when p_role='assistant_coordinator' then coalesce(p_company_ids,'{}') else '{}'::uuid[] end,coalesce(p_committee_scope,'{}'),'onboarding',encode(extensions.digest(replace(upper(formatted_code),'-',''),'sha256'),'hex'),(select auth.uid()),new_expiry)
  returning id into new_id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'leader_invite_created','leader_invite',new_id::text,jsonb_build_object('email',normalized_email,'role',p_role,'team_responsibilities',coalesce(p_committee_scope,'{}'),'purpose','onboarding'));
  return query select new_id,formatted_code,new_expiry;
end;
$$;
revoke all on function public.create_leader_invite(uuid,text,text,public.app_role,uuid[],text[]) from public,anon;
grant execute on function public.create_leader_invite(uuid,text,text,public.app_role,uuid[],text[]) to authenticated;