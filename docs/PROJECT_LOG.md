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
Production status: **released** via PR #18, merged as `b7f35122e2438608d9a003842af955653a7f03b4`

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

## 2026-09-02 · Assignment center and operational eligibility

Branch: `ops/assignment-center-and-eligibility`
Production status: **development / dev database first**

### Decisions

- Staff identity/role and operational responsibility are separate concepts. Changing somebody to Assistant Coordinator does not automatically spread that person across companies.
- A new Assignments area is the main admin surface for staff role classification, counselor-group staffing, and company supervision.
- Existing assignments are never silently overwritten. A staff member with an active responsibility must be explicitly unassigned before their role changes.
- Each company has one primary Assistant Coordinator. One Assistant Coordinator may supervise multiple companies only up to the session-configured load limit; the initial default is four.
- Automated staffing only fills empty positions, balances existing AC load, stops at the configured limit, and requires review before applying.
- Participant source data remains intact even when a record is not operationally eligible. Eligibility is a separate rule used consistently by grouping, group assignment, check-in, and head count.
- Initial Kumasi operational age bounds are 13–20 because the approved source list contains many age-13 records while leadership specifically identified older adult-like records as a grouping risk. Admin settings can narrow or extend the range up to age 21 without deleting source data.
- Existing assigned records outside the configured range are removed from counselor-group operations but remain searchable in People as age-review exceptions.
- Original registration full names remain the primary display name everywhere. Preferred names remain search aliases and secondary detail only.
- People becomes inspection-first; assignment mutations belong in Assignments to avoid two competing places for the same responsibility.
- Head count remains idempotent at one submission per company per round; expected counts now use the same operational eligibility boundary as grouping/check-in.

### Files introduced or substantially changed

- `src/pages/Assignments.jsx`
- `src/pages/assignments.css`
- `src/pages/People.jsx`
- `src/pages/Checkin.jsx`
- `src/lib/registration.js`
- `src/lib/operations.js`
- `src/App.jsx`
- `src/components/AppShell.jsx`
- `tests/registration.test.mjs`
- `tests/schema-contract.test.mjs`
- `supabase/migrations/20260902094500_assignment_integrity_and_operational_eligibility.sql`
- `supabase/migrations/20260902094600_operational_eligibility_publish_alignment.sql`

### Release rule

Validate role/assignment conflicts and operational eligibility in development, run CI/build, then apply the same reviewed migrations to production before deploying the matching merged commit.
