# FSY Operations project log

This file records product and engineering decisions that materially change how the operations system behaves. Pull requests and migration files remain the source of truth for implementation details.

## 2026-09-04 · Phase 1 reliability, arrival scope, and mobile operations refinement

Branch: `codex/phase1-ops-20260904` (based on verified `origin/main` at `479e17649093f2e84003bb810eb7d63b7a747990`)
Production status: **release candidate; PR, migration, merge, deployment, and smoke gates pending**

### Audit baseline

- The current production session is `FSY Kumasi 2026`, in planning for 2026-09-14 through 2026-09-19. The aggregate live shape is 1,665 participants (870 female, 795 male), 41 companies, 162 counselor groups, 1,614 active badge assignments, zero arrival events, and 322 audit events.
- The local demo was reviewed at the default desktop viewport and an explicit 390x844 viewport. Overview, Registration, People, Assignments, Groups & companies, Check-in, Head count, Access, Account, More, detail sheets, and the no-show confirmation surface were inspected. Production was inspected only in its current signed-out state; no credentials were entered or requested from the browser.
- The full audit and capture steps are recorded in `docs/audits/2026-09-04-phase1-operations-ui-ux.md`. No production participant, arrival, replacement, badge, or ID data was changed.

### Decisions and changes

- Reorganized navigation into Today (Overview, Check-in, Head count, Groups & companies) and More (People & setup, Team tools, Admin & utilities). Birthdays is grouped with lower-frequency utilities and Account remains in the profile entry. Desktop sidebar content now scrolls inside the sidebar; mobile uses four primary actions plus More.
- Hardened drawer, modal, and sheet backdrop dismissal with pointer events while preserving Escape, navigation, focus restoration, and body-scroll locking. Fixed segmented controls so generated IDs support keyboard arrow navigation and high-density labels remain readable at mobile widths.
- Kept People search-first and list-to-detail. Mobile details and no-show confirmation are bottom sheets; age and sex remain one grouped fact; private detail stays disclosed only on request. A no-show requires an explicit confirmation source and optional supporting note instead of a browser prompt.
- Kept FSY ID preparation separate from finalization. Admin finalization is now disclosed behind an explicit admin section and confirmation sheet; production IDs are never auto-finalized.
- Changed the People attendance path to the guarded arrival-status RPC in live mode and to isolated in-memory rehearsal state in demo mode. Added a migration that delegates the legacy attendance RPC to the guarded status function and applies company scope to Assistant Coordinator vacancy visibility. It does not change tables, RLS policies, or production rows.
- Removed `AGENTS.md` and `.env.example` from this release branch as requested for public publishing; `.gitignore` now ignores all `.env*` files. No service-role credential or secret was added to the release.

### Verification gates

- `npm test`: 54 passing.
- `npm run build`: passing; Vite compiled 282 modules and the Sites artifacts were prepared.
- `npm run test:sites`: 4 passing; required client/server/hosting outputs are present.
- Live Supabase review confirmed the PR #33 migrations are already applied, all public operational tables remain RLS-enabled, and the new migration is additive function hardening only. The controlled RPC security-definer warnings remain intentional and are not evidence of a frontend service-role exposure.
- Remaining gates are the reviewed PR and green CI, migration application, merge, Vercel production deployment, and post-deploy HTTP/assets/service-worker smoke verification.

### Intentionally unchanged

- No new Wellness 2.0 or Daily Ops 2.0 work was started. Housing, Wellness, Food, existing grouping/assignment rules, permissions, RLS, and operational eligibility remain on their existing contracts.
- The 51-participant difference between the current participant count and active badge assignments, and the two source rows missing stake data, remain visible data-quality follow-up rather than being silently repaired.

## 2026-09-02 · Mobile-first operations UI refinement

Branch: `codex/operations-clarity-20260902` (based on verified `origin/main`)
Production status: **release candidate; production deployment follows the reviewed PR**

### Decisions

- The operations IA keeps Daily work (Overview, Check-in, Head count), the session directory (People, Groups & companies), and lower-frequency tools behind More tools (Registration, Assignments, Access, Birthdays). Account remains in the profile entry rather than becoming another permanent task destination.
- Mobile exposes four frequent actions plus More in the bottom navigation. More is a dismissible drawer with backdrop, Escape, navigation, close control, body-scroll lock, and focus restoration behavior. Desktop keeps a grouped sidebar with an internal scroll area so short screens do not push the account out of view.
- Account starts with a compact Navii-backed identity summary. Name editing is explicit; permissions and security are collapsed until requested; sign-out is a compact account action. Avatar seeds use a stable user ID or fixed demo seed, never a raw email.
- People is a search-first responsive directory. Mobile participant and review details use bottom-sheet surfaces with grouped age/sex facts, progressive sensitive fields, backdrop/Escape dismissal, and focus return to the originating row.
- Access is invite-first, with role policy, current-roster details, recovery/admin controls, and older request history disclosed on demand. Assignments leads with role classification and keeps the suggestion helper behind an advanced disclosure.
- Head count follows round → company → report. A pending company opens into one detail action, where `Report all here` is available beside the single `Save report` action; saved feedback is immediate and visible.
- Session-facing identity is configuration-driven (`KCC FSY 2026` in the demo rehearsal; production currently reports `FSY Kumasi 2026`), while Overview retains the supplied `Walk With Me · Moses 6:34` theme treatment.

### Compatibility and verification

- This pass does not change Supabase schema, RLS, permissions, or backend data contracts. Demo grouping and head-count interactions remain in-memory rehearsal state only.
- The verified online baseline was `origin/main` at `fb11f58cb6cfb7094b5e95f61bf1f07b909e339c`; the registration review inbox and assignment center were preserved.
- Cohort language now distinguishes registration records, eligible youth, data exceptions, and eligible youth ready for placement. This avoids treating a not-yet-published structure as a registration error.
- Verification includes the authenticated production audit documented in `audit/live-2026-09-02/README.md`, local rehearsal browser review, `npm test`, `npm run build`, and `npm run test:sites`. Production data was read only during the audit; no live mutations were performed.

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

