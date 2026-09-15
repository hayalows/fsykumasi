create or replace function public.get_participant_membership_report(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  generated_by_name text;
  report_rows jsonb := '[]'::jsonb;
  member_count integer := 0;
  recent_convert_count integer := 0;
  non_member_count integer := 0;
  not_sure_count integer := 0;
  not_captured_count integer := 0;
  checked_in_count integer := 0;
begin
  if not private.has_capability(p_session_id, 'reports_export') then
    raise exception 'Report export access required';
  end if;

  select coalesce(nullif(pr.display_name, ''), nullif(pr.email, ''), 'FSY leader')
  into generated_by_name
  from public.profiles pr
  where pr.user_id = (select auth.uid());
  generated_by_name := coalesce(generated_by_name, 'FSY leader');

  with membership_rows as materialized (
    select
      r.participant_id,
      r.fsy_id,
      r.full_name,
      r.stake_name as origin,
      r.unit_name as unit,
      r.company_name as company,
      r.group_name as counselor_group,
      m.membership_status as membership_status_key,
      m.recorded_at as captured_at
    from private.participant_report_rows(p_session_id) r
    left join public.participant_membership_profiles m
      on m.participant_id = r.participant_id
     and m.session_id = p_session_id
    where r.checkin_status = 'arrived'
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'participant_id', mr.participant_id,
          'fsy_id', mr.fsy_id,
          'full_name', mr.full_name,
          'origin', mr.origin,
          'unit', mr.unit,
          'company', mr.company,
          'counselor_group', mr.counselor_group,
          'membership_status', case mr.membership_status_key
            when 'member_12_plus' then 'Member · 12+ months'
            when 'recent_convert' then 'Recent convert'
            when 'non_member' then 'Non-member'
            when 'not_sure' then 'Not sure'
            else 'Not captured'
          end,
          'captured_at', mr.captured_at
        )
        order by mr.full_name
      ),
      '[]'::jsonb
    ),
    count(*)::integer,
    count(*) filter (where mr.membership_status_key = 'member_12_plus')::integer,
    count(*) filter (where mr.membership_status_key = 'recent_convert')::integer,
    count(*) filter (where mr.membership_status_key = 'non_member')::integer,
    count(*) filter (where mr.membership_status_key = 'not_sure')::integer,
    count(*) filter (where mr.membership_status_key is null)::integer
  into report_rows, checked_in_count, member_count, recent_convert_count, non_member_count, not_sure_count, not_captured_count
  from membership_rows mr;

  return jsonb_build_object(
    'key', 'participant_membership',
    'title', 'Participant Membership Summary',
    'generated_at', now(),
    'generated_by', generated_by_name,
    'scope', 'Checked-in participants only · staff excluded',
    'rows', report_rows,
    'summary', jsonb_build_object(
      'checked_in', checked_in_count,
      'membership', jsonb_build_array(
        jsonb_build_object('key','member_12_plus','label','Member · 12+ months','count',member_count),
        jsonb_build_object('key','recent_convert','label','Recent convert','count',recent_convert_count),
        jsonb_build_object('key','non_member','label','Non-member','count',non_member_count),
        jsonb_build_object('key','not_sure','label','Not sure','count',not_sure_count),
        jsonb_build_object('key','not_captured','label','Not captured','count',not_captured_count)
      )
    )
  );
end;
$function$;

comment on function public.get_participant_membership_report(uuid) is
  'Returns the checked-in participant membership report. v77 materializes the participant report projection once so rows and summary counts share one pass.';
