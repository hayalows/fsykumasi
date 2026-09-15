-- Keep website access aligned with the live operational Staff roster.
-- Source registration approval remains historical context. A current Staff member who is
-- operationally available may be assigned and invited even when that source value is awaiting.

create or replace function private.sync_staff_login_access(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  link_row public.staff_account_links%rowtype;
  desired_role public.app_role;
  desired_companies uuid[] := '{}'::uuid[];
  current_is_full boolean := false;
  desired_is_full boolean := false;
begin
  select * into target from public.staff where id=p_staff_id;
  if target.id is null then return; end if;

  if target.is_current
     and target.registration_status <> 'cancelled'
     and private.staff_can_plan(target.id) then
    desired_role := private.staff_role_to_app_role(target.operational_role);
  else
    desired_role := null;
  end if;

  if desired_role='assistant_coordinator' then
    select coalesce(array_agg(sca.company_id order by sca.assigned_at, sca.company_id),'{}'::uuid[])
      into desired_companies
    from public.staff_company_assignments sca
    where sca.session_id=target.session_id and sca.staff_id=target.id;
  end if;

  if desired_role is null then
    update public.leader_invites
      set status='revoked', revoked_at=coalesce(revoked_at,now())
    where session_id=target.session_id and staff_id=target.id
      and purpose='onboarding' and status in ('pending','activating');
  else
    update public.leader_invites
      set role=desired_role,
          company_ids=case when desired_role='assistant_coordinator' then desired_companies else '{}'::uuid[] end,
          display_name=target.full_name
    where session_id=target.session_id and staff_id=target.id
      and purpose='onboarding' and status in ('pending','activating');
  end if;

  select * into link_row
  from public.staff_account_links sal
  where sal.session_id=target.session_id and sal.staff_id=target.id
  for update;
  if link_row.staff_id is null then return; end if;

  select exists(
    select 1 from public.access_assignments aa
    where aa.session_id=target.session_id and aa.user_id=link_row.user_id and aa.active
      and aa.role in ('coordinator','logistics_admin','session_director','area_advisory_couple')
  ) into current_is_full;
  desired_is_full := link_row.access_enabled and desired_role in ('coordinator','logistics_admin','session_director','area_advisory_couple');

  if current_is_full and not desired_is_full
     and private.full_session_admin_count(target.session_id,link_row.user_id)=0 then
    raise exception 'You cannot remove the only Full Session Administrator. Give another leader full access first.';
  end if;

  update public.access_assignments
    set active=false
  where session_id=target.session_id and user_id=link_row.user_id and active;

  if link_row.access_enabled and desired_role is not null then
    insert into public.access_assignments(session_id,user_id,role,company_ids,committee_scope,capabilities,active)
    values(
      target.session_id,
      link_row.user_id,
      desired_role,
      case when desired_role='assistant_coordinator' then desired_companies else '{}'::uuid[] end,
      '{}'::text[],
      '{}'::text[],
      true
    )
    on conflict(session_id,user_id,role) do update
      set company_ids=excluded.company_ids,
          committee_scope=excluded.committee_scope,
          capabilities=excluded.capabilities,
          active=true;
  end if;

  update public.staff_account_links
    set updated_at=now()
  where session_id=target.session_id and staff_id=target.id;
end;
$$;

create or replace function public.get_staff_access_directory(p_session_id uuid)
returns table(
  staff_id uuid,
  display_name text,
  operational_role text,
  email text,
  company_ids uuid[],
  company_names text[],
  user_id uuid,
  account_email text,
  access_enabled boolean,
  access_state text,
  invite_id uuid,
  invite_expires_at timestamptz,
  account_role public.app_role
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Website access administration required'; end if;
  return query
  select
    s.id,
    s.full_name,
    s.operational_role,
    coalesce(nullif(trim(spd.email),''),nullif(trim(s.email),'')),
    coalesce(scope.company_ids,'{}'::uuid[]),
    coalesce(scope.company_names,'{}'::text[]),
    sal.user_id,
    p.email,
    coalesce(sal.access_enabled,false),
    case
      when sal.staff_id is not null and not sal.access_enabled then 'disabled'
      when sal.staff_id is not null and aa.id is not null then 'active'
      when pending.id is not null then 'invited'
      else 'not_enabled'
    end,
    pending.id,
    pending.expires_at,
    aa.role
  from public.staff s
  left join public.staff_private_details spd on spd.staff_id=s.id
  left join lateral (
    select
      coalesce(array_agg(sca.company_id order by c.operational_number nulls last,c.name),'{}'::uuid[]) company_ids,
      coalesce(array_agg(coalesce(nullif(c.custom_name,''),c.name) order by c.operational_number nulls last,c.name),'{}'::text[]) company_names
    from public.staff_company_assignments sca
    join public.companies c on c.id=sca.company_id
    where sca.session_id=p_session_id and sca.staff_id=s.id
  ) scope on true
  left join public.staff_account_links sal on sal.session_id=p_session_id and sal.staff_id=s.id
  left join public.profiles p on p.user_id=sal.user_id
  left join lateral (
    select a.id,a.role
    from public.access_assignments a
    where a.session_id=p_session_id and a.user_id=sal.user_id and a.active
    order by a.created_at desc limit 1
  ) aa on true
  left join lateral (
    select li.id,li.expires_at
    from public.leader_invites li
    where li.session_id=p_session_id and li.staff_id=s.id
      and li.purpose='onboarding' and li.status in ('pending','activating') and li.expires_at>now()
    order by li.created_at desc limit 1
  ) pending on true
  where s.session_id=p_session_id
    and s.is_current
    and s.registration_status <> 'cancelled'
    and private.staff_can_plan(s.id)
    and private.staff_role_to_app_role(s.operational_role) is not null
  order by
    case s.operational_role when 'session_director' then 1 when 'coordinator' then 2 when 'logistics_admin' then 3 when 'assistant_coordinator' then 4 else 9 end,
    lower(s.full_name),s.id;
end;
$$;

revoke all on function public.get_staff_access_directory(uuid) from public, anon;
grant execute on function public.get_staff_access_directory(uuid) to authenticated;
