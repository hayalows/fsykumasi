-- Atomic pre-session finalization. All data changes happen in one transaction.

create or replace function private.apply_session_finalization_core_v38(
 target_session uuid,target_authority text,target_reason text,target_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch uuid; adult_live integer:=0; participant_count integer:=0; adult_count integer:=0;
 staff_count integer:=0; structure jsonb:='{}'::jsonb; before_summary jsonb; final_summary jsonb;
begin
 if length(trim(coalesce(target_authority,'')))<3 or length(trim(coalesce(target_reason,'')))<5 then raise exception 'Authority and reason are required'; end if;
 if not exists(select 1 from public.sessions s where s.id=target_session and s.status='planning') then raise exception 'This workflow is available only while the session is in planning'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_session::text,38));

 select count(*) into adult_live from public.participants p
 where p.session_id=target_session and p.is_current and coalesce(p.operational_status,'active')='active'
   and private.session_finalization_age(target_session,p.id)>=20
   and (p.group_id is not null
     or exists(select 1 from public.housing_assignments h where h.participant_id=p.id and h.active)
     or exists(select 1 from public.check_ins ci where ci.participant_id=p.id and ci.status='arrived'));
 if adult_live>0 then raise exception 'One or more 20+ participant records have live work. Review them individually before finalizing.'; end if;

 select jsonb_build_object(
   'activeParticipants',(select count(*) from public.participants p where p.session_id=target_session and p.is_current and coalesce(p.operational_status,'active')='active'),
   'participantsToPlace',(select count(*) from private.session_finalization_queue(target_session)),
   'adultsToExclude',(select count(*) from public.participants p where p.session_id=target_session and p.is_current and coalesce(p.operational_status,'active')='active' and private.session_finalization_age(target_session,p.id)>=20),
   'staffToClear',(select count(*) from public.staff s where s.session_id=target_session and s.is_current and s.registration_status='awaiting'),
   'currentCompanies',(select count(*) from public.companies c where c.session_id=target_session),
   'currentGroups',(select count(*) from public.counselor_groups g where g.session_id=target_session),
   'existingAssignmentsMoved',0
 ) into before_summary;

 insert into public.session_finalization_batches(session_id,authority,reason,summary,created_by)
 values(target_session,trim(target_authority),trim(target_reason),before_summary,target_actor) returning id into batch;

 -- 20+ records leave active participant operations. Their imported identity is preserved.
 insert into public.participant_operation_decisions(
   participant_id,cohort_state,local_clearance,decision_kind,authority,reason,batch_id,recorded_by,recorded_at)
 select p.id,'excluded',false,'adult_to_staff_path',trim(target_authority),trim(target_reason)||' · participant age 20+',batch,target_actor,now()
 from public.participants p
 where p.session_id=target_session and p.is_current and coalesce(p.operational_status,'active')='active'
   and private.session_finalization_age(target_session,p.id)>=20
 on conflict(participant_id) do update set cohort_state='excluded',local_clearance=false,
   decision_kind='adult_to_staff_path',authority=excluded.authority,reason=excluded.reason,batch_id=excluded.batch_id,
   recorded_by=target_actor,recorded_at=now(),revision=participant_operation_decisions.revision+1;
 get diagnostics adult_count=row_count;
 update public.participants p set operational_status='withdrawn',
   operational_note='Removed from active participant roster at pre-session finalization; source identity preserved for staff/on-site follow-up',
   operational_revision=operational_revision+1,operational_updated_by=target_actor,operational_updated_at=now()
 where p.session_id=target_session and p.is_current and coalesce(p.operational_status,'active')='active'
   and private.session_finalization_age(target_session,p.id)>=20;

 -- All verified, expected, ungrouped youth age 12-19 become local-session eligible.
 insert into public.participant_operation_decisions(
   participant_id,cohort_state,local_clearance,decision_kind,authority,reason,batch_id,recorded_by,recorded_at)
 select q.participant_id,'exception',true,q.decision_kind,trim(target_authority),trim(target_reason),batch,target_actor,now()
 from private.session_finalization_queue(target_session) q
 on conflict(participant_id) do update set cohort_state='exception',local_clearance=true,
   decision_kind=excluded.decision_kind,authority=excluded.authority,reason=excluded.reason,batch_id=excluded.batch_id,
   recorded_by=target_actor,recorded_at=now(),revision=participant_operation_decisions.revision+1;
 get diagnostics participant_count=row_count;
 update public.participants p set attendance_status='expected'
 where p.id in(select q.participant_id from private.session_finalization_queue(target_session) q);

 -- Awaiting source staff are locally cleared to plan/serve. The source Awaiting value stays visible as source truth.
 update public.staff_operations o set service_clearance='cleared',
   planning_state=case when exists(select 1 from public.counselor_groups g where g.counselor_id=o.staff_id)
     or exists(select 1 from public.staff_company_assignments a where a.staff_id=o.staff_id) then 'primary' else 'reserve' end,
   clearance_authority=trim(target_authority),clearance_reason=trim(target_reason),clearance_recorded_by=target_actor,
   clearance_recorded_at=now(),clearance_batch_id=batch,revision=revision+1,updated_by=target_actor,updated_at=now()
 from public.staff s where s.id=o.staff_id and s.session_id=target_session and s.is_current and s.registration_status='awaiting';
 get diagnostics staff_count=row_count;

 structure:=private.apply_supplemental_structure_v38(target_session,batch,target_actor);
 final_summary:=before_summary||jsonb_build_object(
   'batchId',batch,'participantsLocallyCleared',participant_count,'adultsExcluded',adult_count,
   'staffLocallyCleared',staff_count,'activeParticipantsAfter',(select count(*) from public.participants p where p.session_id=target_session and p.is_current and coalesce(p.operational_status,'active')='active'),
   'participantsWithoutGroupAfter',(select count(*) from public.participants p where p.session_id=target_session and p.is_current and coalesce(p.operational_status,'active')='active' and private.operational_participant_is_eligible(target_session,p.id) and p.group_id is null),
   'groupsWithoutCounselorAfter',(select count(*) from public.counselor_groups g where g.session_id=target_session and g.counselor_id is null),
   'staffNeedingConfirmationAfter',(select count(*) from public.staff s join public.staff_operations o on o.staff_id=s.id where s.session_id=target_session and s.is_current and s.registration_status<>'cancelled' and o.service_clearance='confirmation_required')
 )||structure;
 update public.session_finalization_batches set summary=final_summary where id=batch;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(target_session,target_actor,'session_roster_finalized','session',target_session::text,
   final_summary||jsonb_build_object('authority',trim(target_authority),'reason',trim(target_reason),'existingAssignmentsMoved',0));
 return final_summary;
end $$;
revoke all on function private.apply_session_finalization_core_v38(uuid,text,text,uuid) from public,anon,authenticated;

create or replace function public.apply_session_finalization_v1(
 p_session_id uuid,p_authority text default 'Kumasi session leadership',p_reason text default 'Pre-session local roster finalization')
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.session_finalization_leader(p_session_id) then raise exception 'Session leadership access is required'; end if;
 return private.apply_session_finalization_core_v38(p_session_id,p_authority,p_reason,auth.uid());
end $$;
revoke all on function public.apply_session_finalization_v1(uuid,text,text) from public,anon;
grant execute on function public.apply_session_finalization_v1(uuid,text,text) to authenticated;
