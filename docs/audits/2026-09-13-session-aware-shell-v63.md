# KCC FSY 2026 session-aware shell v63

## Goal

Make the operations app feel aware of the conference rather than behaving like a static planning dashboard. The shell should tell a leader where the session is in time, preserve their role and scope, and keep the next operational action easy to find.

## Product decisions

- Use **KCC FSY 2026** as the canonical product/session identity in the runtime shell, authentication surface, browser metadata and installed-app metadata.
- Treat the day before the configured session start as **Day 0** for this operations app. This is an internal operational convention, not official handbook terminology.
- Use the configured session dates and the `Africa/Accra` timezone to derive the current conference context automatically.
- Keep navigation order stable. Session intelligence belongs in Overview, the topbar context and task priority, not in moving navigation targets.
- Keep the day context lightweight. It is hierarchy/context, not another dashboard card.
- Use the supplied 2026 theme artwork consistently for the browser icon, Apple touch icon and PWA manifest instead of serving a different generated FSY icon to some platforms.
- Do not claim the supplied artwork is maskable without a dedicated safe-area asset. The manifest therefore uses it as a normal `any` icon.

## Session progression

- More than one day before: `Starts in N days`
- One day before: `Day 0 · Session starts tomorrow`
- Start date: `Day 1 · Arrival & check-in`
- Middle dates: `Day N · Session live`
- Day before configured end: `Day N · Final program day`
- Configured end date: `Day N · Checkout & wrap-up`
- After end date: `Session complete`

## UX principles applied

The change follows the existing task-first product guidance: recognition over recall, visible system status, stable navigation, concise language, role/scope awareness and minimal cognitive load. Existing operational queues remain the source of the next action; the new day context explains *when* the user is working without competing with *what* they need to do.

## PWA note

Operating systems cache installed launcher artwork aggressively. Existing installations may keep an older launcher icon until the user removes and reinstalls the web app even after the manifest changes. The v63 service-worker cache refresh ensures the new manifest and artwork are available to new/reloaded clients.
