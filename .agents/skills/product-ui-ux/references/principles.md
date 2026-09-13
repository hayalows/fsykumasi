# Product and usability principles

Load this reference when the problem is about flow, hierarchy, cognitive load, navigation, progressive disclosure, or deciding what belongs on a screen.

## Start from the job

Write the user's task as a short verb phrase before designing the page. Examples: `check in a participant`, `assign an available room`, `review an exception`, `invite a staff member`.

Then identify:

- trigger: why the user came here now
- required information: what they need before acting
- primary action: what advances/completes the task
- consequence: what happens if the action is wrong
- recovery: how they can correct a mistake
- completion signal: how they know the task worked
- next task: what usually follows

A screen is successful when those pieces are easy to understand, not when every available capability is visible.

## Recognition over recall

Put the information needed for a decision in the interface rather than expecting the user to remember it from another page, a previous modal, or training.

Useful examples:

- show current assignment beside a reassignment control
- show capacity beside a placement choice
- show the participant identity inside the confirmation sheet
- keep the selected filter visibly selected
- label unfamiliar status terms rather than relying only on color or icons

Avoid repeating information that does not affect the decision.

## Visibility of system status

After an action, make the new state clear quickly and at the right scope.

- local change: update the local row/control immediately when safe
- task completion: show a concise success message and next action
- background refresh: show refreshing without replacing usable content with a blank screen
- long operation: show progress or a busy state and prevent duplicate submission
- failed save: preserve input, explain the problem, and give a recovery action

Do not make the user infer whether a click worked.

## Match the user's language

Use the words staff already use in the real process. Prefer concrete nouns and verbs over system terminology.

Buttons should describe the action: `Save & check in`, `Assign room`, `Send invite`, `Mark not attending`.

Avoid vague actions such as `Submit`, `Proceed`, `Manage`, or `Process` when a more precise verb exists.

## User control and recovery

People make mistakes, especially in high-volume operations.

- Prefer reversible changes when the domain permits it.
- Keep Cancel/Back available in multi-step or interruptible flows.
- Use confirmation only when consequences justify interruption.
- If an action is irreversible, state the impact near the final action.
- Do not erase entered data after a recoverable error.
- Preserve context after a save instead of sending the user to an unrelated top-level page.

## Consistency and standards

Consistency is behavioral first, visual second.

The same type of control should behave the same way across the product. The same status should use the same wording and semantic tone. Similar forms should place validation and actions predictably.

Do not force identical layout where tasks differ. Consistency should reduce learning, not create rigid sameness.

## Error prevention before error messaging

Prevent invalid choices when the system already knows they are invalid.

Examples:

- filter out unavailable destinations rather than letting the user choose one and fail later
- disable a final action when required choices are incomplete, with the missing requirement visible nearby
- warn before replacing an existing assignment
- use appropriate input types and constraints
- prefill known information instead of requiring redundant entry

Do not hide all unavailable options if seeing why an option is unavailable is useful to the user's decision.

## Progressive disclosure

Keep the main path visible. Put secondary, uncommon, advanced, historical, or risky actions behind intentional disclosure.

Good disclosure tells the user what is inside: `More actions`, `Advanced settings`, `Show resolved`, `Can't find them?`.

Do not hide a common task behind multiple menus just to make a screen look minimal.

## Information hierarchy

A useful hierarchy for operational pages is often:

1. where am I / what task is this
2. current status or urgent exceptions
3. primary work area
4. supporting filters/search
5. secondary history or explanation

Within a detail surface:

1. identity/context
2. current state
3. next required decision
4. main action
5. secondary detail/history

Use typography, spacing, grouping, and alignment before adding borders, fills, or shadows.

## Cognitive load

Reduce choices at the moment they are not useful.

- group related fields
- use sensible defaults only when they are safe
- avoid showing the same metric in several places
- avoid requiring the user to mentally combine distant pieces of information
- keep labels short but not cryptic
- do not introduce a new visual pattern for a familiar interaction without a product reason

Minimal UI is not the goal. Minimal thinking is closer to the goal.

## Navigation and location

Navigation should answer `where am I?` and `where can I go?` without competing with the work.

- Current location should be visible.
- Use stable labels and order.
- Keep frequently repeated operational areas easy to reach.
- Preserve meaningful tab/filter state in the URL when the framework and privacy model allow it, especially when sharing/reloading should preserve context.
- Back/forward should not destroy work unexpectedly.

## Search and filters

Search should match the identifiers users actually have: names, IDs, units, groups, rooms, emails, or other domain terms.

- Search results should explain why a match is relevant when ambiguity exists.
- Keep active filters visible.
- Provide a fast reset when filters hide expected results.
- Do not show a no-results state that encourages creating a duplicate until the system has searched the likely existing records.

## Empty states

An empty state should distinguish between:

- success: nothing needs attention
- initial: nothing has been created yet
- filtered: nothing matches these filters
- error: content failed to load
- permission: content exists but is unavailable to this role

Those states should not share the same message.

## Decision check

Before settling a flow, ask:

1. Can a first-time user tell what to do next?
2. Can an experienced user do it quickly?
3. Can the user see the information needed to act safely?
4. What happens after a wrong click?
5. What happens with slow data or a failed save?
6. Is anything on screen present only because the system happens to have the data?
7. Can anything be removed, grouped, or delayed without hiding a common task?