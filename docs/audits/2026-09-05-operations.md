# FSY operations release review

## Context and preserved workflows

Reviewed main through PR 57 and recent registration, Housing handoff, staff-linked access, capability hotfix and Overview changes. Production is a Vite/React static application on Vercel, with Supabase Auth, PostgreSQL RLS, security-definer RPCs and selective realtime subscriptions. Development and production use separate projects. Existing registration source records, preferred-name review, parent-confirmed no-show flow, registration-to-Housing handoff and confidential Wellness separation remain valuable.

The planning guide places dietary coordination with Food; the staff handbook describes Assistant Coordinators gathering counselor counts and accounting for every youth. This release therefore separates meal receipt from current physical presence, and keeps medical details out of head-count notes.

## Findings and decisions

- Overview: replaced repetitive setup/card grids with one next action, a short attention list and role-specific context. Live roster totals use an aggregate-only RPC. AC company context comes from the database-scoped workspace, not the size of their capability list.
- Head count: new rounds snapshot each eligible participant and current approved staff member once. Unchecked is explicit. Company confirmation preserves exceptions. Missing and unchecked people prevent closing. Revision checks prevent silent overwrites. Leadership sees all companies; an AC's additional committee does not broaden count reporting. Historical aggregate reports remain read-only.
- Identity: company-sequence-origin format preserves existing company/sequence values. Prior strings are recorded as aliases and finalized badges need reprinting. Transfers retire the old assignment and issue an unused sequence in the new company. Replacements receive an unused sequence, even when the origin matches the original youth. Repeated preparation appends; it does not renumber. Historical counts retain captured identities and companies.
- Access: website accounts can be invited without Staff records. Committees add capabilities independently of Staff role/company assignments. Staff-linked AC assignments continue syncing through the existing workflow. Disabled session access no longer retains team capabilities. Invite claims lock their row; recovery does not restore an obsolete role/scope snapshot. Access uses the selected session rather than silently choosing another grant.
- Food: exact non-answers (NA, none, food, etc.) are excluded; uncertain or unfamiliar language remains for human review. Source responses are untouched. Pagination removes the 1,000-row roster ceiling. Live serving UI waits for a confirmed write instead of leaving a failed optimistic state visible. Empty meal lists poll for the first service.
- People and Groups: AC default scope remains their companies even with additional committee lookup powers. People supports all matches progressively and searches current/previous IDs. Housing, identity, eligibility and meal reads page using stable keys.

## Security and integrity review

All public application tables inspected have RLS enabled. New snapshot and alias tables revoke direct API access and use scoped RPCs with empty search paths. No service-role secret is sent to the frontend. Existing publishable keys are public by design. New head-count tables are not added to realtime publication: bounded polling avoids broad roster broadcasts. The service worker handles same-origin static shell assets, not Supabase responses.

No production data is deleted. Retired assignments and old reports remain. Company transfers and replacements are transactional and audited. Formatting migration changes only current ID strings, with original values retained. The sequence ceiling remains 99 and fails clearly instead of reusing an identity.

## Validation

- Node regression suite plus production build and Sites package verification.
- Development transaction tests exercise authenticated AC reads, cross-company denied writes, additive Food access, disabled-access denial, unchecked defaults, stale revisions, closed-round protection, summary scope, company transfers and same-origin replacements. A deliberate terminal exception rolls back all fixtures after assertions pass.
- Preview-only synthetic fixture pages exercise role and responsive layouts at 390, 768, 1366 and 1920 CSS pixels. They are excluded from production bundles. This complements database tests; it does not claim to be a physical-device or every-account end-to-end test.
- Production rollout requires CI success, migration preflight, alias/count reconciliation, refreshed service-worker version and read-only checks of critical screens and backend logs.

## Operational limits

A new head-count round captures the roster at opening. New arrivals or transfers after opening appear in the next round; the current snapshot is deliberately stable. Staff serving multiple companies appear under one reporting company. Meal receipt remains a separate operational fact. Dietary filtering triages responses; the Food team still confirms actual accommodations. Previously finalized badges should be regenerated after the format change.
