# FSY Kumasi Operations

An operations workspace for preparing and running FSY Kumasi. This is not a replacement for the approved Church registration system. It accepts approved exports and helps authorized local leaders prepare groups, companies, access, check-in, and head counts.

## Current scope

- 2026 FSY theme-aligned visual system using the supplied Blue, Green and Yellow palette
- Guided conference-readiness overview
- Full-scale synthetic rehearsal with roughly 1,640 youth
- Safe CSV/XLSX participant import with validation and preview
- Atomic counselor-group and company publishing with 8–10 youth per group
- Same-unit conflict detection and YM/YW group separation
- Database-backed arrival check-in and exception-first head-count rounds
- Supabase Auth with normal email + password sign-in
- Administrator-issued one-time setup invitations for first-time leader onboarding
- Forgot-password email plus short-lived administrator recovery-code fallback
- Role hierarchy for assistant coordinators, coordinators, logistical administrators, session directors, and committee viewers
- Coordinators have whole-session operational visibility
- Logistical administrators and session directors manage leader invitations and access
- One-time invite and recovery secrets are email-bound, short-lived, hashed at rest, and audited
- Supabase Row Level Security and Realtime support for operational updates
- Responsive desktop and mobile layouts

Never commit real participant information or paste it into chat.

## Environment strategy

Use two Supabase projects.

### Main / development

- Used while building and rehearsing the system
- Apply all migrations first here
- Load `supabase/seed.sql` to create 1,640 synthetic youth
- Test authentication, role permissions, imports, check-in, Realtime and access approvals
- Safe place to break things and reset data

### Production

- Keep empty of participant data until the development rehearsal passes
- Apply the same reviewed migrations
- Create only the approved top-level administrator accounts first
- Import the real approved participant export through the authenticated app, not source control
- Do not load the synthetic development seed

For Vercel, point Preview/Development deployments at the main Supabase project and the Production deployment at the production Supabase project using `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Access flow

1. Existing leaders sign in with their email address and password.
2. A Logistical Administrator or member of the Session Directing Couple chooses **Invite leader** and enters the leader's name, email, role, and required scope.
3. The system creates a one-time setup code/link that is valid only for that email and expires automatically.
4. The leader uses the setup link once, creates their own password, and receives the role/scope already selected by the administrator.
5. Assistant Coordinators are limited to assigned companies. Committee viewers are limited to assigned committee scope. Coordinators can see the whole operational session but cannot manage access.
6. Logistical Administrators and the Session Directing Couple can revoke open invitations, create replacements, and issue short-lived recovery codes when email recovery is unavailable or rate-limited.
7. Password changes never change a leader's operational permissions. Authorization remains enforced by database Row Level Security.

Participant imports use merge semantics: matching registration IDs are updated and new IDs are added. Omitting a participant from a later file does not delete them. Imports lock after the grouping plan is published so live company and head-count totals cannot silently drift.

## Local development

```bash
npm install
npm run dev
```

Run verification with:

```bash
npm test
npm run build
npm run test:sites
```

The repository also runs these checks in GitHub Actions for pull requests and pushes to `main`.

## Connecting Supabase

1. Select the development Supabase project.
2. Apply every migration in `supabase/migrations` in timestamp order.
3. Load `supabase/seed.sql` only in development.
4. Create or preserve the approved top-level administrator assignment.
5. Add the project URL and publishable key to the development Vercel environment.
6. Run Supabase security and performance advisors.
7. Test password sign-in, invitations, recovery, and every role against synthetic data.
8. Repeat the reviewed migrations in production, without the synthetic seed.
9. Add production Supabase values only to the Vercel Production environment.
10. Import the approved real participant export only after the security rehearsal passes.

Only public client values belong in Vite environment variables. Never expose a service-role key in the browser or repository.
