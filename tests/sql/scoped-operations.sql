-- Run against development after migrations. All fixtures roll back.
begin;
do $$
declare sid uuid:=extensions.gen_random_uuid(); admin_id uuid:=extensions.gen_random_uuid(); ac_id uuid:=extensions.gen_random_uuid(); committee_id uuid:=extensions.gen_random_uuid(); c1 uuid:=extensions.gen_random_uuid(); c2 uuid:=extensions.gen_random_uuid(); g1 uuid:=extensions.gen_random_uuid(); g2 uuid:=extensions.gen_random_uuid(); p1 uuid:=extensions.gen_random_uuid(); p2 uuid:=extensions.gen_random_uuid(); p3 uuid:=extensions.gen_random_uuid(); rid uuid; item uuid; result jsonb; blocked boolean; tid uuid; leader_role public.app_role; invite record;
begin
 insert into auth.users(id,email) values(admin_id,'fsy-test-admin@example.invalid'),(ac_id,'fsy-test-ac@example.invalid'),(committee_id,'fsy-test-food@example.invalid');
 insert into public.profiles(user_id,display_name,email) values(admin_id,'Test admin','fsy-test-admin@example.invalid'),(ac_id,'Test AC','fsy-test-ac@example.invalid'),(committee_id,'Test Food','fsy-test-food@example.invalid') on conflict(user_id) do nothing;
 insert into public.sessions(id,name,year,starts_on,ends_on) values(sid,'Rollback regression',2026,'2026-09-14','2026-09-19');
 insert into public.companies(id,session_id,name,operational_number) values(c1,sid,'Company 1',1),(c2,sid,'Company 2',2);
 insert into public.counselor_groups(id,session_id,company_id,name,sex,state) values(g1,sid,c1,'Group 1','female','published'),(g2,sid,c2,'Group 2','male','published');
 insert into public.participants(id,session_id,registration_id,first_name,last_name,sex,unit_name,group_id,verification_status,registration_status) values(p1,sid,'test-1','Test','Youth One','female','Unit A',g1,'verified','approved'),(p2,sid,'test-2','Test','Youth Two','male','Unit B',g2,'verified','approved');
 insert into public.participant_private_details(session_id,participant_id,date_of_birth) values(sid,p1,'2010-01-01'),(sid,p2,'2010-01-01');
 insert into public.access_assignments(session_id,user_id,role,company_ids) values(sid,admin_id,'coordinator','{}'),(sid,ac_id,'assistant_coordinator',array[c1]),(sid,committee_id,'committee_viewer','{}');
 perform private.seed_default_operational_teams(sid);
 select id into tid from public.operational_teams where session_id=sid and team_key='food';
 insert into public.team_memberships(session_id,team_id,user_id,active) values(sid,tid,committee_id,true),(sid,tid,ac_id,true);
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 rid:=public.open_headcount_round_v3(sid,'Test count');
 if (select count(*) from public.headcount_round_people where round_id=rid)<>2 then raise exception 'FAIL snapshot roster'; end if;
 if exists(select 1 from public.headcount_round_people where round_id=rid and status<>'unresolved') then raise exception 'FAIL default presence'; end if;
 foreach leader_role in array array['coordinator','logistics_admin','session_director']::public.app_role[] loop
 update public.access_assignments set role=leader_role where session_id=sid and user_id=admin_id;
 if jsonb_array_length(public.get_headcount_roster_v4(sid)->'people')<>2 then raise exception 'FAIL leadership oversight %',leader_role;end if;
 end loop;
 perform set_config('request.jwt.claim.sub',ac_id::text,true);
 result:=public.get_headcount_roster_v4(sid);
 if jsonb_array_length(result->'people')<>1 then raise exception 'FAIL AC roster scope with added Food committee'; end if;
 select id into item from public.headcount_round_people where round_id=rid and person_id=p2;
 blocked:=false;begin perform public.set_headcount_person_v3(item,'present',0,null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL cross-company write permitted';end if;
 select id into item from public.headcount_round_people where round_id=rid and person_id=p1;
 perform public.set_headcount_person_v3(item,'present',0,null);
 blocked:=false;begin perform public.set_headcount_person_v3(item,'missing',0,null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL stale update permitted';end if;
 if not private.has_capability(sid,'food_view') then raise exception 'FAIL additive Food capability';end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 select * into invite from public.create_leader_invite(sid,'fsy-test-food@example.invalid','Test Food','committee_viewer','{}',array['food']);
 if exists(select 1 from public.leader_invites where id=invite.invite_id and staff_id is not null) then raise exception 'FAIL staff-free invite';end if;
 perform set_config('request.jwt.claim.sub',committee_id::text,true);
 perform public.claim_leader_invite_authenticated(invite.invite_code);
 blocked:=false;begin perform public.claim_leader_invite_authenticated(invite.invite_code);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL invite reused';end if;
 if not private.has_capability(sid,'food_view') then raise exception 'FAIL committee-only account';end if;
 update public.access_assignments set active=false where session_id=sid and user_id=committee_id;
 if private.has_capability(sid,'food_view') or private.has_team_capability(sid,'food_view') then raise exception 'FAIL disabled committee retains access';end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 blocked:=false;begin perform public.close_headcount_round_v3(rid);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL closed unresolved round';end if;
 perform public.confirm_headcount_company_v3(rid,c2);
 perform public.close_headcount_round_v3(rid);
 blocked:=false;begin perform public.set_headcount_person_v3(item,'missing',1,null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL closed round editable';end if;
 insert into public.participant_badge_assignments(session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state) values(sid,p1,c1,g1,1,'TEST','TEST-C01-01','Test One','finalized');
 if not exists(select 1 from public.participant_badge_assignments where participant_id=p1 and fsy_id='C01-01-TEST') then raise exception 'FAIL company-first ID';end if;
 blocked:=false;begin update public.participant_badge_assignments set slot_number=2 where participant_id=p1;exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL silent slot renumber';end if;
 -- A transfer must preserve the original identity and snapshot company.
 update public.participants set group_id=g2 where id=p1;
 if not exists(select 1 from public.participant_badge_assignments where participant_id=p1 and company_id=c1 and state='retired') then raise exception 'FAIL transfer retired history';end if;
 if not exists(select 1 from public.participant_badge_assignments where participant_id=p1 and company_id=c2 and fsy_id='C02-01-TEST' and needs_reprint) then raise exception 'FAIL transfer new identity';end if;
 if not exists(select 1 from public.participant_badge_id_history where participant_id=p1 and previous_fsy_id='C01-01-TEST') then raise exception 'FAIL transfer alias';end if;
 if not exists(select 1 from public.headcount_round_people where person_id=p1 and company_id=c1) then raise exception 'FAIL historical count moved';end if;
 perform set_config('request.jwt.claim.sub',ac_id::text,true);
 if (public.get_headcount_summary_v3(sid)->>'total')::int<>1 then raise exception 'FAIL summary scope';end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 insert into public.origin_code_registry(session_id,canonical_name,code) values(sid,'Test Stake','TEST');
 insert into public.participants(id,session_id,registration_id,first_name,last_name,sex,unit_name,stake_name,source_kind,verification_status,registration_status)
 values(p3,sid,'test-3','Test','Replacement','male','Unit C','Test Stake','on_site','verified','approved');
 insert into public.participant_private_details(session_id,participant_id,date_of_birth) values(sid,p3,'2010-01-01');
 insert into public.participant_badge_assignments(session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state) values(sid,p2,c2,g2,2,'TEST','pending','Test Two','finalized');
 update public.participants set attendance_status='confirmed_not_attending' where id=p2;
 if public.replace_arrival_vacancy(p2,p3)<>'C02-03-TEST' then raise exception 'FAIL replacement reused identifier';end if;
 if not exists(select 1 from public.participant_badge_assignments where participant_id=p2 and state='retired' and fsy_id='C02-02-TEST') then raise exception 'FAIL original replacement identity lost';end if;
 -- Exercise API grants using authenticated role, not only the database owner.
 perform set_config('fsy.test.session',sid::text,true);
 perform set_config('request.jwt.claim.sub',ac_id::text,true);
end; $$;
set local role authenticated;
do $$ declare payload jsonb;begin
 payload:=public.get_headcount_roster_v4(current_setting('fsy.test.session')::uuid);
 if jsonb_array_length(payload->'people')<>1 then raise exception 'FAIL authenticated RPC scope';end if;
 if (select count(*) from public.participants where session_id=current_setting('fsy.test.session')::uuid)<>3 then raise exception 'FAIL additive Food lookup scope';end if;
end; $$;
reset role;
rollback;
