# FSY Kumasi Operations

An early operations workspace for preparing and running FSY Kumasi. This is not a replacement for the approved Church registration system. It accepts approved exports and helps authorized local leaders prepare groups, companies, access, check-in, and head counts.

## V0.0 scope

- Guided seven-step conference-readiness overview
- Safe CSV/XLSX participant import with validation and preview
- Draft counselor-group builder with 8–10 youth per group
- Same-unit conflict detection and YM/YW group separation
- Company proposal, arrival check-in, and head-count views
- Role and scope model for ACs, coordinators, logistics, session directors, and committee viewers
- Supabase-ready schema with row-level security and realtime tables
- Responsive desktop and mobile layouts

The deployed prototype uses deterministic synthetic data. Never commit real participant information or paste it into chat.

## Local development

```bash
npm install
npm run dev
```

Run verification with `npm test`, `npm run build`, and `npm run test:sites`.

## Connecting Supabase later

1. Create or select the Supabase project in the account that should own FSY Kumasi data.
2. Apply the migration in `supabase/migrations` using the Supabase CLI.
3. Create the initial session, profile, and top-level access assignment through a trusted admin process.
4. Copy `.env.example` to `.env.local` and add the project URL and publishable key.
5. Run the Supabase security and performance advisors before using real records.

Only public client values belong in Vite environment variables. Never expose a service-role key in the browser or repository.
