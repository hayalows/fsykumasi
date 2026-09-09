-- Add only new counselor groups/companies for participants cleared by pre-session finalization.
-- Existing participant placements and existing staff assignments are never changed.

create or replace function private.apply_supplemental_structure_v38(target_session uuid,target_batch uuid,target_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 sx text; g record; c record; total_for_sex integer; group_count integer; idx integer;
 group_number integer; company_number integer; new_group_id uuid; counselor_id uuid; assistant_id uuid;
 max_load integer:=4; new_groups integer:=0; new_companies integer:=0; counselor_fills integer:=0;
 assistant_fills integer:=0; id_fills integer:=0; company_count integer:=0;
begin
 create temporary table if not exists session_finalization_groups_v38(
   group_id uuid primary key,participant_sex text not null,group_index integer not null
 ) on commit drop;
 truncate session_finalization_groups_v38;

 -- Build same-sex groups only from currently ungrouped final-roster participants.
 foreach sx in array array['female','male'] loop
   select count(*) into total_for_sex from private.session_finalization_queue(target_session) q where q.participant_sex=sx;
   if total_for_sex>0 then
     group_count:=ceil(total_for_sex/10.0)::integer;
     select coalesce(max(nullif(substring(gx.name from '([0-9]+)$'),'')::integer),0) into group_number
     from public.counselor_groups gx where gx.session_id=target_session and gx.sex::text=sx;
     for idx in 1..group_count loop
       insert into public.counselor_groups(session_id,name,sex,state,operational_number,finalization_batch_id)
       values(target_session,case when sx='female' then 'YW Group ' else 'YM Group ' end||(group_number+idx),
         sx::public.participant_sex,'published',group_number+idx,target_batch)
       returning id into new_group_id;
       insert into session_finalization_groups_v38(group_id,participant_sex,group_index)
       values(new_group_id,sx,idx);
       new_groups:=new_groups+1;
     end loop;

     with ranked as (
       select q.participant_id,
         row_number() over(order by q.participant_age,p.unit_name,p.last_name,p.first_name,p.id) rn,
         count(*) over() total_count
       from private.session_finalization_queue(target_session) q
       join public.participants p on p.id=q.participant_id
       where q.participant_sex=sx
     ), placed as (
       select r.participant_id,1+floor((r.rn-1)*group_count::numeric/r.total_count)::integer target_index
       from ranked r
     )
     update public.participants p set group_id=t.group_id,updated_at=now()
     from placed x join session_finalization_groups_v38 t
       on t.participant_sex=sx and t.group_index=x.target_index
     where p.id=x.participant_id and p.group_id is null;
   end if;
 end loop;

 -- Companies are new too. Round-robin the female and male groups so they are mixed whenever possible.
 if new_groups>0 then
   company_count:=ceil(new_groups/3.0)::integer;
   create temporary table if not exists session_finalization_companies_v38(seq integer primary key,company_id uuid not null) on commit drop;
   truncate session_finalization_companies_v38;
   select coalesce(max(nullif(substring(cx.name from '([0-9]+)$'),'')::integer),0) into company_number
   from public.companies cx where cx.session_id=target_session;
   for idx in 1..company_count loop
     insert into public.companies(session_id,name,operational_number,finalization_batch_id)
     values(target_session,'Company '||(company_number+idx),company_number+idx,target_batch)
     returning id into new_group_id;
     insert into session_finalization_companies_v38(seq,company_id) values(idx,new_group_id);
     new_companies:=new_companies+1;
   end loop;

   with ordered as (
     select t.group_id,t.participant_sex,row_number() over(partition by t.participant_sex order by t.group_index) rn
     from session_finalization_groups_v38 t
   )
   update public.counselor_groups gx set company_id=cc.company_id
   from ordered o join session_finalization_companies_v38 cc on cc.seq=1+((o.rn-1)%company_count)
   where gx.id=o.group_id;
 end if;

 -- Cover old vacancies first, then the supplemental groups. Valid current counselors are never displaced.
 for g in
   select gx.id,gx.sex,gx.created_at from public.counselor_groups gx
   where gx.session_id=target_session and gx.counselor_id is null
   order by case when gx.finalization_batch_id is null then 0 else 1 end,gx.created_at,gx.id
 loop
   counselor_id:=null;
   select s.id into counselor_id
   from public.staff s join public.staff_operations o on o.staff_id=s.id
   where s.session_id=target_session and s.is_current and s.registration_status<>'cancelled'
     and s.operational_role='counselor' and s.sex=g.sex
     and o.service_clearance='cleared' and o.planning_state<>'excluded' and o.arrival_state not in ('no_show','left')
     and not exists(select 1 from public.counselor_groups gy where gy.counselor_id=s.id)
   order by case when s.registration_status='approved' then 0 else 1 end,s.full_name,s.id
   limit 1;
   if counselor_id is null then raise exception 'Not enough cleared % counselors to cover every group',g.sex::text; end if;
   update public.counselor_groups set counselor_id=counselor_id where id=g.id;
   update public.staff_operations set planning_state='primary',revision=revision+1,updated_by=target_actor,updated_at=now()
   where staff_id=counselor_id;
   counselor_fills:=counselor_fills+1;
 end loop;

 select coalesce(ss.companies_per_assistant_coordinator,4) into max_load
 from public.session_structure_settings ss where ss.session_id=target_session;
 max_load:=coalesce(max_load,4);
 if new_companies>0 then
   for c in select x.company_id from session_finalization_companies_v38 x order by x.seq loop
     assistant_id:=null;
     select s.id into assistant_id
     from public.staff s join public.staff_operations o on o.staff_id=s.id
     where s.session_id=target_session and s.is_current and s.registration_status<>'cancelled'
       and s.operational_role='assistant_coordinator' and o.service_clearance='cleared'
       and o.planning_state<>'excluded' and o.arrival_state not in ('no_show','left')
       and (select count(*) from public.staff_company_assignments a where a.staff_id=s.id)<max_load
     order by (select count(*) from public.staff_company_assignments a where a.staff_id=s.id),
       case when s.registration_status='approved' then 0 else 1 end,s.full_name,s.id
     limit 1;
     if assistant_id is null then raise exception 'Not enough cleared Assistant Coordinators for the new companies'; end if;
     insert into public.staff_company_assignments(session_id,staff_id,company_id,assignment_role,assigned_by)
     values(target_session,assistant_id,c.company_id,'assistant_coordinator',target_actor) on conflict do nothing;
     update public.staff set assigned_company_id=coalesce(assigned_company_id,c.company_id) where id=assistant_id;
     update public.staff_operations set planning_state='primary',revision=revision+1,updated_by=target_actor,updated_at=now()
     where staff_id=assistant_id;
     assistant_fills:=assistant_fills+1;
   end loop;
 end if;

 -- New IDs are created only for newly-placed participants. Existing finalized IDs are untouched.
 insert into public.participant_badge_assignments(
   session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,
   assigned_by,note,finalized_by,finalized_at)
 select p.session_id,p.id,gx.company_id,p.group_id,
   row_number() over(partition by gx.company_id order by gx.operational_number,lower(p.last_name),lower(p.first_name),p.id)::integer,
   coalesce(private.origin_code_for_participant(p),'KUM'),'pending',trim(concat_ws(' ',p.first_name,p.last_name)),'finalized',
   target_actor,case when private.origin_code_for_participant(p) is null
     then 'Kumasi local session finalization · origin unavailable; KUM fallback used'
     else 'Kumasi local session finalization' end,target_actor,now()
 from public.participants p join public.counselor_groups gx on gx.id=p.group_id
 where p.session_id=target_session and gx.finalization_batch_id=target_batch
   and private.operational_participant_is_eligible(target_session,p.id)
   and not exists(select 1 from public.participant_badge_assignments b
     where b.session_id=p.session_id and b.participant_id=p.id and b.state<>'retired')
 order by gx.company_id,gx.operational_number,lower(p.last_name),lower(p.first_name),p.id;
 get diagnostics id_fills=row_count;

 return jsonb_build_object('newGroups',new_groups,'newCompanies',new_companies,
   'counselorVacanciesFilled',counselor_fills,'assistantCoordinatorAssignments',assistant_fills,'newFsyIds',id_fills);
end $$;
revoke all on function private.apply_supplemental_structure_v38(uuid,uuid,uuid) from public,anon,authenticated;
