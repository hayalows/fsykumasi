# Mobile-first operations refinement

Date: 2026-09-02

Status: Release candidate

## Decision

FSY Operations keeps a small set of daily destinations visible and moves lower-frequency setup and utility work behind grouped navigation. The primary mobile bar is limited to Overview, People, Check-in, Head count, and More. The desktop sidebar groups the same destinations into Daily work and People & setup, with its own scroll area so the account controls remain reachable on short screens.

The session-facing identity is configuration-driven (`KCC FSY 2026` in the rehearsal) while the reusable product remains FSY Operations. Overview continues to carry the supplied `Walk With Me · Moses 6:34` theme treatment and identifier asset without implying official Church ownership.

## Interaction rules

- Mobile More is a real drawer: it closes on navigation, backdrop tap, Escape, and its close control; body scrolling is locked while it is open and focus returns to the opener.
- Short admin flows and mobile detail views share one dismissible layer with backdrop close, Escape, focus trapping, initial focus, and focus restoration.
- Account starts with identity and the one useful edit action. Security, permissions detail, and sign-out remain compact or collapsed until needed.
- People is a searchable list first. A selected person becomes a responsive detail panel; mobile uses a bottom sheet, grouped facts, and progressive disclosure for sensitive registration fields.
- Access keeps the invitation action first and places role policy, roster controls, and older request history behind disclosure.
- Assignments keeps role classification first and places the suggestion helper behind an explicit advanced disclosure.
- Head count follows round → company → detail. A pending company has one quick `All here` action, while the open detail has one save action and a visible saved state.

## Safety and compatibility

No database schema, RLS policy, permission rule, or operational backend contract is changed by this UI pass. Account avatars use the stable authenticated user ID (or a fixed demo seed) with Navii; raw email addresses are never used as avatar seeds. The demo rehearsal stores grouping and head-count interactions in memory only so the flows can be reviewed without live writes.

Verification target: local synthetic rehearsal at 390px and desktop widths, with tests, production build, and Sites worker checks passing before release.

