# FSY Operations Design System v1

## Decision

Adopt a small FSY-specific design system for the operations app instead of making the product a direct Material, Apple, or dashboard-template implementation.

The system borrows interaction discipline from Apple HIG, Material 3, GitHub Primer, Fluent 2, and GOV.UK while keeping the FSY identity, existing operational language, Inter typography, and Phosphor icons.

## Product character

The interface should feel calm, human, dependable, immediate, and deliberate. It should not feel like a consumer social app or a generic admin dashboard.

## Surface grammar

Cards are not the default container.

Use:
- lists for homogeneous people/tasks
- tables for comparison/reporting
- grouped summary strips for facts
- spacing + dividers for page sections
- drawers for contextual desktop work
- bottom sheets for contextual mobile work
- dialogs only for short confirmations
- full task views for genuinely long or multi-step work
- toast for temporary reversible feedback
- banners for persistent warnings

A card must represent a genuinely independent object or state to justify its own border/radius.

## Responsive rule

Desktop and mobile share the same state and actions, but not necessarily the same composition.

Desktop should prefer list/detail, inline context, and compact operational scanning. Mobile should prefer one focused surface at a time, full-width actions, safe-area-aware bottom sheets, and clear progressive disclosure.

Minimum supported content width remains 320 CSS px. Short viewport height is treated as a first-class test case for sheets and dialogs.

## System architecture

`src/design-system/`
- `tokens.css`: semantic color, type, spacing, shape, elevation, motion
- `foundation.css`: shell, typography, page rhythm, focus, surfaces
- `components.css`: controls, fields, status, tables, feedback, modal/drawer/sheet behavior
- `compositions.css`: reusable Section, SummaryStrip, Toolbar, ActionList, DetailPane, Banner patterns
- `patterns.css`: compatibility layer mapping current FSY pages to the system
- `responsive.css`: adaptive desktop/mobile composition
- `index.css`: single entry point loaded last

`src/components/DesignSystem.jsx` contains product-logic-free compositional primitives for migrated and new screens.

## Compatibility strategy

Historical CSS remains temporarily because current operational pages still depend on layout rules spread across previous releases. The design-system entry point loads last and normalizes the product while migrations proceed page by page.

Do not add new `*-vNN.css`, `*-fix.css`, or release-only visual overrides for normal product work. New styling should go into the design system or the owning page only when the behavior is truly page-specific.

Old CSS should be removed only after its active selectors are no longer required and the affected workflows have browser regression coverage.

## Interaction rules

- one visually dominant action per region
- internal enum/database values never appear as user labels
- status is visually distinct from action controls
- hover cannot be the only way to discover an action
- destructive actions state their consequence before mutation
- reversible actions use immediate Undo when safe
- sheets/dialogs must have one scroll owner and reachable actions
- keyboard focus must remain visible and trapped only inside modal contexts
- loading/error/stale/empty states must not display false operational zeros

## Visual rules

- Inter remains the interface typeface
- semantic tokens are used instead of page-local raw colors
- large shadows are reserved for floating UI only
- page sections use rhythm and dividers before boxes
- controls use a 44px interaction target
- corner radius follows a small controlled scale
- motion communicates state change and respects reduced motion

## Release checks for future UI work

A visual change is not done because CSS exists or the build passes. For affected tasks, verify:
- actual human workflow
- 320, 390, 768, 1024, and 1440 widths where relevant
- at least one short viewport height for overlays
- keyboard-only completion for forms/sheets
- loading, error, empty, and long-content states
- relevant role restrictions
- no page-level horizontal overflow
- primary/cancel actions remain reachable

This design-system migration changes presentation only. Operational data, permissions, RLS, and mutation behavior remain owned by the existing feature logic and server contracts.
