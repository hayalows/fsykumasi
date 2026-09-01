create extension if not exists pgcrypto;

create type public.app_role as enum (
  'assistant_coordinator', 'coordinator', 'logistics_admin',
  'session_director', 'committee_viewer'
);
create type public.participant_sex as enum ('female', 'male');
create type public.check_in_status as enum ('expected', 'arrived', 'needs_attention', 'departed');
create type public.submission_status as enum ('draft', 'submitted', 'exception');

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year integer not null check (year between 2026 and 2100),
  starts_on date,
  ends_on date,
  status text not null default 'planning' check (status in ('planning','active','closed')),
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique(session_id, name)
);

create table public.access_assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role public.app_role not null,
  company_ids uuid[] not null default '{}',
  committee_scope text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(session_id, user_id, role)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  staff_role text not null,
  assigned_company_id uuid references public.companies(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.counselor_groups (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  name text not null,
  sex public.participant_sex not null,
  counselor_id uuid references public.staff(id) on delete set null,
  state text not null default 'draft' check (state in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  unique(session_id, name)
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  imported_by uuid not null references public.profiles(user_id),
  source_filename text not null,
  record_count integer not null default 0 check (record_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  status text not null default 'validated' check (status in ('validated','applied','rejected')),
  created_at timestamptz not null default now()
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  registration_id text not null,
  first_name text not null,
  last_name text not null,
  sex public.participant_sex not null,
  age integer check (age between 14 and 18),
  unit_name text not null,
  group_id uuid references public.counselor_groups(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, registration_id)
);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  status public.check_in_status not null default 'expected',
  note text,
  recorded_by uuid references public.profiles(user_id),
  recorded_at timestamptz not null default now(),
  unique(session_id, participant_id)
);

create table public.headcount_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  label text not null,
  opens_at timestamptz not null default now(),
  closes_at timestamptz,
  created_by uuid not null references public.profiles(user_id)
);

create table public.headcount_submissions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.headcount_rounds(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  expected_count integer not null check (expected_count >= 0),
  accounted_count integer not null check (accounted_count >= 0 and accounted_count <= expected_count),
  status public.submission_status not null default 'draft',
  note text,
  submitted_by uuid not null references public.profiles(user_id),
  submitted_at timestamptz not null default now(),
  unique(round_id, company_id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  actor_id uuid references public.profiles(user_id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index participants_session_group_idx on public.participants(session_id, group_id);
create index participants_session_unit_idx on public.participants(session_id, unit_name);
create index groups_session_company_idx on public.counselor_groups(session_id, company_id);
create index check_ins_session_status_idx on public.check_ins(session_id, status);
create index headcount_round_company_idx on public.headcount_submissions(round_id, company_id);
create index access_user_session_idx on public.access_assignments(user_id, session_id) where active;
create index audit_session_created_idx on public.audit_events(session_id, created_at desc);

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.has_session_access(target_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.access_assignments aa
    where aa.session_id = target_session and aa.user_id = (select auth.uid()) and aa.active
  );
$$;

create or replace function private.has_session_role(target_session uuid, allowed public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.access_assignments aa
    where aa.session_id = target_session and aa.user_id = (select auth.uid())
      and aa.active and aa.role = any(allowed)
  );
$$;

create or replace function private.can_access_company(target_session uuid, target_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.access_assignments aa
    where aa.session_id = target_session and aa.user_id = (select auth.uid()) and aa.active
      and (
        aa.role in ('logistics_admin','session_director')
        or target_company = any(aa.company_ids)
      )
  );
$$;

revoke all on all functions in schema private from public;
grant execute on function private.has_session_access(uuid) to authenticated;
grant execute on function private.has_session_role(uuid, public.app_role[]) to authenticated;
grant execute on function private.can_access_company(uuid, uuid) to authenticated;

alter table public.sessions enable row level security;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.access_assignments enable row level security;
alter table public.staff enable row level security;
alter table public.counselor_groups enable row level security;
alter table public.import_batches enable row level security;
alter table public.participants enable row level security;
alter table public.check_ins enable row level security;
alter table public.headcount_rounds enable row level security;
alter table public.headcount_submissions enable row level security;
alter table public.audit_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.sessions, public.profiles, public.companies, public.access_assignments,
  public.staff, public.counselor_groups, public.import_batches, public.participants,
  public.check_ins, public.headcount_rounds, public.headcount_submissions to authenticated;
grant insert, update, delete on public.companies, public.access_assignments, public.staff,
  public.counselor_groups, public.import_batches, public.participants, public.check_ins,
  public.headcount_rounds, public.headcount_submissions to authenticated;
grant insert on public.audit_events to authenticated;
grant usage, select on sequence public.audit_events_id_seq to authenticated;

create policy "members read sessions" on public.sessions for select to authenticated
  using (private.has_session_access(id));
create policy "users read own profile" on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.access_assignments viewer
      join public.access_assignments subject on subject.session_id = viewer.session_id
      where viewer.user_id = (select auth.uid()) and viewer.active and subject.user_id = profiles.user_id
    )
  );
create policy "leaders read access roster" on public.access_assignments for select to authenticated
  using (private.has_session_access(session_id));
create policy "top leaders manage access" on public.access_assignments for all to authenticated
  using (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]))
  with check (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]));

create policy "members read companies" on public.companies for select to authenticated
  using (private.has_session_access(session_id));
create policy "top leaders manage companies" on public.companies for all to authenticated
  using (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]))
  with check (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]));

create policy "members read staff" on public.staff for select to authenticated
  using (private.has_session_access(session_id));
create policy "top leaders manage staff" on public.staff for all to authenticated
  using (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]))
  with check (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]));

create policy "members read scoped groups" on public.counselor_groups for select to authenticated
  using (private.can_access_company(session_id, company_id) or private.has_session_role(session_id, array['coordinator']::public.app_role[]));
create policy "operations manage groups" on public.counselor_groups for all to authenticated
  using (private.has_session_role(session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]))
  with check (private.has_session_role(session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]));

create policy "members read scoped participants" on public.participants for select to authenticated
  using (
    private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[])
    or exists (select 1 from public.counselor_groups g where g.id = group_id and private.can_access_company(session_id, g.company_id))
  );
create policy "top leaders manage participants" on public.participants for all to authenticated
  using (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]))
  with check (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]));

create policy "top leaders read imports" on public.import_batches for select to authenticated
  using (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]));
create policy "top leaders manage imports" on public.import_batches for all to authenticated
  using (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]))
  with check (private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[]));

create policy "members read scoped checkins" on public.check_ins for select to authenticated
  using (
    private.has_session_role(session_id, array['logistics_admin','session_director']::public.app_role[])
    or exists (select 1 from public.participants p join public.counselor_groups g on g.id=p.group_id where p.id=participant_id and private.can_access_company(session_id,g.company_id))
  );
create policy "operations record checkins" on public.check_ins for all to authenticated
  using (private.has_session_role(session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]))
  with check (private.has_session_role(session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]));

create policy "members read headcount rounds" on public.headcount_rounds for select to authenticated
  using (private.has_session_access(session_id));
create policy "leaders manage rounds" on public.headcount_rounds for all to authenticated
  using (private.has_session_role(session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]))
  with check (private.has_session_role(session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]));

create policy "members read scoped submissions" on public.headcount_submissions for select to authenticated
  using (exists (select 1 from public.headcount_rounds r where r.id=round_id and private.can_access_company(r.session_id,company_id)));
create policy "leaders manage scoped submissions" on public.headcount_submissions for all to authenticated
  using (exists (select 1 from public.headcount_rounds r where r.id=round_id and private.can_access_company(r.session_id,company_id)))
  with check (exists (select 1 from public.headcount_rounds r where r.id=round_id and private.can_access_company(r.session_id,company_id)));

create policy "members write audit events" on public.audit_events for insert to authenticated
  with check (private.has_session_access(session_id) and actor_id = (select auth.uid()));

do $$ begin
  alter publication supabase_realtime add table public.check_ins;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.headcount_submissions;
exception when duplicate_object then null;
end $$;
