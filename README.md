# FSY Kumasi Operations

An early operations workspace for preparing and running FSY Kumasi. This is not a replacement for the approved Church registration system. It accepts approved exports and helps authorized local leaders prepare groups, companies, access, check-in, and head counts.

## Current prototype scope

- 2026 FSY theme-aligned visual system using the supplied Blue, Green and Yellow palette
- Guided seven-step conference-readiness overview
- Full-scale synthetic rehearsal with roughly 1,640 youth
- Safe CSV/XLSX participant import with validation and preview
- Draft counselor-group builder with 8–10 youth per group
- Same-unit conflict detection and YM/YW group separation
- Company proposal, arrival check-in, and exception-first head-count views
- Role hierarchy for assistant coordinators, coordinators, logistics, session directors, and committee viewers
- Coordinators have whole-session operational visibility
- Logistics administrators and session directors can approve or reject lower-role access requests
- Supabase-ready schema with row-level security, access approval workflow and realtime tables
- Responsive desktop and mobile layouts

The deployed prototype uses deterministic synthetic data. Never commit real participant information or paste it into chat.

## Local development

```bash
npm install
npm run dev
```

Run verification with `npm test`, `npm run build`, and `npm run test:sites`.

## Connecting Supabase

1. Create or select the Supabase project in the account that should own FSY Kumasi data.
2. Apply the migrations in `supabase/migrations` using the Supabase CLI or approved migration workflow.
3. Create the initial session, profile, and top-level Logistics / Session Director access assignments through a trusted admin process.
4. Copy `.env.example` to `.env.local` and add the project URL and publishable key.
5. Run the Supabase security and performance advisors before using real records.
6. Test every role with synthetic data before importing the approved production export.

Only public client values belong in Vite environment variables. Never expose a service-role key in the browser or repository.
