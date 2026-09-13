---
name: PROJECT_NAME
status: draft
version: 0.1
platform: responsive-web
principles:
  - task-first
  - accessible-by-default
  - adaptive-not-shrunk
tokens:
  color:
    canvas: "#FILL"
    surface: "#FILL"
    text: "#FILL"
    textSecondary: "#FILL"
    brand: "#FILL"
    success: "#FILL"
    warning: "#FILL"
    danger: "#FILL"
  spacing: [4, 8, 12, 16, 24, 32, 48, 64]
  radius: [6, 10, 14, 20]
  controlMin: 44
  motion:
    fast: 120
    normal: 180
    easing: "cubic-bezier(.2,.8,.2,1)"
---

# PROJECT_NAME design contract

Delete sections that do not apply. Keep this contract short enough that people and agents will actually read it. The implementation's semantic token/component files should remain the runtime source of truth.

## 1. Product mode

What is this product? Who is using it, in what conditions, and what should it feel like?

Example questions:

- Is it operational, consumer, editorial, enterprise, public service, creative, or marketing?
- Is the work occasional or repeated many times per day?
- Are mistakes cheap, recoverable, expensive, or safety-sensitive?
- Is the user likely to be on phone, desktop, both, or specialist hardware?

## 2. Primary users and jobs

Name the important user roles and their top tasks.

- ROLE: TASK
- ROLE: TASK

Record permission boundaries or context that materially changes the UI.

## 3. Information hierarchy

State the preferred page and detail hierarchy.

Examples:

- current status before history
- task queue before summary analytics
- identity + state + next action before secondary metadata
- use rhythm/dividers rather than card containers for every section

## 4. Actions

Define how primary, secondary, destructive, and uncommon actions should be treated.

Record product-specific rules such as when Undo is preferred, when confirmation is required, and where advanced actions live.

## 5. Forms and input

Document the form patterns that matter for this product:

- labels and help text
- validation timing
- error style
- choice controls
- autosave vs explicit save
- authentication constraints
- mobile keyboard/input behavior

## 6. States and feedback

List the meaningful states the product must design for. Typical candidates:

- loading/refreshing
- empty/no matches
- normal/dense
- disabled/unavailable
- busy mutation
- success
- error/partial success
- permission restricted
- offline/poor connection

## 7. Responsive behavior

Describe how the task recomposes across phone, tablet, short laptop, and wide desktop.

Record critical review sizes if the product has known target devices. Include viewport-height rules for overlays and workspaces.

## 8. Accessibility

State the conformance target and any stronger product rules.

Default recommendation: WCAG 2.2 AA, semantic HTML, visible/unobscured focus, keyboard-operable flows, adequate touch targets, non-color status cues, reduced motion, zoom/reflow support.

## 9. Visual language

Describe the product's visual signature without relying only on brand adjectives.

Include:

- typography treatment
- density
- color roles
- shape language
- elevation/border style
- icon approach
- one or two distinctive signatures
- visual patterns to avoid

## 10. Motion

Define when motion is useful and the normal duration/easing range. Record reduced-motion behavior.

## 11. System ownership

Point to the design token and shared component source files. State what should use semantic tokens versus local feature CSS.

## 12. Review standard

State what must be checked before a user-facing change is considered ready: build/tests, target viewports, keyboard/focus, states, long content, permissions, and any visual regression process.