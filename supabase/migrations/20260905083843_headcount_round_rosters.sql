-- New rounds capture a roster. Existing reports remain untouched and readable.
alter table public.headcount_rounds add column if not exists roster_version integer not null default 1;
create table public.headcount_round_people (
 id uuid primary key default extensions.gen_random_uuid(),
 session_id uuid not null references public.sessions(id),
 round_id uuid not null references public.headcount_rounds(id),
 company_id uuid references public.companies(id),
 person_type text not null check(person_type in ('participant','staff')),
 person_id uuid not null,
 display_name text not null,
 fsy_id text,
 company_name text not null,
 group_name text,
 status text not null default 'unresolved' check(status in ('unresolved','present','missing','known_elsewhere','not_expected')),
 note text,
 revision integer not null default 0,
 recorded_by uuid references public.profiles(user_id),
 recorded_at timestamptz,
 unique(round_id,person_type,person_id)
);
create index headcount_round_people_scope_idx on public.headcount_round_people(session_id,round_id,company_id);
alter table public.headcount_round_people enable row level security;
revoke all on public.headcount_round_people from public,anon,authenticated;
-- RPC-only access avoids exposing the entire session roster via direct writes.
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
 left join public.companies c on c.session_id=s.session_id and c.id=coalesce(s.assigned_company_id,(select a.company_id from public.staff_company_assignments a where a.session_id=s.session_id and a.staff_id=s.id order by a.assigned_at,a.company_id limit 1))
 where s.session_id=p_session_id and s.is_current and s.registration_status='approved';
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_session_id,(select auth.uid()),'headcount_roster_opened','headcount_round',rid::text,jsonb_build_object('roster_count',(select count(*) from public.headcount_round_people where round_id=rid)));
 return rid;
end; $$;
revoke all on function public.open_headcount_round_v3(uuid,text) from public,anon;
grant execute on function public.open_headcount_round_v3(uuid,text) to authenticated;

create or replace function public.get_headcount_roster_v3(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not (private.has_capability(p_session_id,'headcount_view') or private.has_capability(p_session_id,'headcount_record')) then return jsonb_build_object('rounds','[]'::jsonb,'people','[]'::jsonb); end if;
 return jsonb_build_object(
 'rounds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'label',r.label,'opens_at',r.opens_at,'closes_at',r.closes_at) order by r.opens_at desc) from public.headcount_rounds r where r.session_id=p_session_id and r.roster_version=3),'[]'::jsonb),
 'people',coalesce((select jsonb_agg(to_jsonb(p) - 'recorded_by' order by p.company_name,p.display_name,p.id) from public.headcount_round_people p where p.session_id=p_session_id and (private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[]) or (p.company_id is not null and private.can_access_company(p_session_id,p.company_id)))),'[]'::jsonb));
end; $$;
revoke all on function public.get_headcount_roster_v3(uuid) from public,anon;
grant execute on function public.get_headcount_roster_v3(uuid) to authenticated;

create or replace function public.set_headcount_person_v3(p_id uuid,p_status text,p_revision integer,p_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare target public.headcount_round_people%rowtype; closed timestamptz;
begin
 select * into target from public.headcount_round_people where id=p_id;
 if target.id is null then raise exception 'Person unavailable'; end if;
 if not private.has_capability(target.session_id,'headcount_record') or not (private.has_session_role(target.session_id,array['coordinator','logistics_admin','session_director']::public.app_role[]) or (target.company_id is not null and private.can_access_company(target.session_id,target.company_id))) then raise exception 'Head-count reporting is outside your scope'; end if;
 select closes_at into closed from public.headcount_rounds where id=target.round_id for update;
 if closed is not null then raise exception 'This round is closed'; end if;
 if p_status is null or p_status not in ('unresolved','present','missing','known_elsewhere','not_expected') then raise exception 'Invalid status'; end if;
 if p_status in ('known_elsewhere','not_expected') and nullif(trim(p_note),'') is null then raise exception 'Add a location or reason'; end if;
 update public.headcount_round_people set status=p_status,note=nullif(trim(p_note),''),revision=revision+1,recorded_by=(select auth.uid()),recorded_at=now() where id=p_id and revision=p_revision;
 if not found then raise exception 'Someone updated this person. Refresh and review the latest status'; end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(target.session_id,(select auth.uid()),'headcount_person_updated','headcount_round_person',p_id::text,jsonb_build_object('round_id',target.round_id,'previous_status',target.status,'status',p_status));
end; $$;
revoke all on function public.set_headcount_person_v3(uuid,text,integer,text) from public,anon;
grant execute on function public.set_headcount_person_v3(uuid,text,integer,text) to authenticated;

create or replace function public.confirm_headcount_company_v3(p_round_id uuid,p_company_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare sid uuid; closed timestamptz;
begin
 select session_id,closes_at into sid,closed from public.headcount_rounds where id=p_round_id and roster_version=3 for update;
 if sid is null or closed is not null then raise exception 'Open round required'; end if;
 if not private.has_capability(sid,'headcount_record') or not (private.has_session_role(sid,array['coordinator','logistics_admin','session_director']::public.app_role[]) or (p_company_id is not null and private.can_access_company(sid,p_company_id))) then raise exception 'Company reporting is outside your scope'; end if;
 -- Do not erase an existing exception while confirming unchecked people.
 update public.headcount_round_people set status='present',revision=revision+1,recorded_by=(select auth.uid()),recorded_at=now()
 where round_id=p_round_id and company_id is not distinct from p_company_id and status='unresolved';
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(sid,(select auth.uid()),'headcount_company_confirmed','headcount_round',p_round_id::text,jsonb_build_object('company_id',p_company_id,'scope','previously_unresolved_only'));
end; $$;
revoke all on function public.confirm_headcount_company_v3(uuid,uuid) from public,anon;
grant execute on function public.confirm_headcount_company_v3(uuid,uuid) to authenticated;

create or replace function public.close_headcount_round_v3(p_round_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 select session_id into sid from public.headcount_rounds where id=p_round_id and roster_version=3 and closes_at is null for update;
 if sid is null then raise exception 'Open round required'; end if;
 if not private.has_session_role(sid,array['coordinator','logistics_admin','session_director']::public.app_role[]) then raise exception 'Session leadership required'; end if;
 if exists(select 1 from public.headcount_round_people where round_id=p_round_id and status in ('unresolved','missing')) then raise exception 'Resolve missing and unchecked people before closing'; end if;
 update public.headcount_rounds set closes_at=now() where id=p_round_id;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id) values(sid,(select auth.uid()),'headcount_round_closed','headcount_round',p_round_id::text);
end; $$;
revoke all on function public.close_headcount_round_v3(uuid) from public,anon;
grant execute on function public.close_headcount_round_v3(uuid) to authenticated;

create or replace function public.get_headcount_workspace(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_capability(p_session_id, 'headcount_view') or private.has_capability(p_session_id, 'headcount_record')) then
    return jsonb_build_object('rounds','[]'::jsonb,'companies','[]'::jsonb,'submissions','[]'::jsonb,'people','[]'::jsonb,'person_statuses','[]'::jsonb);
  end if;
  return (
    with visible_companies as (
      select c.id, c.name, c.custom_name, c.meeting_spot, c.operational_number,
        private.expected_participant_count(p_session_id, c.id) as expected_count,
        (select count(*)::integer from public.counselor_groups g where g.session_id = p_session_id and g.company_id = c.id and g.state = 'published') as group_count
      from public.companies c
      where c.session_id = p_session_id
        and (
          private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
          or private.can_access_company(p_session_id, c.id)
        )
    ),
    visible_rounds as (
      select r.id, r.label, r.opens_at, r.closes_at
      from public.headcount_rounds r where r.session_id = p_session_id and r.roster_version=1
    ),
    visible_people as (
      select p.id as participant_id, p.registration_id, p.group_id, g.name as group_name,
        coalesce(nullif(g.custom_name, ''), g.name) as group_display_name,
        c.id as company_id, coalesce(nullif(c.custom_name, ''), c.name) as company_name,
        b.fsy_id, trim(concat_ws(' ', p.first_name, p.last_name)) as display_name
      from public.participants p
      join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id and g.state = 'published'
      join visible_companies c on c.id = g.company_id
      left join lateral (
        select badge.fsy_id
        from public.participant_badge_assignments badge
        where badge.session_id = p_session_id and badge.participant_id = p.id and badge.state <> 'retired'
        order by badge.assigned_at desc
        limit 1
      ) b on true
      where p.session_id = p_session_id
        and private.operational_participant_is_eligible(p_session_id, p.id)
        and (
          not exists(
            select 1 from public.participant_badge_assignments b
            where b.session_id = p_session_id and b.participant_id = p.id
          )
          or exists(
            select 1 from public.participant_badge_assignments b
            where b.session_id = p_session_id and b.participant_id = p.id and b.state <> 'retired'
          )
        )
    )
    select jsonb_build_object(
      'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label, 'opens_at', r.opens_at, 'closes_at', r.closes_at) order by r.opens_at desc) from visible_rounds r), '[]'::jsonb),
      'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'display_name', coalesce(nullif(c.custom_name, ''), c.name), 'meeting_spot', c.meeting_spot, 'operational_number', c.operational_number, 'expected_count', c.expected_count, 'group_count', c.group_count) order by c.operational_number nulls last, c.name) from visible_companies c), '[]'::jsonb),
      'submissions', coalesce((select jsonb_agg(jsonb_build_object('round_id', s.round_id, 'company_id', s.company_id, 'expected_count', s.expected_count, 'accounted_count', s.accounted_count, 'status', s.status::text, 'note', s.note, 'submitted_at', s.submitted_at) order by s.submitted_at desc) from public.headcount_submissions s join visible_rounds r on r.id = s.round_id join visible_companies c on c.id = s.company_id), '[]'::jsonb),
      'people', coalesce((select jsonb_agg(jsonb_build_object('participant_id', p.participant_id, 'registration_id', p.registration_id, 'display_name', p.display_name, 'fsy_id', p.fsy_id, 'company_id', p.company_id, 'company_name', p.company_name, 'group_id', p.group_id, 'group_name', p.group_display_name) order by p.company_name, p.group_display_name, p.display_name) from visible_people p), '[]'::jsonb),
      'person_statuses', coalesce((select jsonb_agg(jsonb_build_object('round_id', h.round_id, 'company_id', h.company_id, 'participant_id', h.participant_id, 'status', h.status, 'note', h.note, 'recorded_at', h.recorded_at) order by h.recorded_at desc) from public.headcount_person_statuses h join visible_rounds r on r.id = h.round_id join visible_companies c on c.id = h.company_id), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.get_headcount_workspace(uuid) from public, anon;
grant execute on function public.get_headcount_workspace(uuid) to authenticated;
