# Operations information architecture and interaction system

Date: 2026-09-02

Status: Release candidate

## Decision

The product is organized around the leader's next operational action rather than around every database area. Overview, Check-in, and Head count are the daily workbench. People and Groups & companies are the session directory and structure workspace. Registration, Assignments, Access, and Birthdays are lower-frequency tools grouped behind More tools on desktop and More on mobile. Account is reached from the identity control.

The mobile bar has four primary destinations plus More. More is a real navigation surface, not a second page: it has a scrim, explicit close button, backdrop dismissal, Escape dismissal, navigation dismissal, body-scroll lock, focus trap, and focus restoration. A navigation change updates the URL's `view` parameter, and a selected person uses `person` so refresh/back can return to a meaningful list/detail state without putting credentials or private data in the URL.

## Interaction rules

- Search is a full-width, native search control with an accessible label, a 44px minimum touch target, 16px text to avoid mobile browser zoom, and a visible clear action when populated.
- Segmented controls expose tab semantics, selected state, and arrow-key movement. They are used only for true peer modes such as Participants/Staff and Registration/Review inbox.
- Detail surfaces use one dismissible-layer contract: backdrop, Escape, close control, focus trap, initial focus, and focus restoration. People details are list-to-detail on desktop and a bottom sheet on mobile.
- Operational feedback stays adjacent to the mutation that caused it. Head count reports have one save path with explicit saved state; check-in has a single record action plus Undo after success.
- Access remains discoverable to Coordinators as a view-only state surface; approval, invitation, recovery, and override controls continue to be capability-gated.
- Touch targets remain at least 44px, controls are keyboard reachable, and no essential action depends on hover.

## Cohort language

The UI distinguishes four different quantities: registration records, eligible youth, data exceptions, and eligible youth ready for placement. “Ready but unassigned” is a placement task, not a registration-data exception. This distinction matters in a rehearsal where a structure has not yet been published and all eligible youth may be unassigned.

The summary is derived from the existing operational eligibility and review helpers. It does not alter eligibility, assignments, check-in, head count, permissions, or RLS. Current session boundaries remain configuration-driven; this pass does not silently change the production age settings or participant data.

## Safety boundary

This refinement is UI and client-state only. It introduces no schema, migration, RPC, RLS, or service-role changes. The live audit used production data read-only. Screenshots and local audit artifacts remain local-only and are excluded from publication.
