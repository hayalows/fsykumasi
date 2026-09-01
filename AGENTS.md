# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## FSY Kumasi product decisions

- The selected visual direction combines the calm, exception-first command centre with a guided conference-readiness journey.
- Desktop and mobile are first-class. Mobile should prioritize the next action, stack operational summaries, avoid hover-only controls, and keep touch targets at least 44px.
- Use the 2026 FSY theme palette supplied by the user as the product color foundation: Blue 35 `#005175`, Blue 25 `#007DA5`, Blue 5 `#C4E9F5`, Green 20 `#8DBF67`, Green 20 soft `#BED7A7`, Yellow 15 `#FCB449`. Use abstract theme geometry without implying this is an official Church product.
- Version 0.0/0.1 uses a full-scale synthetic rehearsal of roughly 1,640 youth plus YSA planning counts. Real participant files must enter through the authenticated CSV/XLSX import workflow, not through chat or source control.
- Counselor records and assignments are managed in the system, but counselors do not receive accounts in this version.
- Assistant coordinators see their assigned scope. Coordinators have whole-session operational visibility. Logistical administrators and session directing couples also have whole-session visibility.
- Only logistical administrators and session directing couples may approve or reject access requests for lower roles. Coordinators may see the access state but do not approve access.
- Same ward, branch, or unit is prohibited within one counselor group but allowed within a company. Proposed groups target 8–10 participants.
- The visual identity must not imitate the Church logo or present the app as an official Church product.
