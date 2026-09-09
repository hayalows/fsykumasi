# Wellness editor hotfix v35

Scope: frontend-only correction after the live Wellness v34 review.

## Problems reproduced from the live screenshot

- Staff operational role values could surface as raw database-style labels such as `assistant_coordinator`.
- The private Wellness editor locked body scrolling but its action footer used negative sticky offsets, which could leave Start visit / Save details below the reachable scroll area.
- Short desktop viewports and phones needed a single reliable editor scroll region rather than competing modal and form overflow.

## Changes

- Humanize underscore-delimited operational role labels only in display context. The underlying `operationalRole` value is unchanged for logic and search.
- Make the Wellness form the one vertical scroll container.
- Keep the action footer sticky at `bottom: 0` with safe-area padding.
- Use a full-height editor on small screens and compact spacing on short desktop screens.
- Keep 46px minimum action targets and horizontal overflow disabled.

## Safety

No database schema, RLS, capability, participant, staff assignment, check-in, housing, meal, head-count, or Wellness record changes.

## Release checks

- Full project tests
- Sites tests
- Production build
- Vercel preview
- Live deployment 200/error-log check after merge
