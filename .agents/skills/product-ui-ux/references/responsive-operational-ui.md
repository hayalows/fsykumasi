# Responsive and operational UI

Load this reference when a task involves phone/desktop behavior, viewport height, modals/sheets, scrolling, dense workspaces, slow connections, repeated actions, or field operations.

## Adaptive, not scaled

Responsive design is not the same layout made smaller.

Keep the task and state consistent across devices, then change the arrangement to fit the available space and input method.

A wide screen may use split views, multi-column choices, persistent context, or inline actions. A phone may use a single-column list, a bottom sheet, disclosure, or a focused detail view. Both should support the same underlying work unless the product intentionally limits a role/device.

## Width and height both matter

Common responsive bugs happen because only width is tested.

Representative review sizes:

- 360 × 780 small phone
- 390 × 844 common phone
- 414 × 896 large phone / iPhone XR class
- 768 × 1024 tablet portrait
- 1024 × 768 tablet/compact landscape
- 1366 × 768 short laptop
- 1440 × 900 normal laptop
- 1920 × 1080 large desktop

These are probes, not device-specific CSS targets. Prefer content-driven layout and a small number of meaningful breakpoints.

Short laptop height deserves explicit review. If a desktop dialog has abundant horizontal room but forces the primary action below the fold because all choices are stacked vertically, the composition is wasting available space.

## Critical-action reachability

The user should not scroll simply because the layout ignored available space.

For each task surface, identify the critical action and ask whether it remains reachable with realistic content.

Good techniques include:

- use two columns for short independent choices on wider screens
- place actions in a stable footer when body content legitimately scrolls
- reduce redundant explanatory copy at compact heights
- let supporting detail collapse before the main action disappears
- use `minmax()`/grid/flex wrapping rather than fixed widths

Do not cram content so tightly that touch/reading quality collapses just to avoid scrolling. Scrolling is fine when the content genuinely exceeds the viewport; needless scrolling is the problem.

## One scroll owner

Dialogs and sheets are easiest to use when one element owns vertical scrolling.

Avoid:

- modal scroll + inner form scroll + dropdown scroll unless each is necessary
- sticky footers inside a parent that also clips overflow unpredictably
- nested regions that steal wheel/touch movement

When a list inside a dialog must scroll independently, make the boundary and purpose obvious and keep the final action outside that list when possible.

Use `overscroll-behavior` deliberately where scroll chaining would be disruptive.

## Dynamic viewport units and safe areas

On mobile browsers, `100vh` can be misleading because browser chrome and the keyboard change the usable viewport.

Prefer `dvh`/`svh` where appropriate and pair them with content-safe max heights rather than hard full-screen heights.

Account for `env(safe-area-inset-bottom)`/related safe-area values for bottom navigation, fixed action bars, and sheets.

Do not position important actions under the home indicator or product bottom navigation.

## Mobile keyboard and input zoom

Opening the software keyboard can turn a previously good layout into a broken one.

- Keep text inputs at 16px or larger on iOS-class browsers.
- Do not auto-focus the first field on a compact sheet when doing so opens the keyboard before the user can read context.
- Make sure focused fields can scroll above sticky/fixed action bars and the keyboard.
- Do not lock body/overlay scrolling in a way that prevents the browser from bringing a focused field into view.

## Dense operational interfaces

Operational products may need higher density than consumer marketing apps. Density should save movement without hiding hierarchy.

Prefer:

- compact rows with consistent alignment
- strong typography hierarchy
- status and next action near each row/person/item
- quiet separators instead of card borders around every row
- progressive detail rather than showing every field in the list
- sticky/search/filter tools only when they materially reduce repeated movement

Avoid:

- oversized headers that consume the working viewport
- several summary bands before the actual work queue
- decorative cards for each small fact
- repeating the same status in badges, cards, metrics, and headings

## Repeated workflows

When users perform the same operation dozens of times, milliseconds and attention shifts compound.

- Keep search/focus ready for the next item when appropriate.
- Do not add long animations after routine actions.
- Preserve stable control positions where possible.
- Use optimistic/local updates only when the server model makes them safe and conflicts can be recovered.
- Prevent double submission with a clear busy state.
- After success, make the next task obvious without requiring a page reload.

## Slow and unreliable connections

A responsive interface should also be resilient to network latency.

- Keep usable stale content visible during a background refresh when safe.
- Distinguish initial loading from refreshing.
- Do not blank an entire workspace for a small mutation.
- Explain saved-but-refresh-failed states differently from not-saved states.
- Retry should be a first-class recovery action when it is safe.
- Avoid fetching large secondary datasets until the user enters the part of the flow that needs them.
- Avoid making routine flows depend on decorative media or heavy bundles.

## Content resilience

Test with:

- long personal names
- long ward/branch/unit names
- long error messages
- large counts
- missing optional values
- 200% text zoom where relevant
- translated or unexpectedly long labels if localization is possible

Use wrapping, ellipsis, and truncation intentionally. Never truncate the only information needed to distinguish two records without another way to inspect it.

## Responsive hierarchy changes

A hierarchy may change with space.

Examples:

- desktop: list + detail panel; mobile: list then full/bottom-sheet detail
- desktop: 2×2 choice grid; mobile: four stacked choices
- desktop: search + filters inline; mobile: search first, filters in a compact disclosure
- desktop: row actions inline; mobile: one primary row action + More

Do not hide a core task merely because the mobile arrangement is inconvenient. Recompose it.

## Overlay choice

Choose overlay type by task:

- dialog: focused decision or short form that interrupts current work
- sheet/drawer: contextual details/actions while preserving sense of place
- popover: lightweight contextual control or explanation anchored to a trigger
- full page: deep, long, linkable, or multi-stage work that deserves its own location

On phones, a desktop side sheet/dialog may become a bottom/full-height sheet if that improves reachability. Preserve semantics and focus behavior even when the visual form changes.

## Responsive review questions

1. Is the primary action visible/reachable on 1366×768?
2. Does the layout use wide desktop space rather than staying arbitrarily narrow?
3. Is there more than one vertical scroll owner?
4. Can mobile keyboard/focus reveal every field and action?
5. Do sticky regions cover content or focus?
6. Does bottom navigation overlap toasts/sheets/actions?
7. Do long names and errors reflow cleanly?
8. Can a phone user complete the same core task without hunting through hidden controls?
9. Does slow loading leave useful context on screen?
10. Is a breakpoint solving a real layout change or patching arbitrary pixel values?