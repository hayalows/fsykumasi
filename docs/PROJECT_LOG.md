# FSY Operations project log

This file records product and engineering decisions that materially change how the operations system behaves. Pull requests and migration files remain the source of truth for implementation details.

## 2026-09-02 · Mobile progressive operations pass

Branch: `ux/mobile-progressive-operations`
Production status: **released** via PR #17, merged as `fb0d65c0d5cec82b0a75ebaed8b6f733bbacec3b`

### Decisions

- Mixed ages become the normal grouping default. Same-sex counselor groups remain; automatic age-band separation becomes an exception.
- Grouping algorithm distributes the available ages across each counselor pool while continuing to avoid same-unit repetition where possible.
- Groups & Companies uses a Company → Group → Youth disclosure hierarchy.
- Company search can resolve participant names and wards as well as company/group metadata.
- Long company directories render progressively rather than all at once.
- Head count uses Round summary → filtered company list → company detail, defaulting to companies still awaiting a report.
- Pending head counts retain a one-tap `All here` action; manual exception entry is secondary.
- Staff assignment uses a review-first suggestion workflow for empty counselor and Assistant Coordinator positions.
- A transactional backend RPC applies reviewed bulk staff plans safely without silently replacing existing assignments.
- Mobile controls and sheets use larger tap targets and reduced information density.
- The 2026 theme area includes a short Moses 6:34 excerpt.
- Reusability direction: treat the operations app as generic and move event-specific presentation into session configuration over time.

### Files introduced or substantially changed

- `src/lib/grouping.js`
- `src/lib/operations.js`
- `src/pages/Groups.jsx`
- `src/pages/Headcount.jsx`
- `src/pages/Overview.jsx`
- `src/progressive.css`
- `tests/grouping.test.mjs`
- `supabase/migrations/20260902080000_mixed_age_structure_default.sql`
- `supabase/migrations/20260902080500_atomic_staff_assignment_plan.sql`
- `docs/decisions/2026-09-02-progressive-mobile-operations.md`

## 2026-09-02 · Day-of people capture and committee preparation

Branch: `ops/manual-registration-v2`
Production status: **in development**

### Decisions

- A person missing from the imported registration snapshot should not require a new CSV. The day-of workflow starts with search, then creates an audited on-site record only when the person is genuinely missing.
- Youth and staff are separate day-of record types because they have different operational workflows.
- Date of birth is the input; age is derived for the session start date. Leaders do not manually calculate or type age.
- Ward/branch and stake/district suggestions are learned from the current session data so the operator can select existing spellings instead of creating near-duplicate unit names.
- A day-of youth record requires at least one reachable contact: participant phone or parent/guardian phone.
- A day-of staff record requires phone or email and an operational staff type.
- T-shirt size, dietary information, and medical/wellness information are optional secondary fields. Contact and sensitive details remain in the existing private-detail tables rather than the broadly readable people rows.
- New youth are saved as pending verification before group assignment or check-in. New staff become available for operational staff assignment after save.
- Registration committee access will be implemented as a scoped operational permission, not by turning every committee user into a full administrator.
- Future Rooms/Housing and Wellness functions will be separate scoped modules with their own minimal data and audit history rather than extra unrestricted fields on participant records.
- Serious incidents remain in the approved Church incident-reporting process; this system may surface operational status but should not become the authoritative serious-incident record.

### Files introduced or substantially changed

- `src/pages/Registration.jsx`
- `src/pages/registration-ops.css`
- `src/lib/registration.js`
- `src/lib/onsite.js`
- `tests/registration.test.mjs`
- `tests/schema-contract.test.mjs`
- `supabase/migrations/20260902083500_on_site_people_capture_v2.sql`
- `docs/decisions/2026-09-02-registration-operations-and-future-committees.md`

### Release rule

Apply the new migration to development first. Production migration, merge, and Vercel deployment happen only after tests and the production build are green.
