# Coherent operations checkpoint — unfinished, do not merge yet

The user stopped implementation to conserve usage and explicitly requested that work be pushed and handed off. Continue from this branch, not the dirty root checkout. This checkpoint is not a completed release.

## Checkout and release baseline

- Repository: hayalows/fsykumasi.
- Working branch: `codex/coherent-operations-20260908`.
- Worktree: `C:\Users\USER\Documents\ChatGPT\FSY Kumasi\worktrees\coherent-operations-20260908`.
- Started from verified remote main `f0807c787f89bcac4f20693278137a0b74f652c6`, PR #87, Remove report Source IDs and finalize participant FSY IDs.
- Production URL: https://fsy-kumasi-operations.vercel.app . Vercel deployment `dpl_HhSdLnQa6Xz3TPBdeD2jHYiFLToF` was READY and matched that commit.
- Vercel project `prj_FtymLzPhfJjNiItIv1zRXZ6Mmz7Y`, team `team_20IpnOKLjxGtiLRZCQXiCeBC`.
- Production Supabase: `rqwhfiwhuwxhyziallyt`. **No production database or deployment changes were made in this session.**
- Development Supabase: `lizqbihlxeorswibzwyx`; explicitly authorized by user for development migration testing. Runtime routes localhost and Vercel previews here.
- Root checkout is old main `22cc111` with extensive pre-existing uncommitted work. Two other worktrees also pre-exist. Their changes were preserved, not mixed into this branch or pushed.

## User decisions and boundaries

- The full original task asks for shared person identity/peek, one search engine, separated Staff source/planning/arrival/clearance/roles/duties, deterministic staffing, 20+ cohort exclusions with explicit exceptions, stable groups/companies/FSY IDs, actionable reports, and housing foundations only.
- **Session Directing Couples alone record service confirmation and participant exceptions.** User explicitly selected this. Do not equate website Access administration with authority for these decisions.
- User approved testing against existing development Supabase after auto-review initially rejected it.
- User explicitly said **skip authenticated database permission tests** after a rollback-only synthetic auth identity was rejected. No auth identity was created. Do not create one or repeat the request without new user direction.
- Preserve existing Access/authentication. Production currently permits coordinator access administration: source and DB prove this is already implemented. Older root AGENTS instructions about coordinators are stale relative to live Access; do not regress current Access as part of this task.
- Do not rebuild published youth groups/companies or regenerate existing finalized IDs. Leave 12/13-year-old cases untouched. Do not build the new Housing allocation UI.
- Latest user instruction overrides the original full-release objective for this session: checkpoint, push, report, stop.

## Production observations (2026-09-08, reverify before release)

- Session `d6168b42-0d57-4e8d-a2ae-db1e97ec3308`, 14–19 September 2026, planning.
- 44 companies, 175 published counselor groups, all 175 assigned to approved counselors.
- 1,743 finalized FSY badges and assigned operational youth.
- Current participants: 1,756 approved + 36 awaiting = 1,792. Also 35 noncurrent records (32 approved, 2 awaiting, 1 cancelled).
- Eight current people aged 20+ at session start; all unassigned. One age 12 and 153 age 13; 149 age-13 records assigned. Four age-19 records unassigned.
- Current Staff: 228 approved counselors, 33 awaiting counselors, 13 cancelled counselors; 20 approved ACs, 3 awaiting ACs; 2 logistical administrators, 2 session directors, 3 coordinators. Additional noncurrent staff exist.
- 42 companies have AC coverage from 15 approved ACs; two companies have no AC.
- One participant checked in, no room at observation time.
- Settings show age 13–18, groups 8–10, 4 groups/company, 4 companies/AC. HOWEVER actual eligibility is DOB based: turns at least 14 in FSY year and remains younger than 19 through session end. Settings alone are not authoritative.
- All public tables had RLS enabled. Private details have separate tables and policies.
- In-app production browser had existing login. Initial transient workspace error recovered on retry. Inspected Overview and People at mobile size. No comprehensive desktop/mobile QA performed.
- Read local 2026 handbook and 2025/26 planning guide from Downloads. Handbook page 150 (PDF page 154) says on-site registration depends on area direction, signed guardian terms, bishop/branch president approval, payment, group and housing coordination. Existing Registration already has a three-check verification UI. Committee/program duties can coexist with counselor/AC responsibility.

## Code drafted

- `src/lib/person-search.js`: pure normalized token relevance search, reversed names, aliases, punctuation/accents/hyphens, prefixes, conservative one-edit/transposition tolerance, nonfuzzy badge IDs, deterministic ordering. Reusable index API included.
- Registration helpers, People, Assignments, Head Count, Birthdays, Housing filters, Food and Reports partly migrated to shared search.
- Food query path loads all server-scoped pages for searching (rather than searching only one page), caches briefly and invalidates on a meal mutation. This needs review for auth cache invalidation and performance before release.
- `person-identity.js`, `PersonPeek.jsx`, CSS: minimal projection, shared provider and clickable names integrated in several operational views, full-record link, reused dismissible layer. Projection does not copy contact/health fields.
- `staff-state.js`, `staffing-planner.js`: separate states, provisional planning, reserve pool, deterministic sex-compatible replacements, preserve valid assignments, AC load constraints and exceptions. Both active staffing screens now call this planner.
- `StaffOperationsSheet`, `OnSiteStaffSheet`, `ParticipantExceptionForm`, `operational-state.js`: drafted state and on-site workflows, director-only confirmation UI, committee duties, existing identity exception path.
- `loadStaff` now loads operations and duties; `applyStaffAssignmentPlan` uses `apply_staff_plan_v26`.
- Assignments includes arrival/service editor, staff-state filters and a visible AC load setting. People full record includes director exception disclosure.
- Four one-off Python edit scripts are included as work provenance. **Do not rerun these on already-edited source**; they are not idempotent build scripts.

## Database changes already applied to DEVELOPMENT ONLY

Development was behind merged production. Applied these existing merged function definitions first:

1. `baseline_guided_staff_role_transitions`, migration version `20260908111201`: from `20260905121000_guided_staff_role_transitions.sql`.
2. `baseline_onsite_identity_functions`, `20260908111213`: from `20260905143000_operational_inbox_and_onsite_identity.sql`, starting at the first CREATE FUNCTION; omitted the legacy headcount archival DML.
3. `baseline_food_workspace_v2`, `20260908111225`: from `20260906094000_food_workspace_performance_v2.sql`.
4. `coherent_operations_v26`, `20260908111245`: exact local `supabase/migrations/20260908105118_coherent_operations_v26.sql` at checkpoint.

The first v26 attempt failed because Food v2 functions were absent; transaction rollback was verified (`staff_operations` absent). Retry after baseline alignment succeeded. Latest development observation: zero auth users, zero Staff, 1,640 rehearsal participants.

V26 adds RLS-protected Staff operations/duties and director-only participant decision evidence; audited revision-checked Staff updates; explicit director exceptions; 20+ exclusion (aborts if adults acquire live placements); atomic staffing/replacements with stale checks and advisory locking; AC load setting; assignment guards; shared eligibility for Food; arrived Staff in new headcount rounds; existing badge allocator for imported exceptions; new on-site Staff source status awaiting rather than claiming approved.

**Do not apply to production yet.** Migration has only applied successfully, not passed authenticated behavior tests or final review. It dynamically replaces selected existing function-body fragments to preserve authorization; inspect every replacement against live definitions and verify idempotence/drift guards.

## Verification

- Latest checkpoint `npm run build` passed (367 modules; existing bundle-size warning).
- Latest full `npm test`: **266 passed, 0 failed**. This includes existing Sites tests after build. `git diff --check` passed.
- Focused new tests cover relevance, exact IDs, duplicate names, 2,500-person speed, private-field projection, Staff planning/service distinction, deterministic staffing/replacement, AC feasibility.
- Database script `tests/sql/coherent-operations-v26.sql` is **NOT validated**. First attempt stopped because development has no auth user. Proposed synthetic auth creation was rejected and user then said skip. Script now requires an existing explicitly authorized development test user and creates no auth account automatically. Do not run casually: it changes role fixtures inside a rollback transaction.
- No local server/browser verification of the new components yet. No Vercel preview QA. No final diff/security review, Supabase advisors, production migrations, merge, or production post-release health check.

## Known unfinished work and review risks

1. Complete shared search: Groups company filter still uses concatenated `.includes()`; some inactive/versioned files and other active pickers retain independent logic. Reports has rank ordering with Infinity arithmetic that needs a stable tie review. Food cache must clear on auth/session/scope changes; do not retain another user's scoped results. Consider building indexes with useMemo instead of rebuilding per query.
2. Review Person Peek everywhere and avoid nested interactive controls: Food inserts a button in a checkbox label; verify click does not serve a meal. Some Reports payloads omit person IDs so links currently may not render; resolve by safe identifier, never ambiguous name. Birthday ID shapes and age display need checking. People imports shared projection but still has its own full-record anatomy; finish actual reuse. Scope changes while peek open and navigation/focus behavior need testing.
3. Staff planner computes absent replacements, but some UI counts/filters still check only non-null counselor IDs. Groups summary and Assignments filter must surface absent/not-cleared responsibility as gaps. Preview rows need visible “Needs confirmation” markers and complete exception explanations; remove outdated “plus N more” copy now all suggestions render. Old AssignmentsV2 has random code but is not the active route; decide safe removal.
4. Ensure individual assignment/role-transition/AC auto-suggestion RPCs use the same planning semantics and locking. The new plan RPC is serialized, but legacy paths and concurrent state changes need review. Never silently transfer a valid AC merely to balance loads. Missing/null sex must fail consistently. Test duplicates, invalid targets, stale revisions and partial-plan rollback without claiming tests that were skipped.
5. Strengthen on-site Staff duplicate prevention: existing DB rejects current exact name+DOB duplicates but not concurrent duplicates or inactive identities. Review search-first flow for reuse rather than duplicate. New form saves then says open Arrival & service; next-action handoff could improve.
6. Confirm exception path across `ensure_on_site_fsy_id`, assignment, check-in, Housing, Food, headcount, Reports. SQL fragment substitutions must actually match. Existing on-site UI may still require local verification after director decision; distinguish required checks from source approval. Unknown/missing DOB should remain blocked. Reconsider exception revision/concurrency checks and actor/audit evidence privacy.
7. Source-derived ages should be verified against date-of-birth/session start for both participants and Staff; do not assume stored age current. Do not expose DOB just to display derived age.
8. Reports still need full operator-focused audit and Staff arrival/clearance/assignment report. No new Staff report completed.
9. Housing foundation documentation/model is not finished. Current Housing UI only has minimal person-link integration; no new room allocation UX. Future responsibility anchors should attach to stable groups, rooms should support physical order/adjacency/zones/capacity, replacements may inherit responsibility housing position. Do not invent inventory or automatically move occupied rooms.
10. Write durable decisions, inspect diff, run tests/build/Sites, start local server and visually inspect desktop/mobile using CUA. Use synthetic fixtures for new UI; user forbade creating auth test identity. Vercel preview will use dev with no users; do not pretend authenticated preview QA occurred or point it at production to bypass this.
11. Before release, re-fetch main, check production counts/badge/group/company identity fingerprints, compare final migration, document rollback, apply only after validations, merge PR, verify Vercel READY plus actual runtime/database health. Current production state must not be assumed unchanged since this checkpoint.

## Tools and environment

- `gh` and `git` network commands require escalated execution in this Windows sandbox. Fetch succeeded with `git -c url.https://github.com/.insteadOf=git@github.com: fetch https://github.com/hayalows/fsykumasi.git main`.
- Build/esbuild needs escalated execution. Local worktree has locked dependencies installed via `npm ci --ignore-scripts`.
- Supabase MCP list_projects omitted both FSY projects, but direct execute_sql/project calls work. Do not conclude FSY is absent from that list.
- Supabase CLI is local `node_modules/.bin/supabase.cmd` v2.116.0. It needs filesystem permission for its telemetry. Migration file was created via CLI.
- In-app browser CUA inspected production with existing login; never extract tokens or credentials. New model should discover/reuse browser state normally.
- Source documents are in `C:\Users\USER\Downloads\2026_fsy_international_staff_handbook.pdf` and `fsy_2025_26_planning_guide-1.pdf`; bundled Python supports `pypdf`, not `pymupdf`. Keep raw registration files out of Git.
