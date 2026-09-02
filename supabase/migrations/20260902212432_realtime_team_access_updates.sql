do $$ begin
  alter publication supabase_realtime add table public.access_assignments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.team_memberships;
exception when duplicate_object then null; end $$;