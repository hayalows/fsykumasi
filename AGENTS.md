# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## FSY Kumasi product decisions

- The selected visual direction combines the calm, exception-first command centre with a guided conference-readiness journey.
- Desktop and mobile are first-class. Mobile should prioritize the next action, stack operational summaries, avoid hover-only controls, and keep touch targets at least 44px.
- Use the 2026 FSY theme palette supplied by the user as the product color foundation: Blue 35 `#005175`, Blue 25 `#007DA5`, Blue 5 `#C4E9F5`, Green 20 `#8DBF67`, Green 20 soft `#BED7A7`, Yellow 15 `#FCB449`.
- Use the supplied official 2026 `Walk with Me` identifier asset where it adds context (sign-in, navigation identity, and theme banner). Preserve its artwork and colours, use approved quiet backgrounds, never add effects to the identifier, and keep the operations product name visually separate so the app does not imply it is an official Church registration system.
- Version 0.0/0.1 uses a full-scale synthetic rehearsal of roughly 1,640 youth plus YSA planning counts. Real participant files must enter through the authenticated CSV/XLSX import workflow, not through chat or source control.
- Counselor records and assignments are managed in the system, but counselors do not receive accounts in this version.
- Assistant coordinators see their assigned scope. Coordinators, logistical administrators, session directing couples, and FSY area advisory couples have full operational visibility; the area advisory couple is labelled as whole-program scope.
- Coordinators, logistical administrators, session directing couples, and FSY area advisory couples may approve or reject access requests for lower roles and manage the approved operational exceptions.
- Authentication is password-first for daily use. Leaders sign in with their own email and password rather than repeated magic-link emails.
- New accounts are created from administrator-issued, one-time invitations. The inviter chooses the person's name, email, role and scope before activation. Shared session access codes are deprecated for new onboarding.
- One-time invite and administrator-assisted recovery codes must be short-lived, tied to the intended email, stored only as cryptographic hashes, and shared directly rather than in group chats.
- Coordinators, logistical administrators, session directing couples, and FSY area advisory couples can issue or revoke leader invitations and recovery codes.
- Same ward, branch, or unit is prohibited within one counselor group during controlled pre-session roster planning but allowed within a company. The explicit post-finalization on-site arrival exception is documented below. Proposed groups target 8–10 participants.
- The visual identity must not imitate the Church logo or present the app as an official Church product.

## September 2026 operations UI decisions

- The persistent navigation is organized as Today (Overview, Check-in, Head count, Groups) and More (People, Birthdays, Access), with Account kept in the drawer/profile entry. Mobile uses the four Today actions plus More in the bottom bar.
- Drawer, modal, and mobile detail-sheet interactions must close on Escape, backdrop tap, explicit close, and navigation; they must preserve focus and prevent background scrolling while open.
- People is a search-first list-to-detail directory. The list shows only operationally useful identity/status fields; age and sex are one grouped fact, and unit, stake, registration ID, and assignment detail stay behind the detail disclosure.
- Account starts with a compact identity summary. Name editing, permissions detail, and password security are explicit disclosures; sign-out remains a compact account action. Navii avatars use stable user IDs only, never raw emails.
- Head Count follows round → company → report. One company action saves the report and provides immediate saved feedback; demo mode uses the same interaction against in-memory rehearsal state.

## Coherent operations checkpoint decisions

- Read docs/HANDOFF-2026-09-08-COHERENT-OPERATIONS.md before continuing this unfinished branch.
- For the September 2026 pre-session finalization, Coordinators, Logistical Administrators, Session Directing Couples, and FSY Area Advisory Couples may record Staff service confirmation and participant final-roster decisions. Preserve imported/source registration and identity history.
- The operational participant window is age 12 through 19 at session start. Verified records with approved or awaiting source approval may be admitted through the local clearance workflow. Age 20 and above is excluded from the participant roster without deleting the source record.
- Newly admitted 12–13-year-olds and locally cleared awaiting records receive an isolated supplemental company/group, counselor and assistant-coordinator coverage, and an FSY ID. Existing published companies, groups, and IDs are not rebuilt.
- Committee Staff should display one direct responsibility label such as `Materials committee` rather than a generic `Committee member` label plus a second visible label.
- Preserve source approval statuses, published companies/groups and finalized FSY IDs; no new Housing allocation UI in this scope.
- User approved existing development database testing but explicitly asked to skip authenticated database permission tests. Do not create synthetic auth identities automatically.

## Controlled final-roster decision — 2026-09-09

- This decision supersedes the earlier additive 12–19 supplemental-closeout rules above for the current Kumasi session final roster.
- The active youth roster for this controlled finalization is age 12 through 18 at session start. Age 19 and above leave the active youth roster without deleting their source registration/person history.
- Finalization uses a minimum-change controlled rebalance. Treat the current published groups, companies and FSY IDs as valuable baseline state rather than rebuilding everybody from scratch.
- Keep existing participant placements wherever possible. Fill compatible open places first, then create only the groups and companies that the final population mathematically requires. Move an already-placed participant only when the 8–10 person group rule or ward/branch separation rule requires it.
- A ward, branch or unit still cannot repeat within one counselor group during the controlled final-roster rebalance. Company-level repetition is allowed.
- Prefer any necessary existing-participant move inside the same company so the participant keeps the same FSY ID. A company change requires a replacement FSY ID and an ID-history record; new participants receive new IDs.
- Before the controlled rebalance writes anything, save a complete operational roster version covering participant placements, participant decisions, companies, groups, Staff company assignments, Staff operational state, badge assignments/ID history, structure settings and finalization state.
- Support guarded restore of a saved roster version while the session remains in planning. Refuse restore when live check-in, active Housing or later head-count dependencies would make rollback unsafe. Save another safety version immediately before any restore so the restore itself is reversible.
- Refuse controlled finalization while live check-ins remain. The user intends to reset the current check-ins manually before applying the final roster so arrival operations restart from a clean state.
- Future verified on-site youth must obey the same active session age policy; an age-19+ participant must not receive an active youth badge through an older supplemental path.
- Do not merge or deploy this controlled final-roster change to production until the user reviews the completed build and explicitly approves the production push.

## Post-finalization on-site arrivals — 2026-09-10

- New verified on-site participants follow a simple operational path: add details, verify required approvals, choose an available counselor group, issue the FSY ID, then check in. Housing may assign a room after check-in.
- For this post-finalization on-site path only, ward/branch/unit duplication does not block placement. Staff may place the participant into any compatible published group with open capacity even when someone from the same unit is already there. Sex compatibility and configured group capacity remain hard rules.
- Choosing a group determines the company. Placement and FSY ID issuance must complete together so staff never leave an on-site participant half-placed.
- This exception must not rebuild, rebalance, or renumber the settled final roster. Existing published companies, groups, placements and FSY IDs remain stable.
- Parent/guardian phone is required for a newly added on-site participant; a second parent/guardian may be recorded. T-shirt size is selected from Small, Medium, Large, Extra Large, or Extra Extra Large.
- The user explicitly approved fixing, merging and pushing this on-site registration release to production on 2026-09-10.

## Interaction refinement direction — 2026-09-12

- Keep FSY Ops task-first rather than copying decorative component-gallery styles. Borrow proven interaction patterns from Apple HIG, OpenSource UI, and OpenAI design-system practice only when they reduce thinking, errors, or repeated work.
- Search and workspace context should be easy to discover. Preserve native controls where they are more reliable on phones, then style them to fit the product instead of replacing them with custom interaction code without a clear benefit.
- Mobile controls must remain at least 44px, touch text-entry controls must render at 16px or larger to avoid iOS focus zoom, and pinch zoom must remain available.
- System state should be calm and consistent: connection, training, stale data, and refresh errors use one compact status language with interruption proportional to severity.
- Temporary successful actions should use lightweight feedback and Undo when safe; persistent banners are reserved for information the user must keep seeing.
- Visual refinements should reduce dead or redundant controls, keep primary actions obvious, and preserve keyboard focus, contrast, safe-area handling, and responsive behavior.
