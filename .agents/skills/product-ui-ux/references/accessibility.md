# Accessibility baseline

Load this reference for forms, navigation, dialogs/sheets, custom controls, keyboard behavior, focus, motion, status communication, or an accessibility review.

Target WCAG 2.2 AA unless the project contract sets a stronger standard.

## Use native semantics first

Prefer the native element that already represents the interaction:

- `button` for actions
- `a` for navigation
- `input`, `select`, `textarea` and `fieldset/legend` for forms
- headings in a logical hierarchy
- `table` for genuinely tabular relationships
- lists for lists

ARIA can describe or supplement semantics; it should not recreate a native control without a reason.

## Keyboard

Everything a pointer can operate should have a sensible keyboard path when the interaction applies to keyboard users.

Check:

- logical Tab order
- no positive `tabindex`
- Enter/Space behavior appropriate to the control
- arrow-key patterns for widgets that require them
- Escape closes dismissible overlays when doing so is safe
- no keyboard traps
- no unreachable actions inside overflow containers
- custom composite widgets follow established WAI-ARIA interaction patterns

Do not make a whole card clickable with a generic div when a link or button can express the action.

## Focus

Visible focus is required.

- `:focus-visible` styling must have enough contrast to be found quickly.
- Opening a dialog/sheet should put focus in a predictable useful place, not accidentally behind the overlay.
- Closing it should return focus to a sensible trigger when that trigger still exists.
- Sticky headers, footers, bottom navigation, cookie bars, or action bars must not cover the focused element.
- Avoid auto-focusing fields on compact mobile screens when it unexpectedly opens the keyboard or shifts the layout before the user understands the surface.

## Names, labels, and instructions

Controls need accessible names that match their purpose.

- Visible form labels are preferred.
- Placeholder text is supplementary, not a label.
- Icon-only controls need an accessible name.
- Repeated ambiguous links such as `View` or `Edit` should have enough accessible context.
- Required formats or constraints should be explained before failure when users need them.

Do not duplicate accessible names in a way that makes screen-reader output noisy.

## Forms and errors

A good error experience works visually and programmatically.

- Identify the field/decision in error.
- Explain what to correct in plain language.
- Associate the message with the control (`aria-describedby`, native relationships, or the project's form abstraction).
- Set invalid state when appropriate.
- After failed submission, move focus to an error summary or first invalid field only when that helps rather than disorienting the user.
- Preserve entered values.
- Do not validate every keystroke in a way that announces errors before the user has had a chance to finish.

Never disable paste into authentication fields. Do not create authentication steps that depend only on memory puzzles or inaccessible gestures.

## Color and contrast

Use the current WCAG 2.2 contrast requirements as the baseline and verify actual rendered combinations.

Practical rules:

- ordinary text generally needs at least 4.5:1 contrast
- large text can use the applicable 3:1 threshold
- meaningful non-text UI boundaries/focus/state indicators need applicable 3:1 contrast against adjacent colors
- disabled controls have different conformance treatment, but they still need to be understandable in the product context

Color cannot be the only way to communicate status, error, selection, availability, or progress. Pair it with text, iconography, shape, position, or another cue.

## Target size and pointer interaction

WCAG 2.2 includes a minimum target-size criterion. Product standards may deliberately exceed the conformance floor.

For primary mobile actions, a 44px or larger target is a strong default. Dense desktop tables may use smaller visual controls when spacing/target behavior and the standard's exceptions make them usable.

Check the real clickable area, not only the visible icon.

Provide a non-drag alternative when a task would otherwise require dragging and an equivalent simple interaction is possible.

## Zoom, reflow, and text resize

Never disable browser zoom with restrictive viewport settings or event interception.

The interface should remain usable when text is enlarged and when the viewport narrows. Avoid fixed heights that clip text or actions. Let labels wrap where necessary rather than truncating decision-critical content.

Mobile text inputs should normally render at 16px or larger so iOS browsers do not zoom the page on focus.

## Motion

Respect `prefers-reduced-motion`.

- Information cannot depend on an animation playing.
- Avoid large or continuous movement for routine UI.
- Use motion primarily for orientation, state transition, or feedback.
- Reduced-motion mode should remove or substantially reduce nonessential movement, not merely shorten it by an imperceptible amount if the effect remains problematic.

## Live feedback

Use live regions sparingly.

- success/failure of an action can use a polite status or alert depending on urgency
- do not announce every small visual change
- a loading spinner needs a meaningful accessible status when waiting matters
- avoid multiple simultaneous live regions announcing the same event

## Dialogs, sheets, menus, popovers

The visible shape does not decide the semantic pattern. Use the pattern that matches behavior.

For modal dialogs/sheets:

- provide an accessible title
- manage focus entry and return
- prevent interaction with background content while modal
- keep dismissal available unless the task genuinely cannot be interrupted
- make scroll ownership predictable

Menus are for sets of actions, not for arbitrary page layout. A popover containing form fields is not necessarily a menu.

## Tables and dense data

Use semantic table structure when rows and columns have meaningful relationships. Preserve headers and accessible names for row actions.

For responsive layouts, do not turn a table into disconnected cards if doing so removes the relationships users need. Consider horizontal scrolling, priority columns, or a structured list/detail treatment based on the task.

## Accessibility review questions

1. Can I complete the task with keyboard only?
2. Can I see where focus is at every step?
3. Does focus ever sit behind sticky UI?
4. Do form errors identify both the problem and the correction?
5. Is any meaning color-only?
6. Are touch targets realistic on a phone?
7. Does text enlargement break the layout or hide actions?
8. Does reduced-motion mode retain all information and control?
9. Does the dialog/sheet return me to a sensible place?
10. Are custom controls actually necessary, and do they follow a known interaction pattern?