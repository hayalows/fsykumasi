-- Preserve every previous printed identifier; company and sequence numbers do not change.
create table public.participant_badge_id_history (
 id uuid primary key default extensions.gen_random_uuid(),
 session_id uuid not null references public.sessions(id),
 badge_assignment_id uuid not null references public.participant_badge_assignments(id),
 participant_id uuid not null references public.participants(id),
 previous_fsy_id text not null,
 replacement_fsy_id text not null,
 changed_at timestamptz not null default now(),
 changed_by uuid,
 reason text not null,
 unique(badge_assignment_id,previous_fsy_id,replacement_fsy_id)
);
create index participant_badge_history_person_idx on public.participant_badge_id_history(session_id,participant_id);
alter table public.participant_badge_id_history enable row level security;
revoke all on public.participant_badge_id_history from public,anon,authenticated;

create or replace function private.company_first_badge_id()
returns trigger language plpgsql security definer set search_path='' as $$
declare company_number integer;
begin
 if tg_op='UPDATE' and (new.company_id<>old.company_id or new.slot_number<>old.slot_number or new.participant_id<>old.participant_id) then
   raise exception 'Identity slots cannot be reassigned in place. Use the audited replacement workflow';
 end if;
 if new.state='retired' then return new; end if;
 select coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer) into company_number from public.companies c where c.id=new.company_id and c.session_id=new.session_id;
 if company_number is null or company_number<1 then raise exception 'A company number is required'; end if;
 new.fsy_id:='C'||lpad(company_number::text,greatest(2,length(company_number::text)),'0')||'-'||lpad(new.slot_number::text,2,'0')||'-'||new.origin_code;
 if tg_op='UPDATE' and old.fsy_id is distinct from new.fsy_id then
  insert into public.participant_badge_id_history(session_id,badge_assignment_id,participant_id,previous_fsy_id,replacement_fsy_id,changed_by,reason)
  values(old.session_id,old.id,old.participant_id,old.fsy_id,new.fsy_id,(select auth.uid()),'Company-first format; original company and sequence preserved') on conflict do nothing;
  if old.state='finalized' then new.needs_reprint:=true; end if;
 end if;
 return new;
end; $$;
revoke all on function private.company_first_badge_id() from public,anon,authenticated;
create trigger badge_company_first_format before insert or update on public.participant_badge_assignments for each row execute function private.company_first_badge_id();
-- Only format changes here. Retired assignments and historical round snapshots stay intact.
update public.participant_badge_assignments set fsy_id=fsy_id where state<>'retired';
insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
select session_id,null,'fsy_id_format_upgraded','session',session_id::text,jsonb_build_object('format','company-sequence-origin','history_rows',count(*),'renumbered',false)
from public.participant_badge_id_history group by session_id;

create or replace function public.get_fsy_id_history(p_session_id uuid)
returns table(participant_id uuid,previous_fsy_id text,replacement_fsy_id text,changed_at timestamptz)
language sql stable security definer set search_path='' as $$
 select h.participant_id,h.previous_fsy_id,h.replacement_fsy_id,h.changed_at
 from public.participant_badge_id_history h
 join public.participants p on p.id=h.participant_id and p.session_id=h.session_id
 left join public.counselor_groups g on g.id=p.group_id and g.session_id=p.session_id
 where h.session_id=p_session_id and private.has_session_access(p_session_id)
 and (private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
 or private.has_team_capability(p_session_id,'registration_view')
 or private.has_team_capability(p_session_id,'people_lookup')
 or (g.company_id is not null and private.can_access_company(p_session_id,g.company_id)))
 order by h.participant_id,h.changed_at,h.id;
$$;
revoke all on function public.get_fsy_id_history(uuid) from public,anon;
grant execute on function public.get_fsy_id_history(uuid) to authenticated;

create or replace function public.replace_arrival_vacancy(p_absent_participant_id uuid,p_new_participant_id uuid)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  absent public.participants%rowtype;
  newcomer public.participants%rowtype;
  old_badge public.participant_badge_assignments%rowtype;
  target_group public.counselor_groups%rowtype;
  target_company public.companies%rowtype;
  newcomer_origin text;
  new_fsy_id text;
  avoid_units boolean;
  caller_role public.app_role;
begin
  select * into absent from public.participants where id=p_absent_participant_id for update;
  select * into newcomer from public.participants where id=p_new_participant_id for update;
  if absent.id is null or newcomer.id is null then raise exception 'Participant not found'; end if;
  if absent.session_id<>newcomer.session_id then raise exception 'Participants must belong to the same session'; end if;
  if not private.has_capability(absent.session_id,'registration_manage') then raise exception 'Registration management access required'; end if;
  if absent.attendance_status<>'confirmed_not_attending' then raise exception 'The original participant must first be confirmed not attending'; end if;
  if exists(select 1 from public.check_ins ci where ci.session_id=absent.session_id and ci.participant_id=absent.id and ci.status::text='arrived') then
    raise exception 'A participant who already checked in cannot be replaced';
  end if;
  if newcomer.source_kind<>'on_site' or newcomer.verification_status<>'verified' or not newcomer.is_current then raise exception 'Choose a verified on-site participant'; end if;
  if newcomer.attendance_status='confirmed_not_attending' then raise exception 'The replacement participant is marked not attending'; end if;
  if not private.operational_participant_is_eligible(newcomer.session_id,newcomer.id) then raise exception 'The on-site participant is not operationally eligible'; end if;
  if newcomer.group_id is not null then raise exception 'The on-site participant is already assigned to a counselor group'; end if;

  select * into old_badge from public.participant_badge_assignments
  where participant_id=absent.id and state<>'retired' for update;
  if old_badge.id is null then raise exception 'The absent participant does not have an active roster slot'; end if;
  select * into target_group from public.counselor_groups where id=old_badge.group_id;
  select * into target_company from public.companies where id=old_badge.company_id;
  if target_group.id is null or target_company.id is null then raise exception 'The roster slot is missing its company or counselor group'; end if;
  if newcomer.sex<>target_group.sex then raise exception 'The replacement participant must match the counselor group sex'; end if;

  select aa.role into caller_role
  from public.access_assignments aa
  where aa.session_id=absent.session_id and aa.user_id=(select auth.uid()) and aa.active
  limit 1;
  if caller_role='assistant_coordinator' and not private.can_access_company(absent.session_id,old_badge.company_id) then
    raise exception 'Your account cannot fill a vacancy outside your assigned companies';
  end if;

  select avoid_same_unit into avoid_units
  from public.session_structure_settings where session_id=absent.session_id;
  avoid_units:=coalesce(avoid_units,true);
  if avoid_units and nullif(trim(coalesce(newcomer.unit_name,'')),'') is not null and exists(
    select 1
    from public.participants peer
    where peer.group_id=old_badge.group_id
      and peer.id<>absent.id
      and peer.id<>newcomer.id
      and private.operational_participant_is_eligible(absent.session_id,peer.id)
      and lower(trim(coalesce(peer.unit_name,'')))=lower(trim(newcomer.unit_name))
  ) then raise exception 'This counselor group already contains someone from the same unit'; end if;

  newcomer_origin:=private.origin_code_for_participant(newcomer);
  if newcomer_origin is null then raise exception 'The on-site participant needs a recognized Stake, District, or Mission before replacement'; end if;
  if coalesce(target_company.operational_number,nullif(regexp_replace(target_company.name,'\D','','g'),'')::integer) is null then
    raise exception 'The target company needs an operational number before a replacement ID can be issued';
  end if;
  new_fsy_id:='C'||lpad(coalesce(target_company.operational_number,nullif(regexp_replace(target_company.name,'\D','','g'),'')::integer)::text,2,'0')||'-'||lpad(old_badge.slot_number::text,2,'0')||'-'||newcomer_origin;

  update public.participant_badge_assignments
  set state='retired',retired_by=(select auth.uid()),retired_at=now(),note='Retired when roster slot was filled by an on-site participant'
  where id=old_badge.id;
  update public.participants
  set group_id=null,attendance_status='confirmed_not_attending',updated_at=now()
  where id=absent.id;
  update public.participants
  set group_id=old_badge.group_id,attendance_status='expected',attendance_note=null,
      attendance_updated_by=(select auth.uid()),attendance_updated_at=now(),updated_at=now()
  where id=newcomer.id;

  insert into public.participant_badge_assignments(
    session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,
    replacement_for,assigned_by,finalized_by,finalized_at
  ) values(
    newcomer.session_id,newcomer.id,old_badge.company_id,old_badge.group_id,old_badge.slot_number,
    newcomer_origin,new_fsy_id,trim(concat_ws(' ',newcomer.first_name,newcomer.last_name)),'finalized',
    old_badge.id,(select auth.uid()),(select auth.uid()),now()
  );

  insert into public.participant_arrival_events(session_id,participant_id,status,note,recorded_by)
  values(absent.session_id,absent.id,'replaced','Roster slot filled by on-site participant',(select auth.uid()));
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(absent.session_id,(select auth.uid()),'arrival_vacancy_replaced','participant',newcomer.id::text,
    jsonb_build_object('replaced_participant_id',absent.id,'company_id',old_badge.company_id,'group_id',old_badge.group_id,'slot_number',old_badge.slot_number,'fsy_id',new_fsy_id));
  return new_fsy_id;
end;
$$;

-- Preparation is incremental. Re-running it never deletes or renumbers a badge.
create or replace function public.rebuild_draft_fsy_ids(p_session_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare person record; slot integer; added integer:=0;
begin
 if not private.has_capability(p_session_id,'registration_manage') then raise exception 'Registration management required'; end if;
 perform 1 from public.sessions where id=p_session_id for update;
 if exists(select 1 from public.participant_badge_assignments where session_id=p_session_id and state='finalized') then raise exception 'IDs are finalized. Use the audited vacancy replacement workflow'; end if;
 if exists(select 1 from public.participant_badge_assignments b join public.participants p on p.id=b.participant_id where b.session_id=p_session_id and b.state='draft' and b.group_id is distinct from p.group_id) then raise exception 'A company assignment changed after ID preparation. Review identity history before issuing another badge'; end if;
 for person in select p.id,p.group_id,g.company_id,trim(concat_ws(' ',p.first_name,p.last_name)) full_name,private.origin_code_for_participant(p) origin
 from public.participants p join public.counselor_groups g on g.id=p.group_id and g.session_id=p.session_id
 where p.session_id=p_session_id and private.operational_participant_is_eligible(p_session_id,p.id)
 and not exists(select 1 from public.participant_badge_assignments b where b.session_id=p_session_id and b.participant_id=p.id and b.state<>'retired')
 order by g.company_id,g.operational_number,lower(p.last_name),lower(p.first_name),p.id loop
  if person.origin is null then continue; end if;
  select coalesce(max(slot_number),0)+1 into slot from public.participant_badge_assignments where session_id=p_session_id and company_id=person.company_id;
  if slot>99 then raise exception 'Company sequence is full. Review the company before issuing more IDs'; end if;
  insert into public.participant_badge_assignments(session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,assigned_by)
  values(p_session_id,person.id,person.company_id,person.group_id,slot,person.origin,'pending',person.full_name,'draft',(select auth.uid()));
  added:=added+1;
 end loop;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata) values(p_session_id,(select auth.uid()),'fsy_ids_prepared','session',p_session_id::text,jsonb_build_object('added',added,'existing_preserved',true));
 return added;
end; $$;
