-- Preserve identity and current authorization across replacements, transfers, and recovery.
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
  replacement_slot integer;
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
  perform 1 from public.sessions where id=absent.session_id for update;
  select coalesce(max(slot_number),0)+1 into replacement_slot from public.participant_badge_assignments where session_id=absent.session_id and company_id=old_badge.company_id;
  if replacement_slot>99 then raise exception 'Company sequence is full'; end if;
  new_fsy_id:='C'||lpad(coalesce(target_company.operational_number,nullif(regexp_replace(target_company.name,'\D','','g'),'')::integer)::text,2,'0')||'-'||lpad(replacement_slot::text,2,'0')||'-'||newcomer_origin;

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
    newcomer.session_id,newcomer.id,old_badge.company_id,old_badge.group_id,replacement_slot,
    newcomer_origin,new_fsy_id,trim(concat_ws(' ',newcomer.first_name,newcomer.last_name)),'finalized',
    old_badge.id,(select auth.uid()),(select auth.uid()),now()
  );

  insert into public.participant_arrival_events(session_id,participant_id,status,note,recorded_by)
  values(absent.session_id,absent.id,'replaced','Roster slot filled by on-site participant',(select auth.uid()));
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(absent.session_id,(select auth.uid()),'arrival_vacancy_replaced','participant',newcomer.id::text,
    jsonb_build_object('replaced_participant_id',absent.id,'company_id',old_badge.company_id,'group_id',old_badge.group_id,'previous_slot_number',old_badge.slot_number,'slot_number',replacement_slot,'fsy_id',new_fsy_id));
  return new_fsy_id;
end;
$$;


-- A company transfer creates a new identity record; historical rounds do not move.
create or replace function private.preserve_identity_on_group_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare badge public.participant_badge_assignments%rowtype; target_company uuid; next_slot integer; new_id uuid; issued_id text;
begin
 if new.group_id is not distinct from old.group_id then return new; end if;
 select * into badge from public.participant_badge_assignments where participant_id=new.id and session_id=new.session_id and state<>'retired' for update;
 if badge.id is null then return new; end if;
 if new.group_id is null then raise exception 'Retire the active identity before removing its company assignment'; end if;
 select company_id into target_company from public.counselor_groups where id=new.group_id and session_id=new.session_id;
 if target_company=badge.company_id then
 update public.participant_badge_assignments set group_id=new.group_id,needs_reprint=(state='finalized' or needs_reprint) where id=badge.id;
 return new;
 end if;
 perform 1 from public.sessions where id=new.session_id for update;
 select coalesce(max(slot_number),0)+1 into next_slot from public.participant_badge_assignments where session_id=new.session_id and company_id=target_company;
 if next_slot>99 then raise exception 'Company sequence is full'; end if;
 update public.participant_badge_assignments set state='retired',retired_at=now(),retired_by=(select auth.uid()),note='Company transfer; identity retained in history' where id=badge.id;
 insert into public.participant_badge_assignments(session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,assigned_by,finalized_by,finalized_at,needs_reprint)
 values(new.session_id,new.id,target_company,new.group_id,next_slot,badge.origin_code,'pending',badge.badge_name,badge.state,(select auth.uid()),badge.finalized_by,badge.finalized_at,badge.state='finalized') returning id,fsy_id into new_id,issued_id;
 insert into public.participant_badge_id_history(session_id,badge_assignment_id,participant_id,previous_fsy_id,replacement_fsy_id,changed_by,reason)
 values(new.session_id,badge.id,new.id,badge.fsy_id,issued_id,(select auth.uid()),'Company transfer; new unused company sequence');
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(new.session_id,(select auth.uid()),'fsy_id_company_transfer','participant',new.id::text,jsonb_build_object('previous_assignment',badge.id,'new_assignment',new_id));
 return new;
end; $$;
revoke all on function private.preserve_identity_on_group_change() from public,anon,authenticated;
create trigger preserve_identity_group_change after update of group_id on public.participants for each row execute function private.preserve_identity_on_group_change();
create or replace function public.claim_leader_invite_authenticated(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_row public.leader_invites%rowtype;
  normalized_code text:=replace(upper(trim(p_code)),'-','');
  caller_email text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select lower(coalesce(email,'')) into caller_email from public.profiles where user_id=(select auth.uid());
  select * into invite_row from public.leader_invites li
    where li.code_hash=encode(extensions.digest(normalized_code,'sha256'),'hex') and li.status='pending' limit 1 for update;
  if invite_row.id is null or invite_row.expires_at<=now() or lower(invite_row.email)<>caller_email then
    raise exception 'This invite code is invalid, expired, or belongs to another email address';
  end if;

  if invite_row.purpose='recovery' then
    if not private.has_session_access(invite_row.session_id) then raise exception 'This account no longer has active session access'; end if;
  elsif invite_row.purpose='onboarding' and invite_row.staff_id is not null then
    insert into public.staff_account_links(session_id,staff_id,user_id,access_enabled,link_method,linked_by)
    values(invite_row.session_id,invite_row.staff_id,(select auth.uid()),true,'invite',invite_row.created_by)
    on conflict(session_id,staff_id) do update
      set user_id=excluded.user_id,access_enabled=true,link_method='invite',linked_by=excluded.linked_by,updated_at=now();
    update public.profiles p set display_name=coalesce((select s.full_name from public.staff s where s.id=invite_row.staff_id),invite_row.display_name,p.display_name),updated_at=now()
      where p.user_id=(select auth.uid());
    perform private.sync_staff_login_access(invite_row.staff_id);
  else
    update public.access_assignments set active=false
      where session_id=invite_row.session_id and user_id=(select auth.uid()) and active;
    insert into public.access_assignments(session_id,user_id,role,company_ids,committee_scope,active)
    values(invite_row.session_id,(select auth.uid()),invite_row.role,invite_row.company_ids,invite_row.committee_scope,true)
    on conflict(session_id,user_id,role) do update set company_ids=excluded.company_ids,committee_scope=excluded.committee_scope,active=true;
    update public.profiles set display_name=coalesce(invite_row.display_name,display_name),updated_at=now()
      where user_id=(select auth.uid());
  end if;

  update public.leader_invites set status='activated',redeemed_by=(select auth.uid()),redeemed_at=now() where id=invite_row.id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(invite_row.session_id,(select auth.uid()),'leader_invite_claimed','leader_invite',invite_row.id::text,
    jsonb_build_object('role',invite_row.role,'staff_id',invite_row.staff_id));
  return invite_row.session_id;
end;
$$;
revoke all on function public.claim_leader_invite_authenticated(text) from public;
grant execute on function public.claim_leader_invite_authenticated(text) to authenticated;
