---
name: product-ui-ux
description: Design, audit, refine, or implement production UI and UX for web products, dashboards, operational tools, forms, navigation, responsive layouts, dialogs, sheets, tables, and design systems. Use when a task changes what a user sees, understands, clicks, types, scans, or recovers from. The skill combines task-first product design, WCAG 2.2 accessibility, responsive and viewport-height behavior, component/state discipline, design-token consistency, and a pre-ship review gate. Read the project's DESIGN.md and existing components first; project intent outranks generic defaults.
license: Project-authored synthesis. External references are linked in references/sources.md and are not vendored.
metadata:
  version: "1.0.0"
  portable: true
---

# Product UI/UX

Use this skill to make interfaces easier to understand and operate, not simply more styled.

The objective is a product that remains clear under real content, real permissions, different screen sizes, keyboard/touch input, slow states, errors, and repeated use. Visual polish matters, but it follows task clarity, behavior, accessibility, and system consistency.

## Step 0: establish the contract

Before changing UI:

1. Read the repository's `AGENTS.md`, `DESIGN.md`, design tokens, shared components, and nearby implementation.
2. Identify the user role, task, success condition, consequences of mistakes, likely device, and whether the work happens under time pressure.
3. Identify what must not change: data semantics, permissions, business rules, brand rules, or existing workflows outside the task.
4. If the user supplied a screenshot, treat it as evidence of one state and viewport, not as the whole product specification.

If no design contract exists, use `assets/DESIGN.template.md` to create a lean one before a broad redesign or new product surface. Do not create a large design document for a tiny local fix.

## Route to the smallest useful reference

Load only what the task needs:

- Product flow, hierarchy, cognitive load, progressive disclosure, information architecture, task design: `references/principles.md`
- Accessibility, focus, keyboard, target size, forms, errors, reduced motion: `references/accessibility.md`
- Mobile, desktop, viewport height, sheets/dialogs, scrolling, dense operational tools, low bandwidth: `references/responsive-operational-ui.md`
- Buttons, forms, navigation, tables/lists, overlays, feedback, and state coverage: `references/components-and-states.md`
- Audit, redesign, or pre-ship verification: `references/review-gates.md`
- Provenance and further reading: `references/sources.md`

Do not load every reference by default. Progressive disclosure keeps the agent focused and reduces contradictory advice.

## Choose the working mode

### Audit
Use when the user asks what is wrong, what could improve, whether something is ready, or asks for investigation only.

Inspect the live behavior and code when available. Report findings by severity and user impact. Do not edit unless the user asks for changes.

### Refine
Use when the product already works but the user asks to simplify, clean up, make responsive, reduce clutter, improve a screenshot, or make a flow smoother.

Preserve working behavior unless the behavior itself causes the UX problem. Prefer removing, grouping, reordering, and reusing existing primitives over adding new UI.

### Build
Use when creating a new component, page, or flow.

Start from task structure and states before styling. Reuse the project's design system. Introduce a new primitive only when existing primitives cannot express the interaction cleanly.

### System
Use for design tokens, component standards, responsive foundations, UI governance, or a reusable design system.

Separate primitive tokens, semantic tokens, and component-level decisions. Keep the contract small enough for humans and agents to follow. Add objective checks where a rule can be measured.

## The decision order

When several valid designs are possible, decide in this order:

1. User task and consequence of error
2. Product/business rules and permissions
3. Accessibility and input behavior
4. Information hierarchy and interaction cost
5. Responsive behavior and content resilience
6. Existing design system and component consistency
7. Performance and implementation simplicity
8. Visual character and delight

A more attractive option does not win if it makes the task slower, harder to recover from, or less accessible.

## Core defaults

Unless the project contract says otherwise:

- One clear primary action per decision point.
- Recognition over recall. Show the information needed to decide.
- Progressive disclosure for uncommon, advanced, or risky actions.
- Keep status and the action that responds to it near each other.
- Prefer Undo/recovery over unnecessary confirmations when reversal is safe.
- Do not make every region a card.
- Do not make every button primary.
- Do not use placeholders as labels.
- Do not use color as the only status signal.
- Do not disable browser zoom or paste.
- Keep mobile text inputs at 16px or larger unless there is a proven platform-safe alternative.
- Respect reduced-motion preferences.
- Use semantic HTML before ARIA.
- Design all states that can occur, not only the ideal state.
- Treat short laptop height as a real breakpoint problem. Use horizontal room before forcing routine actions below the fold.
- Prefer one scroll owner in dialogs and sheets.
- Use design tokens and shared components instead of local arbitrary values.

## Interaction states

For every interactive element that matters, consider:

- default
- hover when hover exists
- focus-visible
- active/pressed
- selected/current
- disabled or unavailable
- busy/loading
- success/confirmed when applicable
- error/invalid when applicable

For data surfaces, also consider empty, sparse, normal, dense/long-content, stale/refreshing, partial, permission-restricted, and offline/connection trouble when the product can reach those states.

Do not add states mechanically. Include only states the component or flow can actually enter.

## Responsive method

Do not make desktop first and then shrink it.

At each important viewport ask:

1. What must remain visible to make a safe decision?
2. What can reflow, wrap, collapse, or move behind disclosure?
3. Which action must remain reachable?
4. Who owns scrolling?
5. Can a long name, error message, keyboard, bottom navigation, or safe area break the composition?

Check both width and height. For responsive overlays, use the available canvas rather than an arbitrarily narrow column on desktop; on mobile, prefer a touch-safe sheet when that better matches the task.

## Visual quality without generic AI styling

A coherent interface should have a point of view, but it should come from the product, not a fashionable effect.

Build character through typography, proportion, spacing, information density, alignment, color roles, shape language, and one or two deliberate signatures. Avoid defaulting to gradients, glass, glow, giant rounded cards, excessive pills, decorative icon tiles, and repeated metric-card grids.

Restraint is often the stronger form of polish in operational products.

## Before editing existing products

Inspect before changing:

- shared components and token files
- the relevant feature flow around the screenshot or bug
- permissions and role differences
- current responsive rules
- historical compatibility layers that could override new styles
- existing tests and deployment checks

Prefer fixing the system-level cause when several screens share the same defect. Prefer a local fix when the requirement is genuinely local. Do not create another global CSS override layer merely because it is faster in the moment.

## Verification

For a meaningful UI change, use `references/review-gates.md` before declaring it complete.

At minimum, run the repository's existing build/tests and verify the changed task at relevant phone and desktop sizes. Exercise realistic states and input methods, including keyboard behavior where applicable.

Do not claim a visual or interaction result was verified if you only read source code. Say what was and was not checked.

## Output for audits

For report-only reviews, be concrete. Prefer this shape:

| Severity | Finding | User impact | Evidence | Recommended change |
| --- | --- | --- | --- | --- |

Separate defects from preferences. A defect breaks task completion, comprehension, accessibility, consistency with the product contract, or resilience. A preference is one valid aesthetic choice among several.

## When sources disagree

Design systems solve different product problems. Apple, Material, GOV.UK, USWDS, Carbon, Spectrum, and other systems are references, not authorities over the local product.

Use their underlying principles and tested patterns. Do not mix their visual languages component by component. The project's own design contract is the final visual system.