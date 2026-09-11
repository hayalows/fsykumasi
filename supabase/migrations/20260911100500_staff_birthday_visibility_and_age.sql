-- Restore staff birthdays after the split workspace hydration and expose the birthday age
-- only for staff rows the caller is already authorized to see.

create or replace function public.get_staff_birthdays(p_session_id uuid)
returns table(
  staff_id uuid,
  display_name text,
  birthday_date date,
  staff_role text,
  company_name text,
  acknowledged boolean,
  acknowledged_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select
    s.id,
    s.full_name,
    private.birthday_in_year(d.date_of_birth,extract(year from se.starts_on)::int),
    s.operational_role,
    coalesce(scope.company_name,''),
    (ba.staff_id is not null),
    ba.acknowledged_at
  from public.sessions se
  join public.staff s on s.session_id=se.id
  join public.staff_private_details d on d.staff_id=s.id
  left join public.staff_birthday_acknowledgements ba on ba.session_id=se.id and ba.staff_id=s.id
  left join lateral (
    select coalesce(nullif(c.custom_name,''),c.name) company_name
    from public.companies c
    where c.id=coalesce(
      (select g.company_id from public.counselor_groups g where g.session_id=se.id and g.counselor_id=s.id limit 1),
      s.assigned_company_id,
      (select sca.company_id from public.staff_company_assignments sca where sca.session_id=se.id and sca.staff_id=s.id order by sca.assigned_at limit 1)
    )
    limit 1
  ) scope on true
  where se.id=p_session_id
    and private.has_session_access(se.id)
    and s.is_current
    and s.registration_status='approved'
    and private.birthday_in_year(d.date_of_birth,extract(year from se.starts_on)::int) between se.starts_on and se.ends_on
    and (
      private.has_session_role(se.id,array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[])
      or private.has_capability(se.id,'access_admin')
      or (private.is_assistant_coordinator(se.id) and private.staff_in_current_company_scope(se.id,s.id))
      or exists(
        select 1
        from public.staff_account_links sal
        where sal.session_id=se.id
          and sal.staff_id=s.id
          and sal.user_id=(select auth.uid())
      )
      or exists(
        select 1
        from public.staff_account_links sal
        join public.team_memberships target_tm
          on target_tm.session_id=se.id
         and target_tm.user_id=sal.user_id
         and target_tm.active
        join public.team_memberships caller_tm
          on caller_tm.session_id=se.id
         and caller_tm.user_id=(select auth.uid())
         and caller_tm.active
         and caller_tm.team_id=target_tm.team_id
        where sal.session_id=se.id
          and sal.staff_id=s.id
      )
    )
  order by 3,2;
$$;

revoke all on function public.get_staff_birthdays(uuid) from public,anon;
grant execute on function public.get_staff_birthdays(uuid) to authenticated;

create or replace function public.get_staff_birthdays_v3(p_session_id uuid)
returns table(
  staff_id uuid,
  display_name text,
  birthday_date date,
  turning_age integer,
  staff_role text,
  company_name text,
  company_names text[],
  group_name text,
  acknowledged boolean,
  acknowledged_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select
    base.staff_id,
    base.display_name,
    base.birthday_date,
    (extract(year from base.birthday_date)::int - extract(year from details.date_of_birth)::int) as turning_age,
    base.staff_role,
    base.company_name,
    coalesce(
      (
        select array_agg(distinct coalesce(nullif(c.custom_name,''),c.name) order by coalesce(nullif(c.custom_name,''),c.name))
        from public.staff_company_assignments sca
        join public.companies c on c.id=sca.company_id
        where sca.session_id=p_session_id and sca.staff_id=base.staff_id
      ),
      case when base.company_name<>'' then array[base.company_name] else '{}'::text[] end
    ),
    coalesce(
      (
        select coalesce(nullif(g.custom_name,''),g.name)
        from public.counselor_groups g
        where g.session_id=p_session_id and g.counselor_id=base.staff_id
        limit 1
      ),
      ''
    ),
    base.acknowledged,
    base.acknowledged_at
  from public.get_staff_birthdays(p_session_id) base
  join public.staff_private_details details on details.staff_id=base.staff_id;
$$;

revoke all on function public.get_staff_birthdays_v3(uuid) from public,anon;
grant execute on function public.get_staff_birthdays_v3(uuid) to authenticated;
