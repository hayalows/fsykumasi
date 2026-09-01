-- Keep trigger-only security-definer functions off the Data API and add covering
-- indexes for foreign keys used by access, check-in, head-count and import flows.

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists access_requests_requested_by_idx on public.access_requests(requested_by);
create index if not exists access_requests_reviewed_by_idx on public.access_requests(reviewed_by) where reviewed_by is not null;
create index if not exists audit_events_actor_id_idx on public.audit_events(actor_id) where actor_id is not null;
create index if not exists check_ins_participant_id_idx on public.check_ins(participant_id);
create index if not exists check_ins_recorded_by_idx on public.check_ins(recorded_by) where recorded_by is not null;
create index if not exists counselor_groups_company_id_idx on public.counselor_groups(company_id) where company_id is not null;
create index if not exists counselor_groups_counselor_id_idx on public.counselor_groups(counselor_id) where counselor_id is not null;
create index if not exists headcount_rounds_created_by_idx on public.headcount_rounds(created_by);
create index if not exists headcount_rounds_session_id_idx on public.headcount_rounds(session_id);
create index if not exists headcount_submissions_company_id_idx on public.headcount_submissions(company_id);
create index if not exists headcount_submissions_submitted_by_idx on public.headcount_submissions(submitted_by);
create index if not exists import_batches_imported_by_idx on public.import_batches(imported_by);
create index if not exists import_batches_session_id_idx on public.import_batches(session_id);
create index if not exists participants_group_id_idx on public.participants(group_id) where group_id is not null;
create index if not exists participants_import_batch_id_idx on public.participants(import_batch_id) where import_batch_id is not null;
create index if not exists staff_assigned_company_id_idx on public.staff(assigned_company_id) where assigned_company_id is not null;
create index if not exists staff_session_id_idx on public.staff(session_id);
