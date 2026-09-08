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
- Assistant coordinators see their assigned scope. Coordinators have whole-session operational visibility. Logistical administrators and session directing couples also have whole-session visibility.
- Only logistical administrators and session directing couples may approve or reject access requests for lower roles. Coordinators may see the access state but do not approve access.
- Authentication is password-first for daily use. Leaders sign in with their own email and password rather than repeated magic-link emails.
- New accounts are created from administrator-issued, one-time invitations. The inviter chooses the person's name, email, role and scope before activation. Shared session access codes are deprecated for new onboarding.
- One-time invite and administrator-assisted recovery codes must be short-lived, tied to the intended email, stored only as cryptographic hashes, and shared directly rather than in group chats.
- Logistical administrators and session directing couples can issue or revoke leader invitations and recovery codes. Coordinators cannot manage access.
- Same ward, branch, or unit is prohibited within one counselor group but allowed within a company. Proposed groups target 8–10 participants.
- The visual identity must not imitate the Church logo or present the app as an official Church product.

## September 2026 operations UI decisions

- The persistent navigation is organized as Today (Overview, Check-in, Head count, Groups) and More (People, Birthdays, Access), with Account kept in the drawer/profile entry. Mobile uses the four Today actions plus More in the bottom bar.
- Drawer, modal, and mobile detail-sheet interactions must close on Escape, backdrop tap, explicit close, and navigation; they must preserve focus and prevent background scrolling while open.
- People is a search-first list-to-detail directory. The list shows only operationally useful identity/status fields; age and sex are one grouped fact, and unit, stake, registration ID, and assignment detail stay behind the detail disclosure.
- Account starts with a compact identity summary. Name editing, permissions detail, and password security are explicit disclosures; sign-out remains a compact account action. Navii avatars use stable user IDs only, never raw emails.
- Head Count follows round → company → report. One company action saves the report and provides immediate saved feedback; demo mode uses the same interaction against in-memory rehearsal state.

## Coherent operations checkpoint decisions

- Read docs/HANDOFF-2026-09-08-COHERENT-OPERATIONS.md before continuing this unfinished branch.
- Only Session Directing Couples record Staff service confirmation and participant age exceptions. Preserve existing website Access authority separately.
- Preserve source approval statuses, published companies/groups and finalized FSY IDs; no new Housing allocation UI in this scope.
- User approved existing development database testing but explicitly asked to skip authenticated database permission tests. Do not create synthetic auth identities automatically.

