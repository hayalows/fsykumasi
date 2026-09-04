# Phase 1 operations UI/UX audit

Date: 2026-09-04
Repository baseline: `origin/main` at `479e17649093f2e84003bb810eb7d63b7a747990`
Local branch: `codex/phase1-ops-20260904`
Production: [fsy-kumasi-operations.vercel.app](https://fsy-kumasi-operations.vercel.app/)

## Evidence captured

1. Inspected the verified GitHub baseline, PR #33 changes, local source, Supabase migrations, and the Vercel entry point.
2. Read the live Supabase aggregate shape without selecting participant names, emails, phones, medical data, or other private fields. Current session is `FSY Kumasi 2026`, status `planning`, dates 2026-09-14 to 2026-09-19: 1,665 participants (870 female, 795 male), 41 companies, 162 counselor groups, 1,614 active badge assignments, zero arrival events, and 322 audit events.
3. Ran the local demo server and inspected the UI in Codex In-app Browser at the default desktop size and at 390x844. Screens were captured and visually reviewed for Overview, Registration, People, Assignments, Groups & companies, Check-in, Head count, Access, Account, the More drawer, the People detail sheet, and the no-show confirmation sheet.
4. Exercised mobile drawer and sheet dismissal using backdrop taps and Escape. Exercised navigation from More using the visible Registration control. Verified focus returned to the originating controls after dismissal.
5. The browser screenshot captures are inline in the task transcript. The browser control surface does not provide a filesystem screenshot export, so this audit records the exact capture steps and viewport instead of pretending image files were saved.
6. After the user authenticated directly in the in-app browser, production was smoke-tested on the deployed target across Overview, Check-in, Head count (including round-to-company detail), Groups & companies, People/detail, Registration/FSY IDs, Assignments, Access, Birthdays, and Account. Account Edit was opened and cancelled without saving; no check-in, no-show, head-count report, birthday acknowledgement, invitation, role change, or ID finalization action was invoked.
7. The production deployment `dpl_HX37gkNp3Tu2GbouX6B9nXHDoBSR` was Ready and aliased to the public domain. `/`, `/sw.js`, and `/manifest.webmanifest` each returned HTTP 200, and the browser diagnostic pass reported zero warning/error entries.

## Findings and disposition

| Surface | Finding | Disposition |
| --- | --- | --- |
| Navigation | Too many permanent destinations competed for attention and the desktop sidebar could push lower content out of view. | Grouped Today and More, moved Birthdays to Admin & utilities, kept Account in the profile entry, and made the sidebar internally scrollable. |
| Mobile navigation | Primary task actions and secondary tools needed clearer separation. | Four Today actions remain in the bottom bar; More opens the complete drawer. |
| Drawer and sheets | Backdrop/pointer behavior needed to be consistent across touch surfaces. | Shared dismissible layer now closes on pointer backdrop, Escape, explicit close, and navigation while retaining focus and scroll locking. |
| People | Dense rows and detail surfaces could force too much information into view; browser confirmation was not a suitable mobile interaction. | Search-first list, grouped age/sex, progressive secondary detail, mobile bottom sheet, and an auditable no-show confirmation sheet with source selection. |
| Account | Identity, permissions, security, and sign-out were not sufficiently separated by priority. | Compact identity first; explicit Edit, Permissions, and Security disclosures; compact sign-out; stable user-ID Navii avatar seed only. |
| Registration and IDs | Finalization was too close to normal preparation and could be misread as a routine action. | Prepare remains normal; finalization is inside Admin finalization with an explicit confirmation sheet. |
| Access | The normal task must be inviting a leader, not reading policy text. | Invite-first hierarchy retained; responsibility/scope details stay progressive. |
| Assignments | Role classification is the first task; suggestions are secondary. | Existing task order retained with advanced staffing controls disclosed. |
| Head count | The intended flow is round to company to report, with one save action. | Existing progressive model retained; demo correctly explains that companies must be published before head count is available. |
| Auth lifecycle | A token refresh must not reset the current page, search, scroll, or loading state. | Existing hydration-generation guard preserved; refresh/user-update events are silent maintenance events; local sign-out remains device-local. |
| Arrival authorization | Assistant Coordinator vacancy visibility needed the same company scope as other arrival operations. | New additive migration applies the scope predicate and delegates the legacy attendance function to guarded arrival status. |

## Responsive review matrix

| Width | Observed result |
| --- | --- |
| Default desktop | Sidebar stayed within a fixed 260px column with its own scroll area. People detail remained beside the search/results list. Segmented controls retained readable Participants and Staff labels. The same primary surfaces loaded in the authenticated production smoke pass. |
| 390px x 844px | Header, page title, primary action, search, list rows, and bottom bar stayed within the viewport. More opened as a scrollable drawer. People details and no-show confirmation opened as bottom sheets. Registration workspace tabs remained readable and horizontally scrollable when needed. |

## Safety review

- The new SQL is a migration-only function hardening change. It does not weaken RLS, create direct table writes, delete participant records, write arrivals, replace participants, finalize IDs, or expose service-role credentials.
- Live public operational tables remain RLS-enabled. Sensitive details remain in protected tables and controlled RPCs. The Supabase advisor notices about security-definer functions and no direct policy on controlled tables were reviewed as intentional boundary patterns, not suppressed.
- The release branch removes `AGENTS.md` and `.env.example`, ignores `.env*`, and adds no credentials or local-only files.
- Production data was used for density and rule understanding only. No participant, arrival, replacement, badge, ID, or permission mutation was used for smoke testing.

## Open follow-up

- The live 1,665 participant rows versus 1,614 active badge assignments, and the two source rows without stake data, need an authorized data-quality decision; this pass leaves them intact.
- The public 2026 International Staff Handbook was not found during research; future policy-sensitive changes should continue to use confirmed session rules and available official FSY materials rather than inventing 2026 policy.
