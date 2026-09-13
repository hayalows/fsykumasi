# UI/UX review gates

Load this reference for audits, redesigns, responsive fixes, or before shipping a meaningful user-facing change.

A passing build is not proof of good UX. A good screenshot is not proof of resilient behavior. Review the actual task.

## Gate 1: task clarity

Pass when:

- the page/surface has a clear purpose
- the user can identify the next useful action without reading everything
- the information needed for that action is nearby
- secondary actions do not compete visually with the primary
- permission boundaries do not imply unavailable capabilities

Fail when the interface requires training to find a common task, exposes implementation structure instead of user structure, or shows many equally weighted actions.

## Gate 2: state coverage

List the states the changed flow can actually reach and verify them.

Typical states:

- initial loading
- refreshing/stale
- empty
- no search/filter matches
- normal
- long/dense data
- disabled/unavailable
- busy mutation
- success
- validation error
- server/network error
- partial success (saved but refresh failed)
- permission restricted
- offline/poor connection when relevant

Pass only when each relevant state has usable copy, actions, and layout.

## Gate 3: keyboard and focus

For the changed task:

1. Start with keyboard only.
2. Reach every required interactive control.
3. Confirm focus is visible at every step.
4. Open/close overlays and confirm focus enters/returns sensibly.
5. Confirm no focus is hidden under sticky headers/footers/nav.
6. Confirm there is no keyboard trap.

For custom radio/tab/menu/listbox/combobox patterns, verify the appropriate established keyboard interaction, not merely Tab reachability.

## Gate 4: responsive composition

Check representative sizes based on the product. A useful default set is:

- 360 × 780
- 390 × 844
- 414 × 896
- 768 × 1024 when tablet matters
- 1366 × 768
- 1440 × 900
- 1920 × 1080 for wide desktop layouts

Verify:

- no unexpected horizontal scrolling
- no clipped decision-critical text
- actions remain reachable
- short laptop height is usable
- wide screens use space intentionally
- mobile layout is recomposed rather than merely shrunk
- bottom navigation/safe areas do not cover content/actions
- overlays have one predictable scroll owner
- software keyboard does not strand focused fields or actions

## Gate 5: content stress

Test realistic worst cases:

- long names/titles
- long unit/location names
- multi-line error messages
- large counts
- missing optional values
- the longest button label likely in the language
- 200% text zoom or equivalent enlargement where feasible

Pass when the interface still communicates identity, status, and action without overlap or silent clipping.

## Gate 6: accessibility semantics

Check:

- native element/role matches behavior
- controls have names
- headings are logical
- form labels remain visible
- errors are associated with their controls
- status is not color-only
- rendered contrast meets the product/WCAG baseline
- touch targets are appropriate
- browser zoom is not disabled
- reduced motion preserves information and control

Use automated accessibility tools when available, but treat them as one layer. Keyboard, focus, content, and task structure still need human/agent review.

## Gate 7: interaction feedback

For every consequential action:

- click/press has immediate response
- duplicate submission is prevented
- busy state is understandable
- success makes the new state clear
- failure preserves recoverable input/context
- recovery action is present when appropriate
- repeated actions do not trigger unnecessary animations or navigation

## Gate 8: system consistency

Check the diff for:

- arbitrary colors instead of semantic tokens
- arbitrary spacing/radii/timing that duplicate existing tokens
- new button/form/modal patterns that duplicate shared components
- one-off z-index escalation
- duplicated responsive rules fighting older layers
- feature CSS that accidentally changes unrelated screens

New exceptions are allowed, but they should solve a requirement the existing system cannot express.

## Gate 9: visual restraint

Reject polish that makes the product harder to scan.

Look for:

- cards inside cards without hierarchy value
- excessive pills
- excessive shadows/elevation
- decorative gradients/glow/glass
- icon boxes around every icon
- too many summary metrics before the work area
- oversized headers on operational screens
- duplicate status information
- animations that delay repeated work
- an interface where every region has equal visual weight

A product can be visually distinctive without these habits.

## Gate 10: performance and network behavior

For operational apps, verify that UI changes do not create avoidable latency or instability.

- avoid loading secondary datasets before they are needed
- keep usable content during safe background refreshes
- avoid layout shift from late-loading UI
- keep routine interactions lightweight
- do not introduce heavy UI libraries for one component without a strong reason
- check bundle/performance tools already used by the project when the change is large enough to matter

## Gate 11: regression boundary

Before shipping, answer:

- What behavior was intentionally changed?
- What behavior was intentionally preserved?
- Could the CSS/component change affect other routes?
- Did permissions/data behavior remain unchanged unless explicitly in scope?
- Is there a focused regression test or existing test that protects the change?

For screenshot-driven fixes, add a regression check that protects the underlying rule when feasible, not a brittle pixel snapshot unless visual regression infrastructure already exists.

## Severity model for audits

Use three levels:

### P0: blocks or dangerously misleads
Examples: primary action inaccessible, destructive action misrepresented, keyboard trap, user cannot complete required task, wrong permission implication, data-entry loss.

### P1: materially slows or confuses
Examples: hidden action on common laptop size, mobile zoom/reflow bug, ambiguous state, important error not recoverable, duplicate actions, severe hierarchy problem.

### P2: polish/consistency debt
Examples: inconsistent spacing, low-value visual noise, minor copy inconsistency, non-blocking responsive awkwardness.

Do not inflate aesthetic preferences into P0/P1 defects.

## Ship verdict

Use one of these:

- **Ship**: no unresolved P0/P1 findings in the changed task; relevant tests/build pass; checked viewports/states behave as intended.
- **Ship with known debt**: no P0; any remaining P1/P2 is understood, bounded, and acceptable for this release. Name the debt.
- **Hold**: unresolved P0 or a P1 likely to disrupt the target users/task.

State what was actually verified. If no browser/render was available, say the review was source-level and do not claim visual proof.