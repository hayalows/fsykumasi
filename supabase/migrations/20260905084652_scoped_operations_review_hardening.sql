-- Bound live polling to the selected roster, and keep Overview aggregate-only.
create or replace function public.open_headcount_round_v3(p_session_id uuid,p_label text)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[]) then raise exception 'Session leadership required'; end if;
 if nullif(trim(p_label),'') is null or length(trim(p_label))>80 then raise exception 'Enter a round label of 1 to 80 characters'; end if;
 perform 1 from public.sessions where id=p_session_id for update;
 if exists(select 1 from public.headcount_rounds where session_id=p_session_id and roster_version=3 and closes_at is null) then raise exception 'Close the current round before opening another'; end if;
 insert into public.headcount_rounds(session_id,label,created_by,roster_version) values(p_session_id,trim(p_label),(select auth.uid()),3) returning id into rid;
 insert into public.headcount_round_people(session_id,round_id,company_id,person_type,person_id,display_name,fsy_id,company_name,group_name)
 select p_session_id,rid,c.id,'participant',p.id,trim(concat_ws(' ',p.first_name,p.last_name)),b.fsy_id,coalesce(nullif(c.custom_name,''),c.name,'Unassigned participants'),coalesce(nullif(g.custom_name,''),g.name)
 from public.participants p
 left join public.counselor_groups g on g.id=p.group_id and g.session_id=p.session_id
 left join public.companies c on c.id=g.company_id and c.session_id=p.session_id
 left join public.participant_badge_assignments b on b.session_id=p.session_id and b.participant_id=p.id and b.state<>'retired'
 where p.session_id=p_session_id and private.operational_participant_is_eligible(p_session_id,p.id)
 and (b.id is not null or not exists(select 1 from public.participant_badge_assignments x where x.participant_id=p.id and x.session_id=p_session_id));
 -- Each staff member appears once. Their primary company owns reporting.
 insert into public.headcount_round_people(session_id,round_id,company_id,person_type,person_id,display_name,company_name,group_name)
 select p_session_id,rid,c.id,'staff',s.id,s.full_name,coalesce(nullif(c.custom_name,''),c.name,'Session staff'),s.operational_role
 from public.staff s
 left join public.companies c on c.session_id=s.session_id and c.id=coalesce(s.assigned_company_id,(select g.company_id from public.counselor_groups g where g.session_id=s.session_id and g.counselor_id=s.id order by g.id limit 1),(select a.company_id from public.staff_company_assignments a where a.session_id=s.session_id and a.staff_id=s.id order by a.assigned_at,a.company_id limit 1))
 where s.session_id=p_session_id and s.is_current and s.registration_status='approved';
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_session_id,(select auth.uid()),'headcount_roster_opened','headcount_round',rid::text,jsonb_build_object('roster_count',(select count(*) from public.headcount_round_people where round_id=rid)));
 return rid;
end; $$;
revoke all on function public.open_headcount_round_v3(uuid,text) from public,anon;
grant execute on function public.open_headcount_round_v3(uuid,text) to authenticated;

create or replace function public.get_headcount_roster_v4(p_session_id uuid,p_round_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not (private.has_capability(p_session_id,'headcount_view') or private.has_capability(p_session_id,'headcount_record')) then return jsonb_build_object('rounds','[]'::jsonb,'people','[]'::jsonb); end if;
 return jsonb_build_object(
 'rounds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'label',r.label,'opens_at',r.opens_at,'closes_at',r.closes_at) order by r.opens_at desc) from public.headcount_rounds r where r.session_id=p_session_id and r.roster_version=3),'[]'::jsonb),
 'people',coalesce((select jsonb_agg(to_jsonb(p) - 'recorded_by' order by p.company_name,p.display_name,p.id) from public.headcount_round_people p where p.session_id=p_session_id and p.round_id=coalesce(p_round_id,(select r.id from public.headcount_rounds r where r.session_id=p_session_id and r.roster_version=3 order by r.opens_at desc limit 1)) and (private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[]) or (p.company_id is not null and private.can_access_company(p_session_id,p.company_id)))),'[]'::jsonb));
end; $$;
revoke all on function public.get_headcount_roster_v4(uuid,uuid) from public,anon;
grant execute on function public.get_headcount_roster_v4(uuid,uuid) to authenticated;


create or replace function public.get_headcount_summary_v3(p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with current_round as (
 select r.* from public.headcount_rounds r where r.session_id=p_session_id and r.roster_version=3
 and (private.has_capability(p_session_id,'headcount_view') or private.has_capability(p_session_id,'headcount_record'))
 order by r.opens_at desc limit 1
 ), visible as (
 select p.* from public.headcount_round_people p join current_round r on r.id=p.round_id
 where private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
 or (p.company_id is not null and private.can_access_company(p_session_id,p.company_id))
 ) select jsonb_build_object('round',(select jsonb_build_object('id',id,'label',label,'opens_at',opens_at,'closes_at',closes_at) from current_round),
 'unresolved',(select count(*) from visible where status='unresolved'),
 'missing',(select count(*) from visible where status='missing'),
 'total',(select count(*) from visible));
$$;
revoke all on function public.get_headcount_summary_v3(uuid) from public,anon;
grant execute on function public.get_headcount_summary_v3(uuid) to authenticated;
