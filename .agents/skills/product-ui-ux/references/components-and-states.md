# Components and states

Load this reference when building or reviewing buttons, forms, navigation, lists/tables, overlays, feedback, selection controls, or reusable component APIs.

## Component rule

A component is not complete when its default screenshot looks good. Its behavior, states, content limits, semantics, and responsive behavior are part of the component.

Before adding a new primitive, check whether the product already has one that can be extended without making its API incoherent.

## Buttons and actions

Use hierarchy based on task importance, not aesthetics.

### Primary
One main action for the current decision point. Avoid several primary buttons in one local group.

### Secondary
Useful but not the completion action. It should remain discoverable without competing with the primary.

### Tertiary/text
Low-emphasis actions such as `Cancel`, `View details`, or lightweight local operations when the product system supports them.

### Destructive
Use semantic danger styling only when the action has harmful or hard-to-reverse consequences. Do not make every warning-colored action visually dominant.

Button labels should use a specific verb and object/result where useful. Keep loading labels stable enough that the button does not jump significantly.

Disable only when acting would be invalid. If the reason is not obvious, explain it nearby. Do not use disabled controls to hide permissions; remove or replace them with clear read-only context when that better fits the role.

## One-of-many choices

Use native or semantically equivalent radio-group behavior when the user chooses one option from a set.

Choice cards are useful when each option needs a short explanation. They still need correct radio semantics, selected state, keyboard behavior, and visible focus.

For a small set of short mutually exclusive view modes, a segmented/tab control can work if it actually changes the visible view and follows the appropriate tab/selection pattern.

Do not use checkboxes for a single-choice question.

## Multi-select

Use checkboxes or a clear multi-selection pattern. Keep the selected count/scope visible when choices span a long list or different sections.

For high-consequence selections, summarize the final scope before applying it.

## Switches

Use a switch for a binary setting that takes effect immediately or clearly changes an enabled/disabled state.

Do not use a switch for a one-time form choice that is saved only after submission; a checkbox may better communicate that model.

## Search

Search should be fast to enter and easy to clear.

- include a persistent accessible label, visible when the surrounding context is not enough
- use placeholder examples sparingly
- keep the clear action touch-safe
- debounce only when necessary; do not make local filtering feel laggy
- avoid iOS zoom by maintaining adequate input font size
- show why/where a record matched when ambiguity exists

If no result is found, do not immediately encourage creating a duplicate until likely alternative identifiers/sources have been checked.

## Filters

Filters are part of state, not decoration.

- active filters must be visible
- show counts when they help prioritization
- provide a clear reset
- avoid horizontally overflowing dozens of pills if a compact filter sheet/control would work better
- do not use a filter when the user really needs a separate work mode with different hierarchy

## Forms

Prefer a single logical reading order.

A field should include only what is needed:

- visible label
- optional hint when it prevents error
- control
- validation/error message when needed

Group related controls with `fieldset`/`legend` or the product's accessible equivalent.

Do not put required-field asterisks everywhere if nearly every field is required and the product can state that more clearly. When optionality matters, label it consistently.

## Validation

Prevent known invalid choices when practical. Validate at a moment that helps the user.

Good error message structure:

`What is wrong` + `what to do next`

Examples:

- `Choose at least one company before continuing.`
- `That email already has access. Search for the existing person instead.`
- `This group is full. Choose another available group.`

Avoid technical strings such as database column names, stack traces, RPC names, or HTTP internals in user-facing errors.

## Navigation

Use the fewest navigation levels that preserve clear location and access to common work.

- active location must be visually and programmatically clear
- labels should remain stable
- icons support labels rather than replacing unfamiliar destinations
- mobile bottom navigation is for a small set of frequent destinations; less frequent areas can live behind More/menu patterns
- do not put important status badges where they turn navigation into a dashboard

## Tabs and segmented views

Use tabs when several peer views share a parent context and switching does not represent a sequential step.

Preserve the selected view in the URL when reload/back/share behavior benefits from it and privacy permits.

Do not use tabs as a substitute for a wizard when the user must complete steps in order.

## Lists and rows

A repeated row should have a stable anatomy:

1. identity/name
2. supporting identifier/context
3. current status or relevant scope
4. primary next action when applicable
5. secondary actions behind a predictable affordance when numerous

Use alignment and separators before wrapping every row in a heavy card.

For touch layouts, the row action should have an adequate hit target and not cause accidental activation of the whole row when the user tries to scroll.

## Tables

Use tables for data that users compare across columns.

- meaningful headers
- row actions have specific accessible names
- align numbers consistently
- support long content without making every column unreadably narrow
- sticky headers may help long tables but must not cover focus/content
- on small screens, prioritize columns or use a structured list/detail layout; preserve relationships users need for decisions

Do not convert every data set into cards simply because the viewport is narrow.

## Status and badges

A badge is useful for compact state, not as decoration around every noun.

Use consistent semantic tones. The text should carry meaning even without color. Avoid inventing many subtly different statuses that users cannot distinguish operationally.

## Loading

Match loading feedback to duration and scope.

- brief mutation: busy state in the triggering action
- initial content load: skeleton/progress only when it matches the product and avoids misleading structure
- background refresh: keep existing content and show a small refreshing signal
- long process: explain what is happening and whether the user can leave safely

Do not replace an entire populated workspace with a spinner for a local update.

## Empty states

Empty states need a reason-specific message.

- `Nothing needs attention` can be a positive operational state.
- `No matches` should point to filters/search spelling/reset.
- `No records yet` can offer the creation/import action if the user has permission.
- `Unable to load` needs recovery, not an illustration.

Avoid oversized illustrations that push the useful action below the fold in operational tools.

## Success

Success feedback should confirm the result without becoming another task.

Good: concise toast/inline update, changed row state, next participant focused.

Avoid a full-page success screen for routine repeated operations unless the workflow genuinely ends there.

## Errors

Errors should preserve context and input. Distinguish:

- action failed and nothing saved
- action saved but refresh failed
- data is stale/conflicted
- permission changed
- connection problem
- validation problem

Those states require different recovery choices.

## Dialogs and sheets

Use a dialog/sheet only when the work benefits from keeping the parent context nearby.

Anatomy:

- clear title
- optional short explanation
- contextual identity/status when needed
- focused content/decision
- error feedback in a predictable place
- primary and secondary actions
- close/cancel affordance when interruption is safe

Desktop overlays should use available width when doing so shortens the task. Mobile sheets should remain touch-safe and respect safe areas.

Avoid nested modals. If a flow repeatedly opens an overlay from an overlay, reconsider whether it deserves a page or integrated detail region.

## More menus

Use More for secondary actions that do not need constant visibility. Do not hide the routine primary task there.

Action labels inside menus should remain explicit. Separate destructive actions visually when they coexist with routine options.

## Component state checklist

For each changed component, select the states it can actually enter and verify them:

- default
- hover
- focus-visible
- active/pressed
- selected/current
- disabled/unavailable
- busy/loading
- empty
- error/invalid
- success
- long content
- permission-restricted
- reduced motion
- compact width
- short viewport height

The goal is not to implement every state. It is to avoid accidentally shipping an unhandled state that the real product can reach.