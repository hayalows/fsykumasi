---
name: FSY Kumasi Operations
status: active
version: 1.0
platform: responsive-web
principles:
  - calm-under-pressure
  - task-first
  - recognition-over-recall
  - progressive-disclosure
  - accessible-by-default
  - adaptive-not-shrunk
  - reversible-when-possible
tokens:
  color:
    canvas: "#f6f8f7"
    canvasWarm: "#faf9f5"
    surface: "#ffffff"
    surfaceSubtle: "#f1f5f4"
    surfaceStrong: "#e8efee"
    surfaceInverse: "#063c50"
    text: "#163944"
    textStrong: "#0c2d38"
    textSecondary: "#60757c"
    textTertiary: "#819197"
    brand: "#006f8d"
    brandStrong: "#005175"
    brandSoft: "#e5f3f6"
    brandSoftStrong: "#cde8ee"
    gold: "#d89525"
    success: "#3f6f36"
    warning: "#8a5c12"
    danger: "#9a4037"
    info: "#476a86"
  spacing: [4, 8, 12, 16, 24, 32, 40, 48, 64]
  radius: [6, 10, 12, 16, 20]
  controlMin: 44
  contentMax: 1220
  sidebar: 252
  motion:
    fast: 120
    normal: 180
    easing: "cubic-bezier(.2,.8,.2,1)"
---

# FSY Kumasi Operations design contract

This file records the product design intent that should remain stable across screens and future agent sessions. The CSS implementation in `src/design-system/` is the runtime source of truth. If values here and the shipped semantic tokens disagree, inspect the change history before editing either one.

## 1. Product mode

FSY Kumasi Operations is a live operations workspace for people doing time-sensitive work during an FSY session. It is not a marketing site and it should not borrow marketing-site habits such as decorative hero layouts, large empty areas, novelty motion, or visual effects that compete with the task.

The interface should feel calm, direct, trustworthy, and quick to scan. A staff member should usually be able to answer three questions without searching the whole page:

1. What is happening now?
2. What needs my attention?
3. What is the next useful action?

## 2. Users and conditions

Design for mixed technical confidence, phones and laptops, varying internet quality, and moments where the user may be standing, speaking to a participant, or handling several people at once.

Common operational roles include Assistant Coordinators, Coordinators, logistics administrators, session leadership, committee members, and other staff with narrower responsibilities. Permission boundaries are part of the product. A cleaner screen must never imply that a person can perform an action they are not allowed to perform.

## 3. Hierarchy and composition

Use hierarchy before decoration.

- Start pages with a clear page title and short purpose statement.
- Put current status, unresolved work, and the next action before historical detail.
- Prefer a few strong regions separated by rhythm or dividers over many nested cards.
- Use elevated surfaces mainly for transient layers such as dialogs, menus, popovers, and toasts.
- Keep summary metrics quiet unless they change a decision.
- Group controls by task. Do not spread one decision across distant areas of the page.
- Long operational lists may be dense, but row hierarchy and touch targets must remain clear.
- Tables and lists should preserve important identity and status information when space gets tight. Hide secondary detail before hiding the information required to act safely.

## 4. Actions and decisions

Each decision point should have one visually dominant next action.

- Primary actions complete or advance the current task.
- Secondary actions support the task without competing with it.
- Destructive or exceptional actions should be visually and spatially separated from routine actions.
- Put uncommon actions behind a clear More/details affordance when showing them all would increase cognitive load.
- Prefer reversible actions and Undo where the domain supports it.
- Confirmation dialogs are for meaningful consequences, not for every save.
- A disabled primary action must make the missing requirement understandable nearby.

## 5. Forms and check-in flows

Forms should read in the same order that staff think about the work.

- Prefer one column for dependent questions and short operational forms.
- Use radio buttons or clear choice cards for one-of-many decisions, checkboxes for multiple choices, switches for immediate binary settings, and buttons for actions.
- Keep labels persistent. Placeholder text is not a label.
- Validate at a useful moment and place the message next to the field or decision it belongs to.
- Error copy should say what happened and what the user can do next. Do not expose database or framework language.
- Do not silently discard entered data after an error.
- For arrival/check-in work, a successful action should make the result obvious and make the next participant easy to start.

## 6. States and feedback

Every meaningful surface should account for the states that apply to it:

- loading or refreshing
- empty
- sparse
- normal
- dense or long-content
- disabled or unavailable
- busy mutation
- success
- recoverable error
- permission-restricted
- offline/slow connection when relevant

Feedback should be proportional. Use inline status for local changes, toasts for brief confirmation that does not need further action, and blocking layers only when the user must decide before continuing.

Never rely on color alone. Pair status color with text, iconography, shape, or position.

## 7. Responsive behavior

Desktop and mobile share the same work and state, but they do not have to share the same arrangement.

Treat these as first-class review sizes:

- small phone: 360 × 780
- iPhone XR-class: 414 × 896
- tablet/compact landscape around 768–1024px wide
- short laptop: 1366 × 768
- normal laptop: 1440 × 900
- large desktop: 1920 × 1080

Width-only breakpoints are not enough. Short desktop viewports must keep key actions reachable. Use available horizontal space before forcing routine actions below the fold.

Sheets and dialogs should normally have one scroll owner. Sticky action regions are useful when content must scroll, but they must not cover focused controls or content. On phones, respect safe areas and bottom navigation. Use intrinsic layout, `minmax()`, `clamp()`, `dvh`, and content-driven wrapping before adding many device-specific breakpoints.

Mobile text inputs should remain at least 16px to avoid iOS focus zoom. Never disable browser zoom.

## 8. Accessibility

WCAG 2.2 AA is the baseline, not a final polish pass.

- Prefer semantic HTML and native controls before ARIA.
- All interactive work must be keyboard operable.
- Focus must be visible and must not be hidden by sticky or fixed UI.
- Dialog/sheet focus should enter predictably, remain within the interaction when appropriate, close via a clear action and Escape when safe, and return to a sensible trigger.
- Icon-only actions require accessible names.
- Text and interactive states must meet applicable contrast requirements.
- Use at least the product's 44px control target for primary touch interactions unless a denser control has a valid exception and remains usable.
- Do not require dragging when an equivalent simple interaction can be offered.
- Respect `prefers-reduced-motion` and do not make information depend on animation.

## 9. Motion

Motion exists to explain change, preserve orientation, or confirm an interaction.

Use the existing motion tokens for normal UI transitions. Favor opacity and transform when animation is needed. Avoid long entrances, springy decoration, scroll hijacking, animated gradients, and movement on repeated operational actions. A user checking in dozens of people should not wait for the interface to perform.

## 10. Visual language

The current FSY system uses warm light canvases, white functional surfaces, deep blue/teal for identity and actions, restrained gold as an accent, and muted semantic state colors. Inter is the default UI typeface with system fallbacks.

The visual signature is restraint:

- clean operational typography
- strong alignment
- quiet borders
- limited elevation
- compact but breathable spacing
- rounded corners used consistently, not on every nested region
- status colors reserved for meaning

Avoid generic AI-interface tells: large gradient blobs, glowing cards, excessive pill shapes, repeated metric cards, glass effects without purpose, decorative icon containers everywhere, and a dashboard made of equally weighted rectangles.

## 11. System ownership

New UI should use the existing semantic design-system layers in `src/design-system/` before introducing feature-specific CSS. Feature CSS may define layout or behavior that is genuinely local, but colors, typography, spacing, radii, focus, control sizing, elevation, and motion should normally come from semantic tokens.

Do not change operational logic, permissions, RLS, or data semantics merely to simplify a screen. If a better UX requires a product-rule change, call that out as a separate decision.

## 12. Review standard

A screen is not ready because it looks clean in one screenshot. Before sign-off, review the full task at relevant phone, short-laptop, and desktop sizes, with keyboard and touch assumptions, realistic long names/content, loading and error states, and the permissions of the target role.

For larger changes, use the project UI/UX skill at `.agents/skills/product-ui-ux/SKILL.md` and its review gate.